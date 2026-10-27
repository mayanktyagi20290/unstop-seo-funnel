// MoEngage live data (Custom Dashboards API): turns chart responses into plain tables and reads funnel
// metrics from them using the mappings saved in Funnel setup. Pure functions only (no DOM, no network),
// so they can be tested in Node. The network calls live in unstop-view.js.
(function (root) {
  'use strict';

  // MoEngage data centres → API host. The workspace's data centre is shown in the dashboard URL
  // (dashboard-01, dashboard-02 …) and under Settings › Account › APIs.
  const DCS = ['01', '02', '03', '04', '05', '06', '101'];
  const host = dc => `https://api-${DCS.includes(String(dc)) ? String(dc) : '01'}.moengage.com`;
  const PATHS = {
    dashboards: () => '/v5/analytics/dashboards',
    charts: id => `/v5/analytics/dashboards/${encodeURIComponent(id)}/charts`,
    chart: (id, cid) => `/v5/analytics/dashboards/${encodeURIComponent(id)}/charts/${encodeURIComponent(cid)}`
  };

  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

  // List Dashboards: accepts the documented envelope ({ data: [...] }) and close variants.
  function dashboards(res) {
    const arr = findArray(res, x => isObj(x) && (x._id || x.id) && (x.name || x.title));
    return (arr || []).map(d => ({ id: String(d._id || d.id), name: String(d.name || d.title || d._id || d.id), owner: d.owned_by || d.created_by || '' }));
  }
  // Get Dashboard Charts: { data: { name, chart_ids: [{ _id, name }] } }
  function charts(res) {
    const d = res && res.data;
    const list = (d && (d.chart_ids || d.charts)) || findArray(res, x => isObj(x) && (x._id || x.id) && x.name) || [];
    return { name: (d && d.name) || '', charts: list.map(c => (isObj(c) ? { id: String(c._id || c.id), name: String(c.name || c.title || c._id || c.id), type: c.analysis_type || c.type || '' } : { id: String(c), name: String(c), type: '' })) };
  }

  // Depth-first search for the first array whose items pass `test`.
  function findArray(v, test, depth = 0) {
    if (depth > 6 || v == null) return null;
    if (Array.isArray(v)) { if (v.length && v.every(test)) return v; for (const x of v) { const r = findArray(x, test, depth + 1); if (r) return r; } return null; }
    if (isObj(v)) {
      // prefer the usual keys first
      for (const k of ['rows', 'data', 'result', 'results', 'values', 'series']) if (k in v) { const r = findArray(v[k], test, depth + 1); if (r) return r; }
      for (const k of Object.keys(v)) { const r = findArray(v[k], test, depth + 1); if (r) return r; }
    }
    return null;
  }
  function flatten(o, pre = '', out = {}) {
    Object.entries(o).forEach(([k, v]) => {
      const key = pre ? pre + '.' + k : k;
      if (isObj(v) && Object.keys(v).length <= 30) flatten(v, key, out);
      else if (Array.isArray(v)) out[key] = v.every(x => !isObj(x) && !Array.isArray(x)) ? v.join(', ') : JSON.stringify(v).slice(0, 200);
      else out[key] = v;
    });
    return out;
  }
  const numOf = v => {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    const s = v.trim().replace(/,/g, '');
    if (!/^-?\d+(\.\d+)?%?$/.test(s)) return null;
    return parseFloat(s);
  };

  // Get Chart Data → { columns: [{ key, numeric }], rows: [{...}] }. Row keys vary by analysis type
  // (Behavior, Funnels, Retention, User, Session & Source), so nothing is assumed beyond "objects or a
  // header row followed by value rows".
  function table(res) {
    let rows = findArray(res, isObj);
    if (!rows) {
      const grid = findArray(res, x => Array.isArray(x));
      if (grid && grid.length > 1 && grid[0].every(h => typeof h === 'string')) rows = grid.slice(1).map(r => Object.fromEntries(grid[0].map((h, i) => [h, r[i]])));
    }
    if (!rows || !rows.length) return { columns: [], rows: [] };
    const flat = rows.slice(0, 5000).map(r => flatten(r));
    const keys = [];
    flat.forEach(r => Object.keys(r).forEach(k => { if (!keys.includes(k)) keys.push(k); }));
    const columns = keys.map(k => {
      const vals = flat.map(r => r[k]).filter(v => v !== '' && v != null);
      return { key: k, numeric: vals.length > 0 && vals.every(v => numOf(v) != null) };
    });
    return { columns, rows: flat };
  }

  const AGG = { sum: 'Sum of rows', avg: 'Average of rows', last: 'Last row', first: 'First row', max: 'Largest value' };
  // Reads one number from a chart table using a saved mapping:
  // { column, agg, filterCol, filterText, compareText, percent: 'auto'|'yes'|'no' }
  function pick(tbl, m, filterText) {
    if (!tbl || !m || !m.column) return null;
    let rows = tbl.rows;
    const ft = filterText != null ? filterText : m.filterText;
    if (m.filterCol && ft) {
      const words = String(ft).toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
      rows = rows.filter(r => { const v = String(r[m.filterCol] == null ? '' : r[m.filterCol]).toLowerCase(); return words.some(w => v.includes(w)); });
    }
    const vals = rows.map(r => numOf(r[m.column])).filter(v => v != null);
    if (!vals.length) return null;
    const agg = m.agg || 'sum';
    const v = agg === 'avg' ? vals.reduce((a, b) => a + b, 0) / vals.length : agg === 'last' ? vals[vals.length - 1] : agg === 'first' ? vals[0] : agg === 'max' ? Math.max(...vals) : vals.reduce((a, b) => a + b, 0);
    return { value: v, rows: vals.length };
  }
  // Rates may arrive as fractions (0.42) or percentages (42). 'auto' treats values ≤ 1 as fractions.
  function asRate(v, mode) { if (v == null) return null; if (mode === 'no') return v; if (mode === 'yes') return v <= 1 ? v * 100 : v; return Math.abs(v) <= 1 ? v * 100 : v; }

  // Funnel metrics that can come from a MoEngage chart. `rate: true` means a percentage.
  const TARGETS = [
    { id: 'moeSignups', label: 'Organic signups (MoEngage)', rate: false, hint: 'e.g. a Session & Source or Behavior chart of the sign-up event split by source; filter rows where source contains “organic, google”' },
    { id: 'profile', label: 'Profile completion (organic)', rate: true, hint: 'e.g. a Funnel chart Sign up → Profile completed, conversion column, filtered to organic' },
    { id: 'act7', label: '7-day activation (organic)', rate: true, hint: 'e.g. a Funnel chart Sign up → Registered / Applied with a 7-day window' },
    { id: 'ret30', label: '30-day retention (organic)', rate: true, hint: 'e.g. a Retention chart of organic signups, the Day 30 column' }
  ];

  // Value + comparison for each mapped target, from loaded chart tables keyed by chart id.
  function metrics(maps, tables) {
    const out = {};
    TARGETS.forEach(t => {
      const m = maps && maps[t.id];
      if (!m || !m.chart || !m.column) return;
      const tbl = tables[m.chart];
      if (!tbl) { out[t.id] = { missing: true }; return; }
      const a = pick(tbl, m);
      if (!a) { out[t.id] = { empty: true }; return; }
      const b = m.compareText && m.filterCol ? pick(tbl, m, m.compareText) : null;
      const val = t.rate ? asRate(a.value, m.percent) : a.value;
      const cmp = b ? (t.rate ? asRate(b.value, m.percent) : b.value) : null;
      out[t.id] = { value: val, compare: cmp, rate: t.rate, rows: a.rows };
    });
    return out;
  }

  // Short readable message for a failed call (the view adds what to do next).
  function errorText(status, body) {
    const msg = body && (body.message || body.error_message || (body.error && (body.error.message || body.error)) || body.description);
    if (status === 401) return 'MoEngage rejected the workspace ID or API key (401). Check that the key has “Dashboard & Analyze” access.';
    if (status === 403) return 'MoEngage refused the request (403). If an API firewall (IP allow-list) is on, the call must come from the proxy.' + (msg ? ' ' + msg : '');
    if (status === 404) return 'Not found (404). Check the data centre, dashboard ID and chart ID.';
    if (status === 429) return 'MoEngage rate limit reached (429). Wait a minute and try again.';
    return (msg ? String(msg) : 'MoEngage returned an error') + (status ? ` (${status})` : '');
  }

  const API = { DCS, host, PATHS, dashboards, charts, table, pick, asRate, metrics, TARGETS, AGG, errorText, numOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.UN_MOE = API;
})(typeof window !== 'undefined' ? window : globalThis);
