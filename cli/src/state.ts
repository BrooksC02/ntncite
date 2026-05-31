import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * 本地同步状态：itemKey → Notion 页 id + 内容 hash + 时间。
 * 仅作记录 / 给菜单栏 `--list` 提供 notionPageId;**权威去重依据是 Notion 侧的
 * `Zotero Item Key` 属性**(每次同步分页拉全库比对),state 丢了也能恢复、不会重复建页。
 */
export interface StateEntry {
  notionPageId: string;
  contentHash: string;
  lastSynced: string;
}
export type SyncState = Record<string, StateEntry>;

export function loadState(path: string): SyncState {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SyncState;
  } catch {
    console.warn(`[state] ${path} 解析失败，按空状态处理（Notion 侧去重仍生效）`);
    return {};
  }
}

export function saveState(path: string, state: SyncState): void {
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, path); // 原子替换:并发 / 崩溃不会留半截文件
}

/** --auto 变更签名:上次同步成功时 Zotero 侧的快照 hash。 */
export function loadSignature(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8').trim() || null;
  } catch {
    return null;
  }
}
export function saveSignature(path: string, sig: string): void {
  writeFileSync(path, sig, 'utf8');
}
