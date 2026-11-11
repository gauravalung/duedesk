# DueDesk

Invoices and collections run by **your own Claude** over MCP. There is no AI inside the app.

- Claude creates GST invoices, records payments, reviews dues and writes reminder messages through the DueDesk MCP connector.
- DueDesk stores everything, does the GST and balance math, hosts a client-facing invoice page with a UPI QR, and schedules reminders.
- People can edit everything in the dashboard at `/app`.

## Connect Claude
1. Sign up at `/app` and copy your private Connector URL (`https://<host>/mcp/<key>`).
2. In Claude, go to Settings → Connectors → Add custom connector and paste the URL.
3. Say "Invoice Acme ₹50,000 for design work, 18% GST, due in 10 days".

## MCP tools
create_invoice, list_invoices, get_invoice, update_invoice, record_payment, collections_summary, save_reminder, update_business_profile

## Stack
Vercel serverless functions (Node, zero dependencies) and Upstash Redis (Vercel KV). MCP runs over Streamable HTTP (stateless JSON-RPC).
