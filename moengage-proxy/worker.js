// Unstop SEO › MoEngage proxy (Cloudflare Worker).
//
// Keeps the MoEngage API key on the server and passes through only three read-only calls of the
// Custom Dashboards API. A caller must send a Google access token (from signing in to the Unstop SEO
// app) that can open the Unstop Search Console property or the Unstop GA4 property; anyone else is
// refused. Nothing is stored.
//
// Secrets / variables (wrangler secret put … or the Cloudflare dashboard):
//   MOE_WORKSPACE_ID   MoEngage Workspace ID (App ID)                       — secret
//   MOE_API_KEY        API key with "Dashboard & Analyze" access             — secret
//   MOE_DC             data centre: 01, 02, 03, 04, 05, 06 or 101 (default 01)
//   ALLOWED_ORIGINS    comma-separated, e.g. https://mayanktyagi20290.github.io
//   GSC_PROPERTY       e.g. sc-domain:unstop.com
//   GA4_PROPERTY       GA4 property ID (numbers only), optional second way to prove access

const ROUTES = [
  [/^\/dashboards$/, () => '/v5/analytics/dashboards'],
  [/^\/dashboards\/([A-Za-z0-9_-]{1,64})\/charts$/, m => `/v5/analytics/dashboards/${m[1]}/charts`],
  [/^\/dashboards\/([A-Za-z0-9_-]{1,64})\/charts\/([A-Za-z0-9_-]{1,64})$/, m => `/v5/analytics/dashboards/${m[1]}/charts/${m[2]}`]
];
const DCS = ['01', '02', '03', '04', '05', '06', '101'];
const OK_CACHE = new Map(); // token hash → expiry (per isolate, short-lived)

function cors(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return ok ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '600', Vary: 'Origin' } : null;
}
const json = (status, body, h) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(h || {}) } });

async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }

// The token must open the configured Search Console property (or GA4 property).
async function allowed(token, env) {
  const key = await sha(token);
  const hit = OK_CACHE.get(key);
  if (hit && hit > Date.now()) return true;
  const auth = { Authorization: 'Bearer ' + token };
  let ok = false;
  if (env.GSC_PROPERTY) {
    const r = await fetch('https://www.googleapis.com/webmasters/v3/sites', { headers: auth });
    if (r.ok) { const d = await r.json(); ok = (d.siteEntry || []).some(s => s.siteUrl === env.GSC_PROPERTY && s.permissionLevel !== 'siteUnverifiedUser'); }
  }
  if (!ok && env.GA4_PROPERTY) {
    const r = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', { headers: auth });
    if (r.ok) { const d = await r.json(); ok = (d.accountSummaries || []).some(a => (a.propertySummaries || []).some(p => p.property === 'properties/' + env.GA4_PROPERTY)); }
  }
  if (ok) { OK_CACHE.set(key, Date.now() + 10 * 60 * 1000); if (OK_CACHE.size > 500) OK_CACHE.clear(); }
  return ok;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const h = cors(origin, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: h ? 204 : 403, headers: h || {} });
    if (!h) return json(403, { message: 'This origin is not allowed. Add it to ALLOWED_ORIGINS.' });
    if (req.method !== 'GET') return json(405, { message: 'Read-only proxy.' }, h);
    const url = new URL(req.url);
    if (url.pathname === '/health') return json(200, { ok: true, dc: env.MOE_DC || '01', configured: !!(env.MOE_WORKSPACE_ID && env.MOE_API_KEY) }, h);
    const route = ROUTES.map(([rx, fn]) => { const m = url.pathname.match(rx); return m && fn(m); }).find(Boolean);
    if (!route) return json(404, { message: 'Unknown path.' }, h);
    const tok = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!tok) return json(401, { message: 'Sign in with Google in the Unstop SEO app first.' }, h);
    if (!(await allowed(tok, env))) return json(403, { message: 'This Google account cannot open the Unstop Search Console or GA4 property, so MoEngage data is not shared with it.' }, h);
    if (!env.MOE_WORKSPACE_ID || !env.MOE_API_KEY) return json(500, { message: 'The proxy has no MoEngage credentials yet (MOE_WORKSPACE_ID, MOE_API_KEY).' }, h);
    const dc = DCS.includes(String(env.MOE_DC)) ? String(env.MOE_DC) : '01';
    const q = url.searchParams.get('cache') === 'false' ? '?cache=false' : '';
    const r = await fetch(`https://api-${dc}.moengage.com${route}${q}`, {
      headers: { Authorization: 'Basic ' + btoa(env.MOE_WORKSPACE_ID + ':' + env.MOE_API_KEY), 'MOE-APPKEY': env.MOE_WORKSPACE_ID, Accept: 'application/json' }
    });
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store', ...h } });
  }
};
