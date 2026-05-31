import { chunkBlocks } from '../convert/htmlToBlocks';
import type { Config } from '../config';
import type { PaperRecord } from '../paper';
import { loadState, saveState, type SyncState } from '../state';
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
  action: SyncAction;
  pageId?: string;
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
async function findExisting(notesDsId: string, itemKey: string): Promise<ExistingPage | null> {
  const res = await ntnApi<{ results: any[] }>(`v1/data_sources/${notesDsId}/query`, {
    method: 'POST',
    body: { filter: { property: 'Zotero Item Key', rich_text: { equals: itemKey } }, page_size: 1 },
  });
  const page = res.results?.[0];
  if (!page) return null;
  const hash = page.properties?.['Content Hash']?.rich_text?.[0]?.plain_text ?? '';
  return { pageId: page.id, hash };
}

function rich(text: string) {
  return [{ type: 'text' as const, text: { content: text } }];
}

function buildProperties(p: PaperRecord, isCreate: boolean): Record<string, any> {
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
    'Content Hash': { rich_text: rich(p.hash) },
    'Zotero Item Key': { rich_text: rich(p.itemKey) },
    'Last Synced': { date: { start: new Date().toISOString() } },
  };
  if (p.dateAdded) props['Date Added'] = { date: { start: p.dateAdded } };
  // Reading Status 只在 create 时设默认值,update 不覆盖(尊重你的手改)
  if (isCreate) props['Reading Status'] = { select: { name: 'Reading' } };
  return props;
}

async function appendBlocks(pageId: string, blocks: any[]): Promise<void> {
  for (const batch of chunkBlocks(blocks)) {
    await ntnApi(`v1/blocks/${pageId}/children`, { method: 'PATCH', body: { children: batch } });
  }
}

async function archiveChildren(pageId: string): Promise<void> {
  const res = await ntnApi<{ results: { id: string }[]; has_more: boolean }>(
    `v1/blocks/${pageId}/children`,
    { method: 'GET' },
  );
  if (res.has_more) {
    console.warn(`  ⚠ [${pageId}] 子块 >100,本次只清理前 100(仅当单篇笔记总块数 >100 时才会出现)`);
  }
  for (const b of res.results) await ntnApi(`v1/blocks/${b.id}`, { method: 'DELETE' });
}

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

/** 页面正文 = (有标题时)目录 block 置顶 + 聚合正文。无标题则不加(避免空目录)。 */
function pageBlocks(p: PaperRecord): any[] {
  return hasHeading(p.bodyBlocks) ? [tableOfContents(), ...p.bodyBlocks] : p.bodyBlocks;
}

async function createPage(notesDsId: string, p: PaperRecord): Promise<string> {
  const [first, ...rest] = chunkBlocks(pageBlocks(p));
  const page = await ntnApi<{ id: string }>('v1/pages', {
    method: 'POST',
    body: {
      parent: { type: 'data_source_id', data_source_id: notesDsId },
      properties: buildProperties(p, true),
      children: first ?? [],
    },
  });
  for (const batch of rest) await appendBlocks(page.id, batch);
  return page.id;
}

async function updatePage(pageId: string, p: PaperRecord): Promise<void> {
  await ntnApi(`v1/pages/${pageId}`, { method: 'PATCH', body: { properties: buildProperties(p, false) } });
  await archiveChildren(pageId);
  await appendBlocks(pageId, pageBlocks(p));
}

async function upsertOne(
  cfg: Config,
  p: PaperRecord,
  state: SyncState,
  dryRun: boolean,
  force: boolean,
): Promise<SyncResult> {
  const notesDsId = cfg.notion.notesDataSourceId!;
  const existing = await findExisting(notesDsId, p.itemKey);
  const action: SyncAction = !existing
    ? 'create'
    : !force && existing.hash === p.hash
      ? 'skip'
      : 'update';

  if (dryRun) return { record: p, action, pageId: existing?.pageId };

  if (action === 'skip') {
    state[p.itemKey] = {
      notionPageId: existing!.pageId,
      contentHash: p.hash,
      lastSynced: new Date().toISOString(),
    };
    return { record: p, action, pageId: existing!.pageId };
  }

  let pageId: string;
  if (action === 'create') {
    pageId = await createPage(notesDsId, p);
  } else {
    pageId = existing!.pageId;
    await updatePage(pageId, p);
  }

  state[p.itemKey] = {
    notionPageId: pageId,
    contentHash: p.hash,
    lastSynced: new Date().toISOString(),
  };
  saveState(cfg.stateFile, state);

  if (p.imageCount) {
    console.warn(`  ⚠ [${p.itemKey}] 含 ${p.imageCount} 张图片未同步(v1 占位)`);
  }
  return { record: p, action, pageId };
}

/** 全量 upsert(论文粒度,按 Zotero Item Key 去重)。 */
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

  const state = loadState(cfg.stateFile);
  const results: SyncResult[] = [];
  for (const p of papers) {
    results.push(await upsertOne(cfg, p, state, dryRun, force));
  }
  if (!dryRun) saveState(cfg.stateFile, state);
  return results;
}
