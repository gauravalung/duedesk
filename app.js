const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fdate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
let TOKEN = localStorage.getItem('dd_token');
let STATE = null;
function toast(m) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(() => (t.style.display = 'none'), 2600); }

async function api(method, body) {
  const r = await fetch('/api/data' + (method === 'GET' ? '' : ''), { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (r.status === 401) { logout(); throw new Error('Please log in again'); }
  if (!r.ok) throw new Error(j.error || 'Something went wrong');
  return j;
}
function logout() { localStorage.removeItem('dd_token'); TOKEN = null; renderAuth(); }

function renderAuth() {
  $('#topright').innerHTML = '';
  const signup = location.hash === '#signup';
  $('#root').innerHTML = `<div class="card" style="max-width:420px;margin:60px auto">
   <h2>${signup ? 'Create your desk' : 'Log in to DueDesk'}</h2>
   ${signup ? '<label>Business name</label><input id="biz" placeholder="e.g. Riya Design Studio">' : ''}
   <label>Email</label><input id="em" type="email" autocomplete="username">
   <label>Password</label><input id="pw" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}">
   <div class="row" style="margin-top:16px"><button class="btn" id="go">${signup ? 'Create account' : 'Log in'}</button>
   <a class="right small" href="#${signup ? 'login' : 'signup'}" id="sw">${signup ? 'Have an account? Log in' : 'New here? Create a desk'}</a></div>
   <p class="small muted" id="err"></p></div>`;
  $('#sw').onclick = () => setTimeout(renderAuth, 0);
  $('#go').onclick = async () => {
    const r = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: signup ? 'signup' : 'login', email: $('#em').value, password: $('#pw').value, business: $('#biz')?.value }) });
    const j = await r.json();
    if (!r.ok) return ($('#err').textContent = j.error);
    TOKEN = j.token; localStorage.setItem('dd_token', TOKEN); location.hash = ''; load();
  };
}

async function load() {
  if (!TOKEN) return renderAuth();
  try { STATE = await api('GET'); } catch (e) { return; }
  render();
  const id = location.hash.slice(1);
  if (id && STATE.invoices.find((i) => i.id === id)) openInvoice(id);
}

function pill(s) { return `<span class="pill s-${s}">${s.replace('-', ' ')}</span>`; }

function render() {
  const { meta, invoices, summary } = STATE;
  $('#topright').innerHTML = `<span class="small muted">${esc(meta.business)}</span><button class="btn ghost sm" id="prof">Business profile</button><button class="btn sm" id="newinv">+ New invoice</button><button class="btn ghost sm" id="lo">Log out</button>`;
  $('#lo').onclick = logout; $('#newinv').onclick = () => openInvoice(null); $('#prof').onclick = openProfile;
  const fromClaude = invoices.filter((i) => i.createdVia === 'claude').length;
  $('#root').innerHTML = `
  <div class="grid g4">
    <div class="card stat"><div class="k">Outstanding</div><div class="v">${inr(summary.outstandingTotal)}</div></div>
    <div class="card stat"><div class="k">Overdue</div><div class="v" style="color:var(--bad)">${inr(summary.overdueTotal)}</div></div>
    <div class="card stat"><div class="k">Collected this month</div><div class="v" style="color:var(--ok)">${inr(summary.paidThisMonth)}</div></div>
    <div class="card stat"><div class="k">Reminders due today</div><div class="v">${summary.remindersDue.length}</div></div>
  </div>
  <div class="card" style="margin-top:14px">
    <div class="row"><h2 style="margin:0">Connect your Claude</h2><span class="small muted">${fromClaude} of ${invoices.length} invoices created by Claude</span></div>
    <p class="small muted" style="margin:8px 0">Paste this private Connector URL in Claude → Settings → Connectors → <b>Add custom connector</b>. Keep it secret, since anyone with it can manage your invoices.</p>
    <div class="row"><div class="code" style="flex:1" id="mcpurl">${esc(meta.mcpUrl)}</div><button class="btn ghost sm" id="cp">Copy</button></div>
    <p class="small muted" style="margin:8px 0 0">Try saying: <i>"Invoice Acme ₹50,000 for website design, 18% GST, due in 10 days"</i> or <i>"Who owes me money? Draft reminders for anyone overdue."</i></p>
  </div>
  <div class="card" style="margin-top:14px">
    <div class="row"><h2 style="margin:0">Invoices</h2><select id="flt" style="width:auto" class="right"><option value="all">All</option><option value="unpaid">Unpaid</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="draft">Draft</option></select></div>
    <table><thead><tr><th>No.</th><th>Client</th><th>Issued</th><th>Due</th><th>Total</th><th>Balance</th><th>Status</th></tr></thead><tbody id="rows"></tbody></table>
    ${invoices.length ? '' : '<p class="muted small" style="text-align:center;padding:20px">No invoices yet. Ask Claude to create one, or click + New invoice.</p>'}
  </div>`;
  $('#cp').onclick = () => { navigator.clipboard.writeText(meta.mcpUrl); toast('Connector URL copied'); };
  const draw = () => {
    const f = $('#flt').value;
    const list = invoices.filter((i) => f === 'all' || (f === 'unpaid' ? i.balance > 0 && !['draft', 'cancelled'].includes(i.status) : i.status === f));
    $('#rows').innerHTML = list.map((i) => `<tr class="click" data-id="${i.id}"><td><b>${i.number}</b>${i.createdVia === 'claude' ? '<span class="tag">via Claude</span>' : ''}</td><td>${esc(i.client.name)}</td><td>${fdate(i.issueDate)}</td><td>${fdate(i.dueDate)}${i.daysOverdue ? `<div class="small" style="color:var(--bad)">${i.daysOverdue} days late</div>` : ''}</td><td>${inr(i.total)}</td><td>${inr(i.balance)}</td><td>${pill(i.status)}</td></tr>`).join('');
    document.querySelectorAll('tr.click').forEach((tr) => (tr.onclick = () => openInvoice(tr.dataset.id)));
  };
  $('#flt').onchange = draw; draw();
}

