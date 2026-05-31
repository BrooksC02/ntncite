import { htmlToBlocks } from './convert/htmlToBlocks';
import { contentHash, isDateOnlyMarker, parseNoteDate, plainText } from './util';
import type { PaperMeta, ZoteroNote } from './zotero/sqlite';

// 一行 = 一篇论文(有笔记的 = 在读)。元数据进属性,该论文的多条笔记各自成块进正文。
export interface PaperRecord {
  /** 去重主键:父文献 item key;独立笔记用笔记自身 key */
  itemKey: string;
  /** 独立笔记(不挂在任何文献下) */
  standalone: boolean;
  citekey: string | null;
  title: string;
  authors: string;
  year: number | null;
  doi: string | null;
  publication: string | null;
  itemType: string;
  tags: string[];
  /** YYYY-MM-DD */
  dateAdded: string | null;
  zoteroUri: string;
  noteCount: number;
  imageCount: number;
  /** 聚合后的正文 blocks(每条笔记:小标题 + 内容 +(多条时)分隔线) */
  bodyBlocks: any[];
  /** 聚合正文规范化 hash,判断是否需 update */
  hash: string;
  /** 该论文最近改动时间(parent 或任一笔记 dateModified 取最大),用于「最新更新」排序;不写 Notion */
  lastModified: string | null;
}

function headingThree(text: string) {
  return {
    object: 'block' as const,
    type: 'heading_3' as const,
    heading_3: { rich_text: [{ type: 'text' as const, text: { content: text } }] },
  };
}
function dividerBlock() {
  return { object: 'block' as const, type: 'divider' as const, divider: {} };
}

/** 取一个 block 的纯文本(拼 rich_text)。 */
function blockText(b: any): string {
  const rt = b?.type ? b[b.type]?.rich_text : null;
  return Array.isArray(rt) ? rt.map((r: any) => r?.text?.content ?? r?.plain_text ?? '').join('') : '';
}
const normWs = (s: string) => s.replace(/\s+/g, ' ').trim();

function fmtAuthors(meta: PaperMeta | null): string {
  if (!meta || !meta.authors.length) return '';
  const shown = meta.authors.slice(0, 8).join(', ');
  return meta.authors.length > 8 ? `${shown} et al.` : shown;
}

/** 把(已过滤的)笔记按论文分组,组装成 PaperRecord[]。 */
export function buildPaperRecords(
  notes: ZoteroNote[],
  paperMeta: Map<string, PaperMeta>,
  citekeys: Map<string, string | null>,
): PaperRecord[] {
  const groups = new Map<string, ZoteroNote[]>();
  for (const n of notes) {
    const key = n.parentItemKey ?? n.noteKey; // 独立笔记 → 自身 key
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(n);
  }

  const records: PaperRecord[] = [];
  for (const [key, groupNotes] of groups) {
    const meta = paperMeta.get(key) ?? null;
    const standalone = !groupNotes[0].parentItemKey;

    // 每条笔记单独转换
    const converted = groupNotes.map((n) => {
      const c = htmlToBlocks(n.noteHtml);
      return {
        note: n,
        blocks: c.blocks,
        markdown: c.markdown,
        imageCount: c.imageCount,
        date: parseNoteDate(n.noteTitle),
      };
    });
    // 排序:日期升序、无日期靠后、noteKey 兜底 → hash 确定
    converted.sort(
      (a, b) =>
        (a.date ?? '9999').localeCompare(b.date ?? '9999') ||
        a.note.noteKey.localeCompare(b.note.noteKey),
    );

    // 聚合正文:多条笔记时,每条前面加小标题 + 分隔线
    const bodyBlocks: any[] = [];
    const mdParts: string[] = [];
    const multi = converted.length > 1;
    converted.forEach((cn, i) => {
      let blocks = cn.blocks;
      if (multi) {
        if (i > 0) bodyBlocks.push(dividerBlock());
        const cap = cn.date ? `🗒 ${cn.date}` : `🗒 笔记 ${i + 1}`;
        bodyBlocks.push(headingThree(cap));
        mdParts.push(`### ${cap}`);
        // 仅当笔记首行「就是个日期」(已被上面的 🗒 日期小标题代表)时,删掉这重复的首块。
        // 注释 / 无日期标题 / 正文首句等其它格式一律保留,避免误删正文(如 "LncRNA" 这种短标题块)。
        const title = (cn.note.noteTitle ?? '').trim();
        if (blocks.length && isDateOnlyMarker(title) && normWs(blockText(blocks[0])) === normWs(title)) {
          blocks = blocks.slice(1);
        }
      }
      bodyBlocks.push(...blocks);
      mdParts.push(cn.markdown);
    });

    const citekey = groupNotes[0].parentItemKey
      ? citekeys.get(groupNotes[0].parentItemKey) ?? null
      : null;
    const title =
      meta?.title?.trim() ||
      plainText(converted[0].note.noteHtml).slice(0, 80) ||
      citekey ||
      key;

    const modCandidates = [meta?.dateModified, ...groupNotes.map((n) => n.noteModified)].filter(
      (x): x is string => Boolean(x),
    );
    const lastModified = modCandidates.length
      ? modCandidates.reduce((a, b) => (a > b ? a : b))
      : null;

    records.push({
      itemKey: key,
      standalone,
      citekey,
      title,
      authors: fmtAuthors(meta),
      year: meta?.year ?? null,
      doi: meta?.doi ?? null,
      publication: meta?.publication ?? null,
      itemType: meta?.itemType ?? 'other',
      tags: (meta?.tags ?? []).map((t) => t.replace(/,/g, ' ').trim()).filter(Boolean),
      dateAdded: meta?.dateAdded ?? null,
      zoteroUri: `zotero://select/library/items/${key}`,
      noteCount: groupNotes.length,
      imageCount: converted.reduce((s, c) => s + c.imageCount, 0),
      bodyBlocks,
      hash: contentHash(mdParts.join('\n\n')),
      lastModified,
    });
  }

  // 最新更新在前;lastModified 相同 / 缺失时按 itemKey 兜底,保证顺序确定
  records.sort(
    (a, b) =>
      (b.lastModified ?? '').localeCompare(a.lastModified ?? '') ||
      a.itemKey.localeCompare(b.itemKey),
  );
  return records;
}
