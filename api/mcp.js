// Remote MCP server (Streamable HTTP, stateless, JSON responses). No AI here: the user's own Claude does the thinking.
import { tools } from '../lib/mcp-tools.js';
import { wsFromMcpKey } from '../lib/auth.js';

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg, ws) {
  const { id, method, params = {} } = msg || {};
  if (id === undefined || id === null) return null; // notification
  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'DueDesk', version: '1.0.0' },
        instructions: 'DueDesk stores invoices, payments and reminders for an Indian small business. You write and reason; DueDesk saves, calculates GST and totals, tracks dues and hosts the client-facing invoice page. Always share the invoice link after creating one.',
      });
    case 'ping': return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const t = tools.find((x) => x.name === params.name);
      if (!t) return err(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const out = await t.run(ws, params.arguments || {});
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: false });
      } catch (e) {
        return ok(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    }
    case 'resources/list': return ok(id, { resources: [] });
    case 'prompts/list': return ok(id, { prompts: [] });
    default: return err(id, -32601, `Method not found: ${method}`);
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  const ws = await wsFromMcpKey(req.query.key);
  if (!ws) return res.status(404).json({ error: 'Unknown DueDesk connector link. Copy yours from the DueDesk dashboard.' });
  if (req.method === 'GET') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Use POST (MCP Streamable HTTP).' }); }
  if (req.method === 'DELETE') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json(err(null, -32700, 'Parse error')); } }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, ws)))).filter(Boolean);
    return out.length ? res.status(200).json(out) : res.status(202).end();
  }
  const out = await handle(body, ws);
  if (!out) return res.status(202).end();
  return res.status(200).json(out);
}