function closeDrawer() { $('#drawer').classList.remove('open'); history.replaceState(null, '', '/app'); }
$('#drawer').onclick = (e) => { if (e.target.id === 'drawer') closeDrawer(); };

function openProfile() {
  const m = STATE.meta;
  $('#panel').innerHTML = `<div class="row"><h2>Business profile</h2><button class="btn ghost sm right" id="x">Close</button></div>
  <p class="small muted">Printed on every invoice. Add a UPI ID to show a scan-to-pay QR.</p>
  <label>Business name</label><input id="p_b" value="${esc(m.business)}"><label>GSTIN</label><input id="p_g" value="${esc(m.gstin)}">
  <label>Address</label><textarea id="p_a" rows="2">${esc(m.address)}</textarea><label>UPI ID</label><input id="p_u" value="${esc(m.upi)}" placeholder="yourname@okicici">
  <label>Billing email</label><input id="p_e" value="${esc(m.email)}"><div class="row" style="margin-top:14px"><button class="btn" id="sv">Save</button></div>`;
  $('#drawer').classList.add('open'); $('#x').onclick = closeDrawer;
  $('#sv').onclick = async () => { await api('POST', { op: 'profile', data: { business: $('#p_b').value, gstin: $('#p_g').value, address: $('#p_a').value, upi: $('#p_u').value, email: $('#p_e').value } }); toast('Saved'); closeDrawer(); load(); };
}

function itemRow(it = { description: '', qty: 1, rate: 0 }) {
  return `<tr><td><input class="d" value="${esc(it.description)}" placeholder="Description"></td><td style="width:80px"><input class="q" type="number" step="any" value="${it.qty}"></td><td style="width:130px"><input class="r" type="number" step="any" value="${it.rate}"></td><td style="width:110px" class="amt"></td><td style="width:36px"><button class="btn ghost sm del">×</button></td></tr>`;
}

