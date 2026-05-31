import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * 本地同步状态（spec §7）：note_key → Notion 页 id + 内容 hash + 时间。
 * 作用是「缓存」：命中且 hash 未变可跳过、连 Notion query 都省。
 * 权威去重依据仍是 Notion 侧的 `Zotero Note Key` 属性——state 丢了也能靠它恢复不重复建页。
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
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
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
