import { byPublicId } from '../lib/invoices.js';
export default async function handler(req, res) {
  const r = await byPublicId(req.query.pid);
  if (!r) return res.status(404).json({ error: 'Invoice not found' });
  res.setHeader('Cache-Control', 'no-store');
  res.json(r);
}
