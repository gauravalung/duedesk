import * as I from './invoices.js';

const base = () => process.env.PUBLIC_BASE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000');
const link = (inv) => `${base()}/i/${inv.publicId}`;
const brief = (i) => ({ number: i.number, client: i.client.name, total: i.total, paid: i.paid, balance: i.balance, status: i.status, issueDate: i.issueDate, dueDate: i.dueDate, daysOverdue: i.daysOverdue, link: link(i) });
const full = (i) => ({ ...brief(i), id: i.id, client: i.client, items: i.items, gstPercent: i.gstPercent, discount: i.discount, subtotal: i.subtotal, gst: i.gst, notes: i.notes, payments: i.payments, reminders: i.reminders, editInApp: `${base()}/app#${i.id}` });

const itemSchema = { type: 'object', properties: { description: { type: 'string' }, qty: { type: 'number' }, rate: { type: 'number', description: 'Price per unit in INR, before GST' } }, required: ['description', 'rate'] };
const invRef = { type: 'string', description: 'Invoice number like INV-0003 (or just 3), or invoice id' };

export const tools = [
  {
    name: 'create_invoice',
    description: 'Create a real invoice in DueDesk. Use when the user asks to bill or invoice a client. Returns a shareable client link and the edit link. GST defaults to 18%; due date defaults to 15 days from issue. DueDesk auto-schedules 3 payment reminders.',
    inputSchema: { type: 'object', properties: {
      client_name: { type: 'string' }, client_email: { type: 'string' }, client_phone: { type: 'string', description: 'With country code, for WhatsApp reminders' },
      items: { type: 'array', items: itemSchema, minItems: 1 },
      gst_percent: { type: 'number', description: '0, 5, 12, 18 or 28' }, discount: { type: 'number', description: 'Flat INR discount before GST' },
      issue_date: { type: 'string', description: 'YYYY-MM-DD' }, due_date: { type: 'string', description: 'YYYY-MM-DD' }, due_in_days: { type: 'number' },
      notes: { type: 'string', description: 'Payment terms or a thank-you note printed on the invoice' },
      status: { type: 'string', enum: ['draft', 'sent'] },
    }, required: ['client_name', 'items'] },
    run: async (ws, a) => { const i = await I.create(ws, a, 'claude'); return { message: `Created ${i.number} for ${i.client.name}: ${I.money(i.total)} due ${i.dueDate}.`, invoice: full(i) }; },
  },
  {
    name: 'list_invoices',
    description: 'List invoices, optionally filtered by status (unpaid, overdue, paid, part-paid, sent, draft, cancelled, all) or client name.',
    inputSchema: { type: 'object', properties: { status: { type: 'string' }, client: { type: 'string' } } },
    run: async (ws, a) => { const l = await I.list(ws, a); return { count: l.length, invoices: l.map(brief) }; },
  },
  {
    name: 'get_invoice',
    description: 'Get one invoice with line items, payments and reminder schedule.',
    inputSchema: { type: 'object', properties: { invoice: invRef }, required: ['invoice'] },
    run: async (ws, a) => { const i = await I.find(ws, a.invoice); if (!i) throw new Error(`No invoice "${a.invoice}".`); return full(I.compute(i)); },
  },
  {
    name: 'update_invoice',
    description: 'Edit an invoice. Pass only the fields to change. "items" replaces all line items. status can be draft, sent or cancelled (paid is set by recording payments).',
    inputSchema: { type: 'object', properties: {
      invoice: invRef, client_name: { type: 'string' }, client_email: { type: 'string' }, client_phone: { type: 'string' },
      items: { type: 'array', items: itemSchema }, gst_percent: { type: 'number' }, discount: { type: 'number' },
      issue_date: { type: 'string' }, due_date: { type: 'string' }, notes: { type: 'string' }, status: { type: 'string', enum: ['draft', 'sent', 'cancelled'] },
    }, required: ['invoice'] },
    run: async (ws, a) => { const { invoice, ...rest } = a; const i = await I.update(ws, invoice, rest, 'claude'); return { message: `Updated ${i.number}.`, invoice: full(i) }; },
  },
  {
    name: 'record_payment',
    description: 'Record money received against an invoice. Omit amount to mark it fully paid.',
    inputSchema: { type: 'object', properties: { invoice: invRef, amount: { type: 'number' }, date: { type: 'string' }, method: { type: 'string', description: 'UPI, NEFT, cash, card...' }, note: { type: 'string' } }, required: ['invoice'] },
    run: async (ws, a) => { const { invoice, ...rest } = a; const i = await I.recordPayment(ws, invoice, rest, 'claude'); return { message: `${i.number}: paid ${I.money(i.paid)} of ${I.money(i.total)}, balance ${I.money(i.balance)} (${i.status}).`, invoice: brief(i) }; },
  },
  {
    name: 'collections_summary',
    description: 'Cash-collection snapshot: total outstanding, overdue invoices oldest first, what falls due this week, money owed by client, and reminders due today. Use for "who owes me money?" or a weekly collections review.',
    inputSchema: { type: 'object', properties: {} },
    run: async (ws) => I.summary(ws),
  },
  {
    name: 'save_reminder',
    description: 'Save a payment-reminder message you wrote for an invoice into DueDesk, so the owner can review, edit and send it from the app (WhatsApp or email in one tap). Fills the next unwritten scheduled reminder unless reminder_id is given.',
    inputSchema: { type: 'object', properties: { invoice: invRef, message: { type: 'string' }, channel: { type: 'string', enum: ['whatsapp', 'email'] }, date: { type: 'string' }, reminder_id: { type: 'string' } }, required: ['invoice', 'message'] },
    run: async (ws, a) => { const { invoice, ...rest } = a; const i = await I.saveReminder(ws, invoice, rest, 'claude'); return { message: `Reminder saved on ${i.number}. The owner can edit and send it from ${base()}/app#${i.id}`, reminders: i.reminders }; },
  },
  {
    name: 'update_business_profile',
    description: 'Set the seller details printed on every invoice: business name, GSTIN, address, and UPI ID (adds a scan-to-pay QR on invoices).',
    inputSchema: { type: 'object', properties: { business: { type: 'string' }, gstin: { type: 'string' }, address: { type: 'string' }, upi: { type: 'string', description: 'e.g. name@okicici' }, email: { type: 'string' } } },
    run: async (ws, a) => ({ message: 'Business profile saved.', profile: await I.updateMeta(ws, a) }),
  },
];
