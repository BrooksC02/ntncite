import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';

// 进程级互斥锁:防止后台 launchd 自动同步与菜单栏「立即同步」(都 shell out 同一个 CLI)并发,
// 否则两进程会并发 query/建页 → 重复行,并争抢 .sync-state.json。
export interface Lock {
  release(): void;
}

function isAlive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0); // 信号 0:只探测,不真发信号
    return true;
  } catch (e) {
    // ESRCH = 进程不存在;EPERM = 存在但无权(仍算活着)
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function writePidLock(path: string): Lock | null {
  try {
    const fd = openSync(path, 'wx'); // O_CREAT|O_EXCL:已存在则抛 EEXIST
    writeSync(fd, String(process.pid));
    closeSync(fd);
    return {
      release() {
        try {
          unlinkSync(path);
        } catch {
          /* 已被清理 */
        }
      },
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    return null;
  }
}

/**
 * 抢锁。拿到返回 Lock;已被**存活**进程持有返回 null(调用方应优雅退出)。
 * 锁文件里的 pid 已死(崩溃 / 被 kill)→ 判为陈旧锁,夺过来。
 */
export function acquireLock(path: string): Lock | null {
  const lock = writePidLock(path);
  if (lock) return lock;

  // 已存在 → 看持有者是否还活着
  let pid = 0;
  try {
    pid = Number(readFileSync(path, 'utf8').trim()) || 0;
  } catch {
    /* 读不到当陈旧处理 */
  }
  if (isAlive(pid)) return null; // 真有人在跑

  // 陈旧锁:删掉再抢一次
  try {
    unlinkSync(path);
  } catch {
    /* 竞争窗口:别人刚抢走 */
  }
  return writePidLock(path);
}
