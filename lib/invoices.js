import crypto from 'node:crypto';
import * as db from './store.js';

const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST date
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

export const getMeta = (ws) => db.getJ(`ws:${ws}:meta`);
export async function updateMeta(ws, patch) {
  const m = (await getMeta(ws)) || {};
  for (const k of ['business', 'gstin', 'address', 'upi', 'email']) if (patch[k] !== undefined) m[k] = String(patch[k]);
  await db.setJ(`ws:${ws}:meta`, m);
  return m;
}

function cleanItems(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('Add at least one line item (description, qty, rate).');
  return items.map((it) => ({
    description: String(it.description || it.name || 'Item').slice(0, 200),
    qty: Number(it.qty ?? it.quantity ?? 1) || 1,
    rate: r2(it.rate ?? it.price ?? it.amount ?? 0),
  }));
}

export function compute(inv) {
  const subtotal = r2(inv.items.reduce((s, it) => s + it.qty * it.rate, 0));
  const discount = r2(inv.discount || 0);
  const taxable = r2(Math.max(0, subtotal - discount));
  const gst = r2((taxable * (Number(inv.gstPercent) || 0)) / 100);
  const total = r2(taxable + gst);
  const paid = r2((inv.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0));
  const balance = r2(Math.max(0, total - paid));
  let status = inv.status;
  const t = today();
  if (status !== 'cancelled' && status !== 'draft') {
    if (balance <= 0) status = 'paid';
    else if (paid > 0) status = inv.dueDate < t ? 'overdue' : 'part-paid';
    else status = inv.dueDate < t ? 'overdue' : 'sent';
  }
  const daysOverdue = status === 'overdue' ? Math.round((new Date(t) - new Date(inv.dueDate)) / 864e5) : 0;
  return { ...inv, subtotal, discount, taxable, gst, total, paid, balance, status, daysOverdue };
}

const fmt = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const money = fmt;

function defaultReminders(due) {
  return [
    { id: crypto.randomBytes(4).toString('hex'), date: addDays(due, -3), label: 'Friendly heads-up (3 days before due)', message: '', channel: 'whatsapp', sent: false },
    { id: crypto.randomBytes(4).toString('hex'), date: due, label: 'Due today', message: '', channel: 'whatsapp', sent: false },
    { id: crypto.randomBytes(4).toString('hex'), date: addDays(due, 7), label: 'Firm follow-up (7 days late)', message: '', channel: 'email', sent: false },
  ];
}

