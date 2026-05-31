// 通过 Better BibTeX 官方 JSON-RPC 解析 citekey，不碰 BBT 内部 sqlite（schema 私有易变）。
// 端点默认 http://localhost:23119/better-bibtex/json-rpc，Zotero 必须开着。

export class BbtUnavailableError extends Error {}

async function rpc<T = unknown>(endpoint: string, method: string, params: unknown[]): Promise<T> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  } catch {
    throw new BbtUnavailableError(`连不上 BBT JSON-RPC (${endpoint}) —— Zotero 开着吗？`);
  }
  if (!res.ok) throw new Error(`BBT RPC ${method} 返回 HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: unknown };
  if (json.error) throw new Error(`BBT RPC ${method} 出错：${JSON.stringify(json.error)}`);
  return json.result as T;
}

export interface BbtVersion {
  zotero?: string;
  betterbibtex?: string;
}

/** 探活。可用时返回版本对象，不可用返回 null（不抛）。 */
export async function bbtReady(endpoint: string): Promise<BbtVersion | null> {
  try {
    return await rpc<BbtVersion>(endpoint, 'api.ready', []);
  } catch {
    return null;
  }
}

/**
 * 批量解析 itemKey → citekey。参数是 "<libraryID>:<itemKey>" 字符串数组。
 * 返回 Map<itemKey, citekey|null>；解析不到的为 null。
 */
export async function resolveCitekeys(
  endpoint: string,
  libraryId: number,
  itemKeys: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unique = [...new Set(itemKeys)];
  if (unique.length === 0) return out;

  const params = unique.map((k) => `${libraryId}:${k}`);
  const result = await rpc<Record<string, string | null>>(endpoint, 'item.citationkey', [params]);

  // 返回的 key 可能是 "1:ABCD" 也可能是 "ABCD"，统一剥掉 "lib:" 前缀
  for (const [k, v] of Object.entries(result ?? {})) {
    const itemKey = k.includes(':') ? k.split(':').pop()! : k;
    out.set(itemKey, v ?? null);
  }
  // 没在返回里出现的，补 null
  for (const k of unique) if (!out.has(k)) out.set(k, null);
  return out;
}
