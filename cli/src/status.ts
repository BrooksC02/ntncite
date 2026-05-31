import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { Config } from './config';
import { ntnAlive, ntnApi } from './notion/ntn';
import { bbtReady } from './zotero/citekey';

// 给菜单栏 App 的对接契约:历史记录 + --status 快照 + --doctor 健康检查。

export interface HistoryEntry {
  ts: string;
  trigger: 'auto' | 'manual' | 'force';
  create: number;
  update: number;
  skip: number;
  total: number;
  durationMs: number;
  ok: boolean;
  error?: string | null;
}

export function appendHistory(path: string, e: HistoryEntry): void {
  appendFileSync(path, JSON.stringify(e) + '\n', 'utf8');
}

/** 读最近 limit 条历史(最新在前)。 */
export function readHistory(path: string, limit = 20): HistoryEntry[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
  return lines
    .slice(-limit)
    .map((l) => {
      try {
        return JSON.parse(l) as HistoryEntry;
      } catch {
        return null;
      }
    })
    .filter((x): x is HistoryEntry => x !== null)
    .reverse();
}

/** --doctor:健康检查,输出 JSON(供菜单栏 App 的健康灯)。 */
export async function runDoctor(cfg: Config): Promise<void> {
  const out: Record<string, unknown> = {
    ts: new Date().toISOString(),
    volume: existsSync(cfg.sqlitePath),
    bbt: false,
    ntn: false,
    ntnWorkspace: null,
    notion: false,
  };
  out.bbt = Boolean(await bbtReady(cfg.bbtEndpoint));
  try {
    const a = await ntnAlive();
    out.ntn = true;
    out.ntnWorkspace = a.workspace ?? null;
  } catch {
    /* ntn 不可用 */
  }
  if (out.ntn && cfg.notion.notesDataSourceId) {
    try {
      await ntnApi(`v1/data_sources/${cfg.notion.notesDataSourceId}`, { method: 'GET' });
      out.notion = true;
    } catch {
      /* Notion 不可达 */
    }
  }
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
