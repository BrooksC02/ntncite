import { chunkBlocks } from '../convert/htmlToBlocks';
import type { Config } from '../config';
import type { PaperRecord } from '../paper';
import { loadState, saveState } from '../state';
import { ntnAlive, ntnApi } from './ntn';

// 合并后「文献」库必备属性。少任一个就报错,避免静默写错列。
const REQUIRED_PROPS = [
  'Name',
  'Authors',
  'Year',
  'DOI',
  'Publication',
  'Citekey',
  'Item Type',
  'Tags',
  'Zotero URI',
  'Reading Status',
  'Note Count',
  'Date Added',
  'Content Hash',
  'Zotero Item Key',
  'Last Synced',
];

export type SyncAction = 'create' | 'update' | 'skip';
export interface SyncResult {
  record: PaperRecord;
  action: SyncAction; // 失败时表示「本来要做的动作」
  pageId?: string;
  ok: boolean;
  error?: string;
}

async function validateSchema(notesDsId: string): Promise<void> {
  const ds = await ntnApi<{ properties: Record<string, unknown> }>(`v1/data_sources/${notesDsId}`, {
    method: 'GET',
  });
  const have = new Set(Object.keys(ds.properties ?? {}));
  const missing = REQUIRED_PROPS.filter((p) => !have.has(p));
  if (missing.length) {
    throw new Error(
      `「文献」库缺字段: ${missing.join(', ')}\n请补齐,或确认 config.notesDataSourceId 指对了库。`,
    );
  }
}

// 去重:Zotero Item Key → 现有页(带其 Content Hash)
interface ExistingPage {
  pageId: string;
  hash: string;
}

/**
 * 一次分页拉全库,建 itemKey → {pageId, hash} 映射,取代「每篇一次 query」的 N 次往返。
 * 同一 item key 出现多行(手动重复)时只认第一行并告警。
 */
async function fetchAllExisting(notesDsId: string): Promise<Map<string, ExistingPage>> {
  const map = new Map<string, ExistingPage>();
  let cursor: string | undefined;
  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await ntnApi<{ results: any[]; has_more: boolean; next_cursor: string | null }>(
      `v1/data_sources/${notesDsId}/query`,
      { method: 'POST', body },
    );
    for (const page of res.results ?? []) {
      const key = page.properties?.['Zotero Item Key']?.rich_text?.[0]?.plain_text ?? '';
      if (!key) continue;
      if (map.has(key)) {
        console.warn(`  ⚠ Notion 里有多行共用 Zotero Item Key=${key},只认第一行(请手动删重复行)`);
        continue;
      }
      const hash = page.properties?.['Content Hash']?.rich_text?.[0]?.plain_text ?? '';
      map.set(key, { pageId: page.id, hash });
    }
    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);
  return map;
}

export interface OrphanPage {
  itemKey: string;
  title: string;
  pageId: string;
}

/**
 * 查 Notion 里已不再对应任何「现存 Zotero 论文」的残留页(Zotero 删了笔记/条目后脚本不会删页)。
 * 会分页查一次 Notion——按需调用,别放进高频轮询。
 */
export async function findOrphans(cfg: Config, currentKeys: Set<string>): Promise<OrphanPage[]> {
  const notesDsId = cfg.notion.notesDataSourceId;
  if (!notesDsId) throw new Error('config.notion.notesDataSourceId 未设置。');
  await ntnAlive();
  const orphans: OrphanPage[] = [];
  let cursor: string | undefined;
  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await ntnApi<{ results: any[]; has_more: boolean; next_cursor: string | null }>(
      `v1/data_sources/${notesDsId}/query`,
      { method: 'POST', body },
    );
    for (const page of res.results ?? []) {
      const key = page.properties?.['Zotero Item Key']?.rich_text?.[0]?.plain_text ?? '';
      if (!key || currentKeys.has(key)) continue;
      const title =
        (page.properties?.['Name']?.title ?? []).map((t: any) => t?.plain_text ?? '').join('') || '(untitled)';
      orphans.push({ itemKey: key, title, pageId: page.id });
    }
    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);
  return orphans;
}

function rich(text: string) {
  return [{ type: 'text' as const, text: { content: text } }];
}

/** 业务元数据(不含 hash / Last Synced——这两个最后写,保证「正文没写完就不算同步成功」)。 */
function metaProperties(p: PaperRecord, isCreate: boolean): Record<string, any> {
  const props: Record<string, any> = {
    Name: { title: rich(p.title) },
    Authors: { rich_text: p.authors ? rich(p.authors) : [] },
    Year: { number: p.year ?? null },
    DOI: { rich_text: p.doi ? rich(p.doi) : [] },
    Publication: { rich_text: p.publication ? rich(p.publication) : [] },
    Citekey: { rich_text: p.citekey ? rich(p.citekey) : [] },
    'Item Type': { select: { name: p.itemType } },
    Tags: { multi_select: p.tags.map((t) => ({ name: t })) },
    'Zotero URI': { url: p.zoteroUri },
    'Note Count': { number: p.noteCount },
    'Zotero Item Key': { rich_text: rich(p.itemKey) },
  };
  if (p.dateAdded) props['Date Added'] = { date: { start: p.dateAdded } };
  // Reading Status 只在 create 时设默认值,update 不覆盖(尊重你的手改)
  if (isCreate) props['Reading Status'] = { select: { name: 'Reading' } };
  return props;
}

