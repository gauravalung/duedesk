// Dashboard API for the human side: list, edit, pay, remind, delete, profile.
import { wsFromReq } from '../lib/auth.js';
import * as I from '../lib/invoices.js';

const base = (req) => process.env.PUBLIC_BASE_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;

export default async function handler(req, res) {
  const ws = wsFromReq(req);
  if (!ws) return res.status(401).json({ error: 'Please log in.' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const op = req.query.op || b.op;
  try {
    if (req.method === 'GET') {
      const meta = await I.getMeta(ws);
      const invoices = await I.list(ws);
      const summary = await I.summary(ws);
      return res.json({ meta: { ...meta, mcpUrl: `${base(req)}/mcp/${meta.mcpKey}` }, invoices, summary });
    }
    switch (op) {
      case 'create': return res.json(await I.create(ws, b.data, 'you'));
      case 'update': return res.json(await I.update(ws, b.id, b.data, 'you'));
      case 'pay': return res.json(await I.recordPayment(ws, b.id, b.data || {}, 'you'));
      case 'delete': await I.remove(ws, b.id); return res.json({ ok: true });
      case 'profile': return res.json(await I.updateMeta(ws, b.data || {}));
      default: return res.status(400).json({ error: 'Unknown op' });
    }
  } catch (e) { return res.status(400).json({ error: e.message }); }
}
