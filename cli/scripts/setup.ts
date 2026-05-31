import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ntnAlive, ntnApi } from '../src/notion/ntn';

// 一键建库:在 Notion 里创建「Library」数据库(schema 跟 sync 要求完全一致),
// 把返回的 data source id 写回 config.json。用法:pnpm setup-db <notion-parent-page-id>

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 跟 src/notion/sync.ts 的 REQUIRED_PROPS 一一对应,别改名。
const PROPERTIES: Record<string, unknown> = {
  Name: { title: {} },
  Authors: { rich_text: {} },
  Year: { number: {} },
  DOI: { rich_text: {} },
  Publication: { rich_text: {} },
  Citekey: { rich_text: {} },
  'Item Type': {
    select: {
      options: [
        { name: 'journalArticle' },
        { name: 'preprint' },
        { name: 'conferencePaper' },
        { name: 'book' },
        { name: 'other' },
      ],
    },
  },
  Tags: { multi_select: { options: [] } },
  'Zotero URI': { url: {} },
  'Reading Status': {
    select: {
      options: [{ name: 'Reading' }, { name: 'Done' }, { name: 'Noted' }, { name: 'Unread' }],
    },
  },
  'Note Count': { number: {} },
  'Date Added': { date: {} },
  'Content Hash': { rich_text: {} },
  'Zotero Item Key': { rich_text: {} },
  'Last Synced': { date: {} },
};

// 接受裸 ID(带/不带连字符)或粘贴的 Notion 页面 URL,统一抽出 32 位十六进制 ID。
function normalizePageId(input: string): string {
  const s = input.trim();
  const dashed = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (dashed) return dashed[0].replace(/-/g, '');
  const runs = s.match(/[0-9a-f]{32}/gi); // URL 里 ID 是末尾一段连续 32 位 hex
  if (runs) return runs[runs.length - 1];
  throw new Error(`这不像 Notion 页面 ID 或 URL:「${input}」\n粘贴页面 URL,或 32 位十六进制 ID 都行。`);
}

async function main() {
  const rawParent = process.argv[2];
  if (!rawParent) {
    console.error(
      '用法: pnpm setup-db <notion-parent-page-id>\n' +
        '  在 Notion 里建/选一个页面(把 ntn 的 integration 连上它),把页面 ID 或 URL 传进来;' +
        '「Library」库会建在该页面下。',
    );
    process.exit(1);
  }
  const parent = normalizePageId(rawParent);

  await ntnAlive();
  console.log('→ 在 Notion 创建「Library」数据库…');
  const db = await ntnApi<any>('v1/databases', {
    method: 'POST',
    body: {
      parent: { type: 'page_id', page_id: parent },
      title: [{ type: 'text', text: { content: 'Library' } }],
      initial_data_source: { properties: PROPERTIES },
    },
  });

  // 解析 data source id(不同 API 版本字段位置可能不同,挨个兜底)
  let dsId: string | undefined =
    db?.data_sources?.[0]?.id ?? db?.initial_data_source?.id ?? db?.data_source_id;
  if (!dsId && db?.id) {
    const full = await ntnApi<any>(`v1/databases/${db.id}`, { method: 'GET' });
    dsId = full?.data_sources?.[0]?.id;
  }
  if (!dsId) {
    console.error('建库成功但没解析到 data source id。原始响应:\n' + JSON.stringify(db, null, 2).slice(0, 800));
    process.exit(1);
  }

  console.log(`✓ 数据库已建:${db.url ?? db.id}`);
  console.log(`✓ data source id:${dsId}`);

  const cfgPath = join(ROOT, 'config.json');
  const examplePath = join(ROOT, 'config.example.json');
  const cfg = JSON.parse(readFileSync(existsSync(cfgPath) ? cfgPath : examplePath, 'utf8'));
  cfg.notion = cfg.notion ?? {};
  cfg.notion.notesDataSourceId = dsId;
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log(`✓ 已写入 ${cfgPath}`);
  console.log('\n下一步:确认 config.json 里的 zoteroDataDir,然后 `pnpm sync --dry-run`。');
}

main().catch((e) => {
  console.error('\n✗ 出错:', e instanceof Error ? e.message : e);
  process.exit(1);
});
