import type { ZoteroNote } from './sqlite';

// 插件生成的"伪笔记"——不是用户手写的读书笔记,不该同步到 Notion。
// 这些签名是在真实库里实测出来的(很多"笔记"其实是插件存的内部数据):
//   - Chartero 阅读历史: 父条目 citekey = "staticYueDuLiShiJiLu",笔记标题 "chartero#xxxx"
//   - 某 addon 存储项:    父条目 citekey = "AddonItem",正文是 66-218b 的小块
//   - 占位/元数据:        标题/正文 = "Do not modify or delete!"
const JUNK_CITEKEYS = new Set(['staticYueDuLiShiJiLu', 'AddonItem']);

export interface JunkVerdict {
  junk: boolean;
  reason: string;
}

export function classifyNote(note: ZoteroNote, parentCitekey: string | null): JunkVerdict {
  if (parentCitekey && JUNK_CITEKEYS.has(parentCitekey)) {
    return { junk: true, reason: `plugin-item:${parentCitekey}` };
  }
  const title = note.noteTitle?.trim() ?? '';
  if (title.startsWith('chartero#')) return { junk: true, reason: 'chartero-history' };
  if (/do not modify or delete/i.test(title)) return { junk: true, reason: 'do-not-modify' };
  // 标题为空时兜底看正文头部
  if (!title && /do not modify or delete/i.test(note.noteHtml.slice(0, 200))) {
    return { junk: true, reason: 'do-not-modify' };
  }
  return { junk: false, reason: '' };
}

export interface Partition {
  real: ZoteroNote[];
  junk: { note: ZoteroNote; reason: string }[];
}

/** 用 citekey 映射把笔记拆成"真实"和"插件垃圾"两堆。 */
export function partitionNotes(
  notes: ZoteroNote[],
  citekeys: Map<string, string | null>,
): Partition {
  const real: ZoteroNote[] = [];
  const junk: { note: ZoteroNote; reason: string }[] = [];
  for (const n of notes) {
    const ck = n.parentItemKey ? citekeys.get(n.parentItemKey) ?? null : null;
    const v = classifyNote(n, ck);
    if (v.junk) junk.push({ note: n, reason: v.reason });
    else real.push(n);
  }
  return { real, junk };
}
