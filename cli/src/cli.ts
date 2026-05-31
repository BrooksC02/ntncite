import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config';
import { buildPaperRecords, type PaperRecord } from './paper';
import { syncPapers, findOrphans, type SyncResult } from './notion/sync';
import { acquireLock } from './lock';
import { loadSignature, loadState, saveSignature } from './state';
import { appendHistory, readHistory, runDoctor, type HistoryEntry } from './status';
import { computeSignature, plainText } from './util';
import { partitionNotes } from './zotero/filter';
import { bbtReady, resolveCitekeys } from './zotero/citekey';
import { readZoteroData, type ZoteroNote } from './zotero/sqlite';

interface Args {
  dryRun: boolean;
  inspect: boolean;
  blocks: boolean;
  audit: boolean;
  json: boolean;
  force: boolean;
  auto: boolean;
  status: boolean;
  doctor: boolean;
  list: boolean;
  orphans: boolean;
  showJunk: boolean;
  noteKey?: string;
  citekey?: string;
  limit?: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    dryRun: false,
    inspect: false,
    blocks: false,
    audit: false,
    json: false,
    force: false,
    auto: false,
    status: false,
    doctor: false,
    list: false,
    orphans: false,
    showJunk: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dry-run') a.dryRun = true;
    else if (t === '--inspect') a.inspect = true;
    else if (t === '--blocks') a.blocks = true;
    else if (t === '--audit') a.audit = true;
    else if (t === '--json') a.json = true;
    else if (t === '--force') a.force = true;
    else if (t === '--auto') a.auto = true;
    else if (t === '--status') a.status = true;
    else if (t === '--doctor') a.doctor = true;
    else if (t === '--list') a.list = true;
    else if (t === '--orphans') a.orphans = true;
    else if (t === '--show-junk') a.showJunk = true;
    else if (t === '--note-key') a.noteKey = argv[++i];
    else if (t === '--citekey') a.citekey = argv[++i];
    else if (t === '--limit') a.limit = Number(argv[++i]);
  }
  return a;
}

/** block 数组 → ASCII-safe 的类型序列(run-length),终端不会因 CJK 错位 */
function blockTypeSeq(blocks: any[]): string {
  const runs: string[] = [];
  for (const b of blocks) {
    const t = b?.type ?? '?';
    const last = runs[runs.length - 1];
    const m = last?.match(/^(.*)×(\d+)$/);
    if (m && m[1] === t) runs[runs.length - 1] = `${t}×${Number(m[2]) + 1}`;
    else if (last === t) runs[runs.length - 1] = `${t}×2`;
    else runs.push(t);
  }
  return runs.join(', ');
}

// ───────────────────────── 诊断: 读取 + 过滤 + 分组 ─────────────────────────
function inspectReport(
  papers: PaperRecord[],
  junk: { note: ZoteroNote; reason: string }[],
  noteTotal: number,
  limit: number,
  showJunk: boolean,
) {
  const reasons = new Map<string, number>();
  for (const j of junk) reasons.set(j.reason, (reasons.get(j.reason) ?? 0) + 1);
  const realNotes = papers.reduce((s, p) => s + p.noteCount, 0);

  console.log('\n=== 读取 / 过滤 / 分组 ===');
  console.log(`原始笔记: ${noteTotal}  →  真实: ${realNotes}(插件垃圾 ${junk.length})  →  归并成 ${papers.length} 篇论文`);
  console.log('垃圾来源:');
  for (const [r, c] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r.padEnd(26)} ${c}`);
  }
  const withMeta = papers.filter((p) => !p.standalone).length;
  console.log(`\n论文: 挂在文献下 ${withMeta},独立笔记 ${papers.length - withMeta}`);
  console.log(`\n前 ${Math.min(limit, papers.length)} 篇:`);
  for (const p of papers.slice(0, limit)) {
    const tag = p.standalone ? '(独立)' : p.citekey ?? '∅无citekey';
    console.log(`  • [${p.itemKey}] ${tag}  ${p.noteCount}条笔记  「${p.title.slice(0, 44)}」`);
  }
  if (showJunk) {
    console.log(`\n[--show-junk] 垃圾笔记前 20 条:`);
    for (const { note: n, reason } of junk.slice(0, 20)) {
      console.log(`  ✗ [${n.noteKey}] ${reason}`);
    }
  }
}

// ───────────────────────── 诊断: 转换审计 ─────────────────────────
function auditReport(papers: PaperRecord[]) {
  const hist = new Map<string, number>();
  let maxBlocks = 0;
  let maxKey = '';
  let withImages = 0;
  for (const p of papers) {
    if (p.bodyBlocks.length > maxBlocks) [maxBlocks, maxKey] = [p.bodyBlocks.length, p.itemKey];
    if (p.imageCount > 0) withImages++;
    for (const b of p.bodyBlocks) hist.set(b?.type ?? '?', (hist.get(b?.type ?? '?') ?? 0) + 1);
  }
  console.log('\n=== 转换审计(论文粒度,聚合后正文)===');
  console.log(`论文: ${papers.length}`);
  console.log(`最大块数: ${maxBlocks} (论文 ${maxKey}) → ${maxBlocks > 100 ? '需分批' : '单批即可'}`);
  console.log(`含图片: ${withImages} 篇`);
  console.log('块类型分布:');
  for (const [t, c] of [...hist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(22)} ${c}`);
  }
}

