// Tiny key-value layer over Upstash Redis REST (Vercel KV). Falls back to memory for local dev.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const mem = globalThis.__dd_mem || (globalThis.__dd_mem = { kv: new Map(), h: new Map() });

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error('store: ' + j.error);
  return j.result;
}
export const hasDb = () => Boolean(URL_ && TOKEN);

export async function get(k) {
  if (!hasDb()) return mem.kv.get(k) ?? null;
  return await redis(['GET', k]);
}
export async function set(k, v) {
  if (!hasDb()) { mem.kv.set(k, v); return; }
  await redis(['SET', k, v]);
}
export async function incr(k) {
  if (!hasDb()) { const n = Number(mem.kv.get(k) || 0) + 1; mem.kv.set(k, String(n)); return n; }
  return Number(await redis(['INCR', k]));
}
export async function hset(k, f, v) {
  if (!hasDb()) { if (!mem.h.has(k)) mem.h.set(k, new Map()); mem.h.get(k).set(f, v); return; }
  await redis(['HSET', k, f, v]);
}
export async function hget(k, f) {
  if (!hasDb()) return mem.h.get(k)?.get(f) ?? null;
  return await redis(['HGET', k, f]);
}
export async function hdel(k, f) {
  if (!hasDb()) { mem.h.get(k)?.delete(f); return; }
  await redis(['HDEL', k, f]);
}
export async function hvals(k) {
  if (!hasDb()) return [...(mem.h.get(k)?.values() || [])];
  return (await redis(['HVALS', k])) || [];
}
export const getJ = async (k) => { const v = await get(k); return v ? JSON.parse(v) : null; };
export const setJ = (k, v) => set(k, JSON.stringify(v));
