import { signup, login } from '../lib/auth.js';
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  try {
    const r = b.mode === 'signup' ? await signup(b) : await login(b);
    res.status(200).json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
}
