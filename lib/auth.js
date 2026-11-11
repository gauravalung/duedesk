import crypto from 'node:crypto';
import * as db from './store.js';

const SECRET = process.env.SESSION_SECRET || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || 'dev-secret';
const rand = (n = 16) => crypto.randomBytes(n).toString('hex');
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex').slice(0, 32);

export function makeToken(ws) { return `${ws}.${sign(ws)}`; }
export function wsFromToken(tok) {
  if (!tok) return null;
  const [ws, sig] = String(tok).split('.');
  if (!ws || !sig) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(sign(ws)), Buffer.from(sig.padEnd(32, '0').slice(0, 32)));
  return ok ? ws : null;
}
export function wsFromReq(req) {
  const h = req.headers.authorization || '';
  return wsFromToken(h.replace(/^Bearer\s+/i, ''));
}

export async function signup({ email, password, business }) {
  email = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email.');
  if (!password || String(password).length < 6) throw new Error('Password needs at least 6 characters.');
  if (await db.get(`user:${email}`)) throw new Error('An account with this email already exists. Log in instead.');
  const salt = rand(8);
  const ws = rand(6);
  const mcpKey = rand(12);
  await db.setJ(`user:${email}`, { email, salt, pw: hash(String(password), salt), ws });
  await db.setJ(`ws:${ws}:meta`, { business: business || 'My Business', email, mcpKey, gstin: '', address: '', upi: '', createdAt: new Date().toISOString() });
  await db.set(`mcpkey:${mcpKey}`, ws);
  return { token: makeToken(ws), ws };
}

export async function login({ email, password }) {
  email = String(email || '').trim().toLowerCase();
  const u = await db.getJ(`user:${email}`);
  if (!u || hash(String(password || ''), u.salt) !== u.pw) throw new Error('Wrong email or password.');
  return { token: makeToken(u.ws), ws: u.ws };
}

export async function wsFromMcpKey(key) {
  if (!key) return null;
  return await db.get(`mcpkey:${key}`);
}
