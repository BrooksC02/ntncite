import { createHash } from 'node:crypto';
import type { PaperMeta, ZoteroNote } from './zotero/sqlite';

/**
 * Zotero 侧快照签名(--auto 变更检测用):覆盖所有笔记的改动时间 + 所有父文献的改动时间。
 * 任一笔记或题录元数据变了 → 签名变 → 触发同步;都没变 → 秒退,不打 Notion。
 */
export function computeSignature(notes: ZoteroNote[], paperMeta: Map<string, PaperMeta>): string {
  const parts = [
    ...notes.map((n) => `n:${n.noteKey}:${n.noteModified}`),
    ...[...paperMeta.values()].map((m) => `p:${m.itemKey}:${m.dateModified ?? ''}`),
  ].sort();
  return createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex').slice(0, 16);
}

/** HTML → 纯文本（去标签 + 解常见实体 + 压空白）。标题兜底 / 预览用。 */
export function plainText(html: string): string {
  return (html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 内容 hash：对规范化后的 markdown 取 sha256 前 16 位。
 * 规范化（统一换行 / 去行尾空白 / 压多空行 / trim）保证「无实质变化」不触发 update。
 */
export function contentHash(markdown: string): string {
  const norm = (markdown ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return createHash('sha256').update(norm, 'utf8').digest('hex').slice(0, 16);
}

const DATE_ANY = /(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const DATE_ONLY = /^\s*20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}\s*$/;

/** 从笔记标题里解析日期 → ISO `YYYY-MM-DD`；解析不到返回 null。 */
export function parseNoteDate(title: string | null): string | null {
  const m = title?.match(DATE_ANY);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Notion 行标题（spec §4.1）：优先用 Zotero 笔记标题；
 * 标题为空或「纯日期」时，用 `citekey · 正文首句` 兜底（纯日期当标题没信息量）。
 */
export function buildNoteTitle(note: ZoteroNote, citekey: string | null): string {
  const t = note.noteTitle?.trim() ?? '';
  if (t && !DATE_ONLY.test(t)) return t.slice(0, 200);

  const base = citekey ?? '独立笔记';
  // 纯日期标题：用 `citekey · 日期`，干净不重复（日期本身另存在「笔记日期」属性里）
  const date = parseNoteDate(note.noteTitle);
  if (date) return `${base} · ${date}`.slice(0, 200);
  // 标题为空且无日期：兜底用正文首句
  const head = plainText(note.noteHtml).slice(0, 40);
  return (head ? `${base} · ${head}` : base).slice(0, 200);
}
