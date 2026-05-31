import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 配置 / state 文件相对项目根定位，跟 cwd 无关
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface NotionConfig {
  /** 「文献笔记」库 database id（参考用） */
  notesDatabaseId?: string | null;
  /** 「文献笔记」data source id —— 同步目标（ntn 走新版 data-source API） */
  notesDataSourceId?: string | null;
  /** 题录库（文献已读）database id（参考用） */
  papersDatabaseId?: string | null;
  /** 题录库 data source id —— relation 关联对象 */
  papersDataSourceId?: string | null;
}

export interface Config {
  zoteroDataDir: string;
  sqlitePath: string;
  libraryId: number;
  bbtEndpoint: string;
  notion: NotionConfig;
  stateFile: string;
  /** --auto 变更检测:上次同步时 Zotero 笔记+题录的签名 */
  signatureFile: string;
  /** 同步历史(每次真跑追加一行 JSON),供菜单栏 App 读 */
  historyFile: string;
}

function expandHome(p: string): string {
  return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

export function loadConfig(): Config {
  const cfgPath = join(PROJECT_ROOT, 'config.json');
  const raw: Record<string, any> = existsSync(cfgPath)
    ? JSON.parse(readFileSync(cfgPath, 'utf8'))
    : {};

  const zoteroDataDir = expandHome(raw.zoteroDataDir ?? '~/Zotero');

  return {
    zoteroDataDir,
    sqlitePath: join(zoteroDataDir, 'zotero.sqlite'),
    libraryId: raw.libraryId ?? 1,
    bbtEndpoint: raw.bbtEndpoint ?? 'http://127.0.0.1:23119/better-bibtex/json-rpc',
    notion: {
      notesDatabaseId: raw.notion?.notesDatabaseId ?? null,
      notesDataSourceId: raw.notion?.notesDataSourceId ?? null,
      papersDatabaseId: raw.notion?.papersDatabaseId ?? null,
      papersDataSourceId: raw.notion?.papersDataSourceId ?? null,
    },
    stateFile: join(PROJECT_ROOT, '.sync-state.json'),
    signatureFile: join(PROJECT_ROOT, '.sync-sig'),
    historyFile: join(PROJECT_ROOT, '.sync-history.jsonl'),
  };
}
