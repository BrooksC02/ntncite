import { markdownToBlocks } from '@tryfabric/martian';
import TurndownService from 'turndown';

export interface Converted {
  /** Notion block JSON 数组（martian 产出） */
  blocks: any[];
  /** 笔记里的图片数（Notion 不能直接吃 data URI / 本地附件，v1 占位+计数） */
  imageCount: number;
  /** 中间产物 markdown，调试 + 算 content hash 用 */
  markdown: string;
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
});

// 图片占位：Zotero 笔记的图片是 data URI / 附件路径，Notion API 直接 append 不了。
// v1 策略：换成占位文本，数量单独统计后在日志里报。图片上传留到后续阶段。
turndown.addRule('placeholderImages', {
  filter: 'img',
  replacement: () => '〔图片未同步〕',
});

// 把一棵 block 子树拍平成一串(丢弃各自的 children),用于超深嵌套上提。
function flattenInto(children: any[], out: any[]): void {
  for (const c of children) {
    const cont = c?.type ? c[c.type] : null;
    const sub = cont && Array.isArray(cont.children) ? cont.children : null;
    if (cont && sub) delete cont.children;
    out.push(c);
    if (sub?.length) flattenInto(sub, out);
  }
}

/**
 * Notion 单次 create/append 请求最多 2 层嵌套(顶层块→子→孙,孙不能再有 children)。
 * martian 偶尔产出更深的嵌套列表,这里把超过 2 层的子项**上提为同级**(内容全保留,只少几层缩进),
 * 否则 Notion 返回 400 validation_error。level 是当前数组里元素所处的嵌套层级(顶层=0)。
 */
function clampDepth(items: any[], level: number): void {
  const append: any[] = [];
  for (const b of items) {
    const cont = b?.type ? b[b.type] : null;
    const kids = cont && Array.isArray(cont.children) ? cont.children : null;
    if (!kids?.length) continue;
    if (level < 2) {
      clampDepth(kids, level + 1);
    } else {
      // 本块已在第 2 层,不允许再有 children → 把整棵子树拍平成同级
      const flat: any[] = [];
      flattenInto(kids, flat);
      delete cont.children;
      append.push(...flat);
    }
  }
  if (append.length) items.push(...append);
}

/** HTML → markdown → Notion blocks。纯函数，不依赖外部状态。 */
export function htmlToBlocks(html: string): Converted {
  const safe = html ?? '';
  const imageCount = (safe.match(/<img\b/gi) ?? []).length;
  const markdown = turndown.turndown(safe);
  const blocks = markdownToBlocks(markdown, {
    // 自动截断到 Notion 上限（单 rich_text ≤2000 字符等），不要直接抛
    notionLimits: { truncate: true },
    // 只接受合法 http(s) 图片 URL；占位后理论上已无图片
    strictImageUrls: true,
  });
  clampDepth(blocks, 0); // 压到 ≤2 层嵌套,避免 Notion 400
  return { blocks, imageCount, markdown };
}

/** Notion 单次 append children 最多 100 个 block，长笔记按 100 分批。 */
export function chunkBlocks<T>(blocks: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < blocks.length; i += size) out.push(blocks.slice(i, i + size));
  return out;
}