/** 内容指纹 + 时间戳——**最后**写。写成功 = 这次同步真的完成了,否则下次会重试。 */
function stampProperties(p: PaperRecord): Record<string, any> {
  return {
    'Content Hash': { rich_text: rich(p.hash) },
    'Last Synced': { date: { start: new Date().toISOString() } },
  };
}

// ── 正文 blocks:有标题时在最前面放一个目录(table_of_contents) ──
function tableOfContents() {
  return {
    object: 'block' as const,
    type: 'table_of_contents' as const,
    table_of_contents: { color: 'default' as const },
  };
}
function hasHeading(blocks: any[]): boolean {
  return blocks.some(
    (b) => b?.type === 'heading_1' || b?.type === 'heading_2' || b?.type === 'heading_3',
  );
}
function pageBlocks(p: PaperRecord): any[] {
  return hasHeading(p.bodyBlocks) ? [tableOfContents(), ...p.bodyBlocks] : p.bodyBlocks;
}

async function appendBlocks(pageId: string, blocks: any[]): Promise<void> {
  for (const batch of chunkBlocks(blocks)) {
    await ntnApi(`v1/blocks/${pageId}/children`, { method: 'PATCH', body: { children: batch } });
  }
}

/** 分页收集页面所有子块 id(GET children 每页上限 100)。 */
async function collectChildIds(pageId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const qs = cursor ? `?page_size=100&start_cursor=${cursor}` : '?page_size=100';
    const res = await ntnApi<{ results: { id: string }[]; has_more: boolean; next_cursor: string | null }>(
      `v1/blocks/${pageId}/children${qs}`,
      { method: 'GET' },
    );
    for (const b of res.results ?? []) ids.push(b.id);
    cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
  } while (cursor);
  return ids;
}

/** 建页:先建壳(无 hash)→ 灌正文 → 最后盖 hash 戳。任一步挂了 hash 都不会写,下次重建。 */
async function createPage(notesDsId: string, p: PaperRecord): Promise<string> {
  const page = await ntnApi<{ id: string }>('v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: notesDsId },
      properties: metaProperties(p, true),
      children: [],
    },
  });
  await appendBlocks(page.id, pageBlocks(p));
  await ntnApi(`v1/pages/${page.id}`, { method: 'PATCH', body: { properties: stampProperties(p) } });
  return page.id;
}

/**
 * 更新页:**先 append 新正文,再删旧子块,最后盖 hash 戳**。
 * 这样任何一步失败页面都不会变空(最坏是新旧内容并存),且 hash 没更新 → 下次会自愈重试。
 */
async function updatePage(pageId: string, p: PaperRecord): Promise<void> {
  const oldChildren = await collectChildIds(pageId); // 先记下旧块(全部,分页)
  await appendBlocks(pageId, pageBlocks(p)); // 灌新正文(此刻页面 = 旧 + 新)
  for (const id of oldChildren) await ntnApi(`v1/blocks/${id}`, { method: 'DELETE' }); // 删旧
  await ntnApi(`v1/pages/${pageId}`, {
    method: 'PATCH',
    body: { properties: { ...metaProperties(p, false), ...stampProperties(p) } },
  });
}

function decideAction(existing: ExistingPage | null, p: PaperRecord, force: boolean): SyncAction {
  if (!existing) return 'create';
  if (!force && existing.hash === p.hash) return 'skip';
  return 'update';
}

async function upsertOne(
  notesDsId: string,
  p: PaperRecord,
  existing: ExistingPage | null,
  dryRun: boolean,
  force: boolean,
): Promise<SyncResult> {
  const action = decideAction(existing, p, force);
  if (dryRun || action === 'skip') {
    return { record: p, action, pageId: existing?.pageId, ok: true };
  }

  const pageId =
    action === 'create' ? await createPage(notesDsId, p) : (await updatePage(existing!.pageId, p), existing!.pageId);

  if (p.imageCount) {
    console.warn(`  ⚠ [${p.itemKey}] 含 ${p.imageCount} 张图片未同步(v1 占位)`);
  }
  return { record: p, action, pageId, ok: true };
}

/**
 * 全量 upsert(论文粒度,按 Zotero Item Key 去重)。
 * 单篇失败不再拖垮整批:记录失败、继续下一篇,最后把失败一并报上去。
 */
export async function syncPapers(
  cfg: Config,
  papers: PaperRecord[],
  dryRun: boolean,
  force = false,
): Promise<SyncResult[]> {
  const notesDsId = cfg.notion.notesDataSourceId;
  if (!notesDsId) {
    throw new Error('config.notion.notesDataSourceId 未设置——先建好「文献」库并把 data source id 回填 config.json。');
  }

  await ntnAlive();
  await validateSchema(notesDsId);

  const existing = await fetchAllExisting(notesDsId); // 一次分页拉全库,代替 N 次 query
  const state = loadState(cfg.stateFile);
  const results: SyncResult[] = [];
  for (const p of papers) {
    try {
      const r = await upsertOne(notesDsId, p, existing.get(p.itemKey) ?? null, dryRun, force);
      results.push(r);
      if (!dryRun && r.pageId) {
        state[p.itemKey] = {
          notionPageId: r.pageId,
          contentHash: p.hash,
          lastSynced: new Date().toISOString(),
        };
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.warn(`  ✗ [${p.itemKey}] 同步失败,跳过这篇:${error}`);
      results.push({
        record: p,
        action: existing.get(p.itemKey) ? 'update' : 'create',
        ok: false,
        error,
      });
    }
  }
  if (!dryRun) saveState(cfg.stateFile, state); // 单次落盘(原子写)
  return results;
}
