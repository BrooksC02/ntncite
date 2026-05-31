import { execFile } from 'node:child_process';

// 通过 ntn CLI 调 Notion 公共 API。ntn 以用户本人身份认证(ntn login)，
// 不需要 integration token，且走新版 data-source API。
export class NtnError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 串行节流：Notion 限速约 3 req/s，按 ~350ms 间隔留余量。单次脚本跑，模块级状态足够。
let lastCall = 0;
async function throttle(minGapMs = 350): Promise<void> {
  const wait = Math.max(0, lastCall + minGapMs - Date.now());
  if (wait) await sleep(wait);
  lastCall = Date.now();
}

interface RawResult {
  stdout: string;
  stderr: string;
  code: number;
  notFound: boolean;
}

function spawnNtn(args: string[]): Promise<RawResult> {
  return new Promise((resolve) => {
    const child = execFile(
      'ntn',
      args,
      { maxBuffer: 128 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
        const notFound = e?.code === 'ENOENT';
        const code = typeof e?.code === 'number' ? e.code : e ? 1 : 0;
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code, notFound });
      },
    );
    // 关键：立刻给 stdin 发 EOF。否则 ntn 对带 body 的请求会一直阻塞等 stdin 输入。
    child.stdin?.end();
  });
}

export interface NtnOpts {
  /** 显式 HTTP 方法。多方法端点(如 PATCH /v1/pages/{id})必须传，否则 ntn 报错。 */
  method?: string;
  /** JSON 请求体。 */
  body?: unknown;
}

// 这些信号判定为"可重试"：限流 / 网关瞬时错误 / 服务不可用。
const RETRIABLE = /rate.?limited|"status"\s*:\s*(429|502|503|504)|conflict_error|service_unavailable|internal_server_error/i;

/** 调 ntn 公共 API。成功返回解析后的 JSON；失败抛 NtnError（限流/瞬时错误自动退避重试）。 */
export async function ntnApi<T = any>(path: string, opts: NtnOpts = {}): Promise<T> {
  const args = ['api', path];
  if (opts.method) args.push('-X', opts.method);
  if (opts.body !== undefined) args.push('-d', JSON.stringify(opts.body));

  const maxRetry = 5;
  for (let attempt = 0; ; attempt++) {
    await throttle();
    const r = await spawnNtn(args);

    if (r.notFound) {
      throw new NtnError('找不到 ntn 命令——没装或不在 PATH。先装好 Notion CLI(ntn)。');
    }

    if (r.code === 0) {
      const out = r.stdout.trim();
      if (!out) return undefined as T; // 某些 DELETE 可能无 body
      try {
        return JSON.parse(out) as T;
      } catch {
        throw new NtnError(`ntn ${path} 返回的不是 JSON：\n${out.slice(0, 400)}`);
      }
    }

    const blob = `${r.stdout}\n${r.stderr}`.trim();
    if (attempt < maxRetry && RETRIABLE.test(blob)) {
      const backoff = Math.min(2000 * 2 ** attempt, 16000);
      console.warn(`[ntn] ${path} 限流/瞬时错误，${backoff}ms 后重试 (${attempt + 1}/${maxRetry})`);
      await sleep(backoff);
      continue;
    }
    throw new NtnError(`ntn ${path} 失败 (exit ${r.code})：\n${blob.slice(0, 600)}`);
  }
}

/** 探活 + 确认 ntn 已登录、Notion API 可达。返回 workspace 名。 */
export async function ntnAlive(): Promise<{ workspace?: string }> {
  const me = await ntnApi<any>('v1/users/me', { method: 'GET' });
  return { workspace: me?.bot?.workspace_name };
}