export async function listRaw(ws) {
  const vals = await db.hvals(`ws:${ws}:inv`);
  return vals.map((v) => JSON.parse(v));
}
export async function list(ws, { status, client } = {}) {
  let all = (await listRaw(ws)).map(compute);
  if (client) all = all.filter((i) => i.client.name.toLowerCase().includes(String(client).toLowerCase()));
  if (status && status !== 'all') {
    if (status === 'unpaid') all = all.filter((i) => i.balance > 0 && !['draft', 'cancelled'].includes(i.status));
    else all = all.filter((i) => i.status === status);
  }
  return all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function find(ws, ref) {
  ref = String(ref || '').trim();
  let raw = await db.hget(`ws:${ws}:inv`, ref);
  if (raw) return JSON.parse(raw);
  const all = await listRaw(ws);
  const norm = ref.toUpperCase().replace(/^#/, '');
  return all.find((i) => i.number.toUpperCase() === norm || i.number.toUpperCase().endsWith('-' + norm.padStart(4, '0'))) || null;
}

async function save(ws, inv) {
  inv.updatedAt = new Date().toISOString();
  await db.hset(`ws:${ws}:inv`, inv.id, JSON.stringify(inv));
  return compute(inv);
}

const log = (inv, by, action) => { (inv.activity ||= []).unshift({ at: new Date().toISOString(), by, action }); inv.activity = inv.activity.slice(0, 50); };

export async function create(ws, a, by = 'claude') {
  if (!a.client_name && !a.client?.name) throw new Error('client_name is required.');
  const n = await db.incr(`ws:${ws}:seq`);
  const id = crypto.randomBytes(6).toString('hex');
  const publicId = crypto.randomBytes(9).toString('base64url');
  const issueDate = isDate(a.issue_date) ? a.issue_date : today();
  const dueDate = isDate(a.due_date) ? a.due_date : addDays(issueDate, Number(a.due_in_days) || 15);
  const inv = {
    id, publicId, number: `INV-${String(n).padStart(4, '0')}`,
    client: { name: String(a.client_name || a.client?.name), email: String(a.client_email || a.client?.email || ''), phone: String(a.client_phone || a.client?.phone || '') },
    items: cleanItems(a.items), gstPercent: Number(a.gst_percent ?? 18), discount: r2(a.discount || 0),
    issueDate, dueDate, notes: String(a.notes || ''), status: a.status === 'draft' ? 'draft' : 'sent',
    payments: [], reminders: defaultReminders(dueDate), activity: [], createdAt: new Date().toISOString(), createdVia: by,
  };
  log(inv, by, `Created ${inv.number} for ${inv.client.name}`);
  await db.set(`pub:${publicId}`, `${ws}:${id}`);
  return save(ws, inv);
}

export async function update(ws, ref, a, by = 'claude') {
  const inv = await find(ws, ref);
  if (!inv) throw new Error(`No invoice found for "${ref}".`);
  const changed = [];
  if (a.client_name !== undefined) { inv.client.name = String(a.client_name); changed.push('client'); }
  if (a.client_email !== undefined) { inv.client.email = String(a.client_email); changed.push('email'); }
  if (a.client_phone !== undefined) { inv.client.phone = String(a.client_phone); changed.push('phone'); }
  if (a.client && typeof a.client === 'object') { Object.assign(inv.client, a.client); changed.push('client'); }
  if (a.items !== undefined) { inv.items = cleanItems(a.items); changed.push('line items'); }
  if (a.gst_percent !== undefined) { inv.gstPercent = Number(a.gst_percent); changed.push('GST'); }
  if (a.discount !== undefined) { inv.discount = r2(a.discount); changed.push('discount'); }
  if (a.notes !== undefined) { inv.notes = String(a.notes); changed.push('notes'); }
  if (a.issue_date !== undefined && isDate(a.issue_date)) { inv.issueDate = a.issue_date; changed.push('issue date'); }
  if (a.due_date !== undefined && isDate(a.due_date) && a.due_date !== inv.dueDate) {
    inv.dueDate = a.due_date; changed.push('due date');
    const old = inv.reminders || [];
    inv.reminders = defaultReminders(a.due_date).map((r, i) => ({ ...r, message: old[i]?.message || '' }));
  }
  if (a.status !== undefined && ['draft', 'sent', 'cancelled'].includes(a.status)) { inv.status = a.status; changed.push(`status → ${a.status}`); }
  if (Array.isArray(a.reminders)) { inv.reminders = a.reminders; changed.push('reminders'); }
  if (Array.isArray(a.payments)) { inv.payments = a.payments; changed.push('payments'); }
  log(inv, by, `Edited ${changed.join(', ') || 'nothing'}`);
  return save(ws, inv);
}

export async function remove(ws, ref) {
  const inv = await find(ws, ref);
  if (!inv) throw new Error('Not found');
  await db.hdel(`ws:${ws}:inv`, inv.id);
  return true;
}

export async function recordPayment(ws, ref, a, by = 'claude') {
  const inv = await find(ws, ref);
  if (!inv) throw new Error(`No invoice found for "${ref}".`);
  const c = compute(inv);
  const amount = a.amount === undefined || a.amount === null || a.amount === '' ? c.balance : r2(a.amount);
  if (amount <= 0) throw new Error('Nothing left to pay on this invoice.');
  inv.payments.push({ amount, date: isDate(a.date) ? a.date : today(), method: String(a.method || 'UPI'), note: String(a.note || '') });
  if (inv.status === 'draft') inv.status = 'sent';
  log(inv, by, `Recorded payment of ${fmt(amount)}`);
  return save(ws, inv);
}

export async function saveReminder(ws, ref, a, by = 'claude') {
  const inv = await find(ws, ref);
  if (!inv) throw new Error(`No invoice found for "${ref}".`);
  inv.reminders ||= [];
  const msg = String(a.message || '').trim();
  if (!msg) throw new Error('message is required.');
  const pending = a.reminder_id ? inv.reminders.find((r) => r.id === a.reminder_id) : inv.reminders.find((r) => !r.sent && !r.message);
  if (pending) {
    pending.message = msg; if (a.channel) pending.channel = a.channel; if (isDate(a.date)) pending.date = a.date;
  } else {
    inv.reminders.push({ id: crypto.randomBytes(4).toString('hex'), date: isDate(a.date) ? a.date : today(), label: 'Custom reminder', message: msg, channel: a.channel || 'whatsapp', sent: false });
  }
  log(inv, by, 'Saved a reminder message');
  return save(ws, inv);
}

export async function summary(ws) {
  const all = (await list(ws)).filter((i) => !['draft', 'cancelled'].includes(i.status));
  const t = today();
  const weekEnd = addDays(t, 7);
  const monthStart = t.slice(0, 8) + '01';
  const outstanding = all.filter((i) => i.balance > 0);
  const overdue = outstanding.filter((i) => i.status === 'overdue').sort((a, b) => b.daysOverdue - a.daysOverdue);
  const dueThisWeek = outstanding.filter((i) => i.status !== 'overdue' && i.dueDate <= weekEnd);
  const paidThisMonth = r2(all.flatMap((i) => i.payments).filter((p) => p.date >= monthStart).reduce((s, p) => s + p.amount, 0));
  const byClient = {};
  for (const i of outstanding) byClient[i.client.name] = r2((byClient[i.client.name] || 0) + i.balance);
  const remindersDue = all.flatMap((i) => (i.reminders || []).filter((r) => !r.sent && r.date <= t && i.balance > 0).map((r) => ({ invoice: i.number, client: i.client.name, reminder: r.label, date: r.date, hasMessage: Boolean(r.message) })));
  return {
    today: t,
    outstandingTotal: r2(outstanding.reduce((s, i) => s + i.balance, 0)),
    overdueTotal: r2(overdue.reduce((s, i) => s + i.balance, 0)),
    paidThisMonth,
    overdue: overdue.map((i) => ({ number: i.number, client: i.client.name, balance: i.balance, dueDate: i.dueDate, daysOverdue: i.daysOverdue })),
    dueThisWeek: dueThisWeek.map((i) => ({ number: i.number, client: i.client.name, balance: i.balance, dueDate: i.dueDate })),
    byClient: Object.entries(byClient).sort((a, b) => b[1] - a[1]).map(([client, balance]) => ({ client, balance })),
    remindersDue,
  };
}

export async function byPublicId(pid) {
  const ref = await db.get(`pub:${pid}`);
  if (!ref) return null;
  const [ws, id] = ref.split(':');
  const raw = await db.hget(`ws:${ws}:inv`, id);
  if (!raw) return null;
  const meta = await getMeta(ws);
  const inv = compute(JSON.parse(raw));
  delete inv.activity; delete inv.reminders;
  return { invoice: inv, business: { name: meta.business, gstin: meta.gstin, address: meta.address, upi: meta.upi, email: meta.email } };
}