function openInvoice(id) {
  const inv = id ? STATE.invoices.find((i) => i.id === id) : null;
  const d = inv || { client: { name: '', email: '', phone: '' }, items: [{ description: '', qty: 1, rate: 0 }], gstPercent: 18, discount: 0, notes: '', dueDate: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), issueDate: new Date().toISOString().slice(0, 10), status: 'sent', reminders: [], payments: [], activity: [] };
  if (id) history.replaceState(null, '', '/app#' + id);
  const pub = inv ? `${location.origin}/i/${inv.publicId}` : '';
  $('#panel').innerHTML = `
  <div class="row"><h2 style="margin:0">${inv ? inv.number : 'New invoice'} ${inv ? pill(inv.status) : ''}</h2>${inv && inv.createdVia === 'claude' ? '<span class="tag">created by Claude</span>' : ''}<button class="btn ghost sm right" id="x">Close</button></div>
  ${inv ? `<div class="row small" style="margin:10px 0"><a class="btn ghost sm" href="${pub}" target="_blank">Open client view</a><button class="btn ghost sm" id="cpl">Copy client link</button><span class="muted">Balance <b>${inr(inv.balance)}</b> of ${inr(inv.total)}</span></div>` : ''}
  <div class="grid g2"><div><label>Client name</label><input id="c_n" value="${esc(d.client.name)}"></div><div><label>Client email</label><input id="c_e" value="${esc(d.client.email)}"></div>
  <div><label>Client WhatsApp (with country code)</label><input id="c_p" value="${esc(d.client.phone)}" placeholder="9198xxxxxxxx"></div><div><label>Status</label><select id="st">${['draft', 'sent', 'cancelled'].map((s) => `<option ${(inv ? (['draft', 'cancelled'].includes(inv.status) ? inv.status : 'sent') : 'sent') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
  <div><label>Issue date</label><input id="i_d" type="date" value="${d.issueDate}"></div><div><label>Due date</label><input id="d_d" type="date" value="${d.dueDate}"></div></div>
  <label>Line items</label><table class="items"><thead><tr><th>Description</th><th>Qty</th><th>Rate (₹)</th><th>Amount</th><th></th></tr></thead><tbody id="items">${d.items.map(itemRow).join('')}</tbody></table>
  <button class="btn ghost sm" id="addit" style="margin-top:6px">+ Add item</button>
  <div class="grid g2"><div><label>GST %</label><select id="gst">${[0, 5, 12, 18, 28].map((g) => `<option ${Number(d.gstPercent) === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div><div><label>Discount (₹, before GST)</label><input id="disc" type="number" value="${d.discount || 0}"></div></div>
  <div class="small" id="tot" style="text-align:right;margin-top:10px"></div>
  <label>Notes / payment terms</label><textarea id="nt" rows="2">${esc(d.notes)}</textarea>
  <div class="row" style="margin-top:14px"><button class="btn" id="save">${inv ? 'Save changes' : 'Create invoice'}</button>${inv ? '<button class="btn red sm right" id="delinv">Delete</button>' : ''}</div>
  ${inv ? `
  <hr style="border:0;border-top:1px solid var(--line);margin:22px 0">
  <h2>Payments</h2>
  ${inv.payments.length ? `<table><tr><th>Date</th><th>Amount</th><th>Method</th><th></th></tr>${inv.payments.map((p, k) => `<tr><td>${fdate(p.date)}</td><td>${inr(p.amount)}</td><td>${esc(p.method)}</td><td><button class="btn ghost sm rmp" data-k="${k}">Remove</button></td></tr>`).join('')}</table>` : '<p class="small muted">No payments yet.</p>'}
  ${inv.balance > 0 ? `<div class="row" style="margin-top:8px"><input id="pa" type="number" placeholder="Amount (blank = full ${inr(inv.balance)})" style="flex:1"><select id="pm" style="width:120px"><option>UPI</option><option>NEFT</option><option>Cash</option><option>Card</option><option>Cheque</option></select><button class="btn green sm" id="pay">Record payment</button></div>` : ''}
  <hr style="border:0;border-top:1px solid var(--line);margin:22px 0">
  <h2>Reminders</h2><p class="small muted">Scheduled automatically. Ask Claude to "draft reminders", then review the text here and send it in one tap.</p>
  <div id="rems">${(inv.reminders || []).map((r, k) => `<div class="card" style="margin-bottom:10px;padding:12px"><div class="row small"><b>${esc(r.label)}</b><span class="muted">${fdate(r.date)}</span><select class="rc" data-k="${k}" style="width:auto"><option ${r.channel === 'whatsapp' ? 'selected' : ''}>whatsapp</option><option ${r.channel === 'email' ? 'selected' : ''}>email</option></select><label class="right" style="margin:0"><input type="checkbox" class="rs" data-k="${k}" ${r.sent ? 'checked' : ''} style="width:auto"> sent</label></div>
    <textarea class="rm" data-k="${k}" rows="3" style="margin-top:8px" placeholder="No message yet. Ask Claude to write one, or type it here.">${esc(r.message)}</textarea>
    <div class="row" style="margin-top:6px"><button class="btn ghost sm rsend" data-k="${k}">Send via ${r.channel === 'email' ? 'email' : 'WhatsApp'}</button></div></div>`).join('')}</div>
  <button class="btn ghost sm" id="saverem">Save reminders</button>
  <hr style="border:0;border-top:1px solid var(--line);margin:22px 0">
  <h2>Activity</h2><div class="small">${(inv.activity || []).map((a) => `<div style="padding:4px 0"><span class="tag" style="margin:0 6px 0 0">${a.by === 'claude' ? 'Claude' : 'You'}</span>${esc(a.action)} <span class="muted">· ${new Date(a.at).toLocaleString('en-IN')}</span></div>`).join('')}</div>` : ''}`;
  $('#drawer').classList.add('open'); $('#x').onclick = closeDrawer;
  const recalc = () => {
    let sub = 0;
    document.querySelectorAll('#items tr').forEach((tr) => { const a = (+tr.querySelector('.q').value || 0) * (+tr.querySelector('.r').value || 0); sub += a; tr.querySelector('.amt').textContent = inr(a); });
    const taxable = Math.max(0, sub - (+$('#disc').value || 0)); const g = taxable * (+$('#gst').value) / 100;
    $('#tot').innerHTML = `Subtotal ${inr(sub)} · GST ${inr(g)} · <b>Total ${inr(taxable + g)}</b>`;
  };
  const bindItems = () => { document.querySelectorAll('#items input').forEach((i) => (i.oninput = recalc)); document.querySelectorAll('#items .del').forEach((b) => (b.onclick = () => { b.closest('tr').remove(); recalc(); })); };
  bindItems(); recalc(); $('#gst').onchange = recalc; $('#disc').oninput = recalc;
  $('#addit').onclick = () => { $('#items').insertAdjacentHTML('beforeend', itemRow()); bindItems(); recalc(); };
  const collect = () => ({
    client_name: $('#c_n').value, client_email: $('#c_e').value, client_phone: $('#c_p').value, status: $('#st').value,
    issue_date: $('#i_d').value, due_date: $('#d_d').value, gst_percent: +$('#gst').value, discount: +$('#disc').value || 0, notes: $('#nt').value,
    items: [...document.querySelectorAll('#items tr')].map((tr) => ({ description: tr.querySelector('.d').value, qty: +tr.querySelector('.q').value || 1, rate: +tr.querySelector('.r').value || 0 })).filter((x) => x.description || x.rate),
  });
  $('#save').onclick = async () => { try { const r = inv ? await api('POST', { op: 'update', id: inv.id, data: collect() }) : await api('POST', { op: 'create', data: collect() }); toast(inv ? 'Saved' : 'Invoice created'); await load(); openInvoice(r.id); } catch (e) { toast(e.message); } };
  if (!inv) return;
  $('#cpl').onclick = () => { navigator.clipboard.writeText(pub); toast('Client link copied'); };
  $('#delinv').onclick = async () => { if (!confirm('Delete ' + inv.number + '?')) return; await api('POST', { op: 'delete', id: inv.id }); closeDrawer(); load(); };
  $('#pay') && ($('#pay').onclick = async () => { await api('POST', { op: 'pay', id: inv.id, data: { amount: $('#pa').value, method: $('#pm').value } }); toast('Payment recorded'); await load(); openInvoice(inv.id); });
  document.querySelectorAll('.rmp').forEach((b) => (b.onclick = async () => { const p = inv.payments.filter((_, k) => k !== +b.dataset.k); await api('POST', { op: 'update', id: inv.id, data: { payments: p } }); await load(); openInvoice(inv.id); }));
  const remState = () => inv.reminders.map((r, k) => ({ ...r, message: document.querySelector(`.rm[data-k="${k}"]`).value, channel: document.querySelector(`.rc[data-k="${k}"]`).value, sent: document.querySelector(`.rs[data-k="${k}"]`).checked }));
  $('#saverem').onclick = async () => { await api('POST', { op: 'update', id: inv.id, data: { reminders: remState() } }); toast('Reminders saved'); await load(); openInvoice(inv.id); };
  document.querySelectorAll('.rsend').forEach((b) => (b.onclick = async () => {
    const k = +b.dataset.k; const rs = remState(); const r = rs[k];
    const text = (r.message || `Hi ${inv.client.name}, a reminder that ${inv.number} for ${inr(inv.balance)} is due on ${fdate(inv.dueDate)}.`) + `\n\nView and pay: ${pub}`;
    if (r.channel === 'email') window.open(`mailto:${encodeURIComponent(inv.client.email)}?subject=${encodeURIComponent('Payment reminder: ' + inv.number)}&body=${encodeURIComponent(text)}`);
    else window.open(`https://wa.me/${(inv.client.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank');
    rs[k].sent = true; await api('POST', { op: 'update', id: inv.id, data: { reminders: rs } }); await load(); openInvoice(inv.id);
  }));
}
window.addEventListener('hashchange', () => { if (!TOKEN) renderAuth(); });
load();