// ───────────────────────── 诊断: 单篇正文预览落盘 ─────────────────────────
function blocksPreview(papers: PaperRecord[]) {
  const target = [...papers].sort((a, b) => b.bodyBlocks.length - a.bodyBlocks.length)[0];
  if (!target) {
    console.log('没有论文可预览。');
    return;
  }
  console.log('\n=== 正文预览(块最多的一篇)===');
  console.log(`itemKey: ${target.itemKey}  citekey: ${target.citekey ?? '(独立)'}  笔记: ${target.noteCount}`);
  console.log(`block 数: ${target.bodyBlocks.length}`);
  console.log(`block 序列: ${blockTypeSeq(target.bodyBlocks)}`);
  const jsonPath = join(tmpdir(), `paper-${target.itemKey}.json`);
  writeFileSync(jsonPath, JSON.stringify(target.bodyBlocks, null, 2), 'utf8');
  console.log(`\nblocks 已落盘:${jsonPath}`);
}

// ───────────────────────── 同步结果报告 ─────────────────────────
function reportSync(results: SyncResult[], dryRun: boolean) {
  const tally = { create: 0, update: 0, skip: 0 };
  let failed = 0;
  console.log(`\n=== ${dryRun ? '同步计划 (--dry-run,不写 Notion)' : '同步结果'} ===`);
  for (const r of results) {
    const p = r.record;
    const tag = p.standalone ? '独立' : p.citekey ?? '∅';
    const meta = p.standalone ? '' : p.year ? `${p.year}` : '⚠无题录';
    if (r.ok) {
      tally[r.action]++;
      console.log(`  ${r.action.padEnd(6)} [${p.itemKey}] ${tag} ${meta}  「${p.title.slice(0, 34)}」 ${p.noteCount}条`);
    } else {
      failed++;
      console.log(`  ✗FAIL  [${p.itemKey}] ${tag} ${meta}  「${p.title.slice(0, 34)}」 — ${r.error ?? ''}`);
    }
  }
  const tail = failed ? ` · 失败 ${failed}` : '';
  console.log(`\n合计: create ${tally.create} · update ${tally.update} · skip ${tally.skip}${tail}(共 ${results.length} 篇)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();

  // --doctor:健康检查,独立快路径(不读 sqlite),JSON 到 stdout
  if (args.doctor) {
    await runDoctor(cfg);
    return;
  }

  console.error(`[zotero] 数据库: ${cfg.sqlitePath}`);
  const { notes: allNotes, paperMeta } = readZoteroData(cfg.sqlitePath);
  console.error(`[zotero] 读到 ${allNotes.length} 条原始笔记,${paperMeta.size} 篇父文献元数据`);

  // --auto:Zotero 侧无变化就秒退,不打 Notion(自动任务空跑近乎零成本)
  const signature = computeSignature(allNotes, paperMeta);
  if (args.auto && loadSignature(cfg.signatureFile) === signature) {
    console.error('[auto] Zotero 笔记/题录无变化,跳过');
    return;
  }

  let notes = allNotes;
  if (args.noteKey) notes = notes.filter((n) => n.noteKey === args.noteKey);

  // citekey 解析(过滤插件垃圾 + 关联都要用)
  const citekeys = new Map<string, string | null>();
  const ready = await bbtReady(cfg.bbtEndpoint);
  if (ready) {
    console.error(`[bbt] alive —— zotero ${ready.zotero} / bbt ${ready.betterbibtex}`);
    const parentKeys = notes.map((n) => n.parentItemKey).filter((k): k is string => Boolean(k));
    for (const [k, v] of await resolveCitekeys(cfg.bbtEndpoint, cfg.libraryId, parentKeys)) {
      citekeys.set(k, v);
    }
  } else {
    console.error('[bbt] ⚠ 连不上(Zotero 没开?)—— citekey 留空,垃圾过滤只靠标题签名');
  }

  // --auto + Zotero 没开:优雅跳过(exit 0),不报错刷屏
  if (args.auto && !ready) {
    console.error('[auto] Zotero/BBT 未就绪,跳过本次');
    return;
  }

  // 过滤插件垃圾
  const { real, junk } = partitionNotes(notes, citekeys);

  // 可选:按 citekey 收窄
  let realFiltered = real;
  if (args.citekey) {
    realFiltered = real.filter((n) => n.parentItemKey && citekeys.get(n.parentItemKey) === args.citekey);
  }

  // 按论文分组
  const papers = buildPaperRecords(realFiltered, paperMeta, citekeys);

  // --status:给菜单栏 App 的快照(JSON 到 stdout,不写 Notion)
  if (args.status) {
    const last = readHistory(cfg.historyFile, 1)[0] ?? null;
    const st = loadState(cfg.stateFile);
    let pendingNew = 0;
    let pendingChanged = 0;
    for (const p of papers) {
      const cached = st[p.itemKey];
      if (!cached) pendingNew++;
      else if (cached.contentHash !== p.hash) pendingChanged++;
    }
    process.stdout.write(
      JSON.stringify(
        {
          ts: new Date().toISOString(),
          pending: loadSignature(cfg.signatureFile) !== signature,
          pendingNew,
          pendingChanged,
          papers: papers.length,
          notes: papers.reduce((s, p) => s + p.noteCount, 0),
          health: { zoteroBbt: Boolean(ready), volume: existsSync(cfg.sqlitePath) },
          lastRun: last,
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  // --list:给菜单栏 App 的条目清单(轻量,不含 blocks;含 notionPageId 便于深链)
  if (args.list) {
    const st = loadState(cfg.stateFile);
    const lite = papers.map((p) => {
      const cached = st[p.itemKey];
      const syncState = !cached ? 'new' : cached.contentHash === p.hash ? 'synced' : 'changed';
      return {
        itemKey: p.itemKey,
        title: p.title,
        citekey: p.citekey,
        year: p.year,
        noteCount: p.noteCount,
        imageCount: p.imageCount,
        authors: p.authors,
        publication: p.publication,
        standalone: p.standalone,
        notionPageId: cached?.notionPageId ?? null,
        syncState,
      };
    });
    process.stdout.write(JSON.stringify(lite, null, 2) + '\n');
    return;
  }

  // --orphans:查 Notion 里已无 Zotero 对应的孤儿页(按需,会查一次 Notion)
  if (args.orphans) {
    const currentKeys = new Set(papers.map((p) => p.itemKey));
    const orphans = await findOrphans(cfg, currentKeys);
    process.stdout.write(JSON.stringify(orphans, null, 2) + '\n');
    return;
  }

  // 诊断模式(只读,不碰 Notion)
  if (args.inspect) {
    inspectReport(papers, junk, notes.length, args.limit ?? 20, args.showJunk);
    return;
  }
  if (args.audit) {
    auditReport(papers);
    return;
  }
  if (args.blocks) {
    blocksPreview(papers);
    return;
  }
  if (args.json) {
    process.stdout.write(JSON.stringify(papers, null, 2) + '\n');
    return;
  }

  // 同步需要 citekey / 元数据(Zotero 没开就拿不到),不静默降级
  if (!ready) {
    throw new Error(
      'BBT JSON-RPC 连不上(Zotero 没开 / Better BibTeX 没装)——\n' +
        '同步需要 Zotero 在线(读题录元数据 + citekey),已中止。\n' +
        '只想看读取/转换诊断的话,用 --inspect / --audit / --blocks。',
    );
  }
  const trigger: HistoryEntry['trigger'] = args.auto ? 'auto' : args.force ? 'force' : 'manual';

  // 真要写 Notion 了 → 抢进程锁,防止与后台自动同步并发(dry-run 只读,不抢锁)
  const lock = args.dryRun ? { release() {} } : acquireLock(cfg.lockFile);
  if (!lock) {
    console.error('[lock] 另一个同步正在进行,跳过本次');
    return;
  }

  const t0 = Date.now();
  try {
    let results: SyncResult[];
    try {
      results = await syncPapers(cfg, papers, args.dryRun, args.force);
    } catch (e) {
      if (!args.dryRun) {
        appendHistory(cfg.historyFile, {
          ts: new Date().toISOString(),
          trigger,
          create: 0,
          update: 0,
          skip: 0,
          total: papers.length,
          durationMs: Date.now() - t0,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      throw e;
    }
    const durationMs = Date.now() - t0;
    reportSync(results, args.dryRun);

    if (!args.dryRun) {
      const tally = { create: 0, update: 0, skip: 0 };
      for (const r of results) if (r.ok) tally[r.action]++;
      const failures = results
        .filter((r) => !r.ok)
        .map((r) => ({
          itemKey: r.record.itemKey,
          title: r.record.title.slice(0, 80),
          error: (r.error ?? '').slice(0, 200),
        }));
      appendHistory(cfg.historyFile, {
        ts: new Date().toISOString(),
        trigger,
        create: tally.create,
        update: tally.update,
        skip: tally.skip,
        total: results.length,
        durationMs,
        ok: failures.length === 0,
        error: failures.length ? `${failures.length} 篇同步失败` : null,
        failures: failures.length ? failures : undefined,
      });
      // 全部成功才记签名(手动 / 自动一致),下次 --auto 无变化即可秒退;
      // 有失败则不记 → 下次仍判定有变化、自动重试失败的那几篇。
      if (failures.length === 0) saveSignature(cfg.signatureFile, signature);
      else process.exitCode = 1; // 有失败:非零退出,但已完成的不回滚
    }
  } finally {
    lock.release();
  }
}

main().catch((e) => {
  console.error('\n✗ 出错:', e instanceof Error ? e.message : e);
  process.exit(1);
});
