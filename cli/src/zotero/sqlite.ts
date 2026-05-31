import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ZoteroNote {
  /** 笔记正文 HTML */
  noteHtml: string;
  /** 笔记自身的 item key */
  noteKey: string;
  /** 修改时间(Zotero UTC 字符串) */
  noteModified: string;
  /** 父文献 item key;独立笔记为 null */
  parentItemKey: string | null;
  libraryId: number;
  /** Zotero 给笔记生成的标题(常是首行或日期),可能为 null */
  noteTitle: string | null;
}

/** 一篇论文的题录元数据(从 zotero.sqlite 读)。 */
export interface PaperMeta {
  itemKey: string;
  itemType: string;
  title: string | null;
  /** 作者,已格式化为 "Lastname X" */
  authors: string[];
  year: number | null;
  doi: string | null;
  publication: string | null;
  /** 加入日期 YYYY-MM-DD */
  dateAdded: string | null;
  /** Zotero 改动时间(变更检测用,不写 Notion) */
  dateModified: string | null;
  tags: string[];
}

/**
 * 安全打开 Zotero 库:运行时数据库被 WAL 锁,把 zotero.sqlite 连同 -wal/-shm 拷到临时目录,
 * 只读打开拷贝,用完删临时目录。
 */
function withDb<T>(sqlitePath: string, fn: (db: Database.Database) => T): T {
  if (!existsSync(sqlitePath)) {
    throw new Error(
      `找不到 zotero.sqlite:${sqlitePath}\n请检查 config.json 里的 zoteroDataDir(外置卷没挂载?)。`,
    );
  }
  const tmp = mkdtempSync(join(tmpdir(), 'zotsync-'));
  const dst = join(tmp, 'zotero.sqlite');
  try {
    copyFileSync(sqlitePath, dst);
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(sqlitePath + suffix)) copyFileSync(sqlitePath + suffix, dst + suffix);
    }
    const db = new Database(dst, { readonly: true, fileMustExist: true });
    try {
      return fn(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function readNotesFromDb(db: Database.Database): ZoteroNote[] {
  return db
    .prepare(
      `SELECT
         n.note          AS noteHtml,
         ni.key          AS noteKey,
         ni.dateModified AS noteModified,
         pi.key          AS parentItemKey,
         ni.libraryID    AS libraryId,
         n.title         AS noteTitle
       FROM itemNotes n
       JOIN items ni ON ni.itemID = n.itemID
       LEFT JOIN items pi ON pi.itemID = n.parentItemID
       WHERE ni.itemID NOT IN (SELECT itemID FROM deletedItems)`,
    )
    .all() as ZoteroNote[];
}

/** 取名字首字母缩写:"Soma" → "S","Jane Mary" → "JM"。 */
function initials(first: string | null): string {
  if (!first) return '';
  return first
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((t) => t[0]?.toUpperCase() ?? '')
    .join('');
}

function readPaperMetaFromDb(db: Database.Database, itemKeys: string[]): Map<string, PaperMeta> {
  const out = new Map<string, PaperMeta>();
  const uniq = [...new Set(itemKeys)];
  if (!uniq.length) return out;

  const itemStmt = db.prepare(
    `SELECT it.itemID AS itemID, it.dateAdded AS dateAdded, it.dateModified AS dateModified, t.typeName AS typeName
     FROM items it JOIN itemTypes t ON t.itemTypeID = it.itemTypeID
     WHERE it.key = ?`,
  );
  const fieldStmt = db.prepare(
    `SELECT f.fieldName AS name, idv.value AS value
     FROM itemData id
     JOIN fields f ON f.fieldID = id.fieldID
     JOIN itemDataValues idv ON idv.valueID = id.valueID
     WHERE id.itemID = ?`,
  );
  const authorStmt = db.prepare(
    `SELECT c.lastName AS lastName, c.firstName AS firstName, c.fieldMode AS fieldMode
     FROM itemCreators ic
     JOIN creators c ON c.creatorID = ic.creatorID
     JOIN creatorTypes ct ON ct.creatorTypeID = ic.creatorTypeID
     WHERE ic.itemID = ? AND ct.creatorType = 'author'
     ORDER BY ic.orderIndex`,
  );
  const tagStmt = db.prepare(
    `SELECT tg.name AS name
     FROM itemTags itg JOIN tags tg ON tg.tagID = itg.tagID
     WHERE itg.itemID = ? ORDER BY tg.name`,
  );

  for (const key of uniq) {
    const item = itemStmt.get(key) as
      | { itemID: number; dateAdded: string; dateModified: string; typeName: string }
      | undefined;
    if (!item) continue;
    const fields: Record<string, string> = {};
    for (const f of fieldStmt.all(item.itemID) as { name: string; value: string }[]) {
      fields[f.name] = f.value;
    }
    const authors = (
      authorStmt.all(item.itemID) as { lastName: string | null; firstName: string | null; fieldMode: number }[]
    ).map((c) =>
      c.fieldMode === 1
        ? (c.lastName ?? '').trim()
        : `${c.lastName ?? ''}${c.firstName ? ' ' + initials(c.firstName) : ''}`.trim(),
    ).filter(Boolean);
    const yearMatch = (fields['date'] ?? '').match(/(\d{4})/);
    const tags = (tagStmt.all(item.itemID) as { name: string }[]).map((t) => t.name);

    out.set(key, {
      itemKey: key,
      itemType: item.typeName,
      title: fields['title'] ?? null,
      authors,
      year: yearMatch ? Number(yearMatch[1]) : null,
      doi: fields['DOI'] ?? null,
      publication:
        fields['publicationTitle'] ??
        fields['proceedingsTitle'] ??
        fields['bookTitle'] ??
        fields['websiteTitle'] ??
        null,
      dateAdded: item.dateAdded ? item.dateAdded.slice(0, 10) : null,
      dateModified: item.dateModified ?? null,
      tags,
    });
  }
  return out;
}

/** 一次打开,读出所有笔记 + 它们父文献的题录元数据。 */
export function readZoteroData(sqlitePath: string): {
  notes: ZoteroNote[];
  paperMeta: Map<string, PaperMeta>;
} {
  return withDb(sqlitePath, (db) => {
    const notes = readNotesFromDb(db);
    const parentKeys = notes.map((n) => n.parentItemKey).filter((k): k is string => Boolean(k));
    const paperMeta = readPaperMetaFromDb(db, parentKeys);
    return { notes, paperMeta };
  });
}

/** 只读笔记(诊断用,back-compat)。 */
export function readNotes(sqlitePath: string): ZoteroNote[] {
  return withDb(sqlitePath, readNotesFromDb);
}
