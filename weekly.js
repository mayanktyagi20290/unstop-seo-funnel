// Unstop SEO › Weekly Dashboard: GSC + GA4 live, B2B/B2E leads from the dashboard Google Sheet ("Weekly data" tab).
(function () {
  'use strict';
  const { V, esc } = window.CW_VIEWS;
  const CFG = (window.CW_CONFIG || {}).unstop || {};
  const SHEET = '16d_bPXoXdxZSeMwfenEf9YhjKuZZfnGFG1Z1T6i0Xz4', SITE = CFG.defaultProperty || 'sc-domain:unstop.com', GA = CFG.ga4PropertyId || '254253801';
  const BRAND = 'unstop|un stop|dare2compete|dare 2 compete|d2c';
  const B2B = '/employers/(hire-|free-job-posting-)|/employers/ai-sourcing-agent/jobs-internships-listings-jobboard';
  const DAY = 864e5, iso = d => new Date(d).toISOString().slice(0, 10), add = (s, n) => iso(Date.parse(s) + n * DAY);
  const mode = () => { try { return localStorage.getItem('wk-mode') || 'mon'; } catch (e) { return 'mon'; } };
  const tok = () => { for (const k of ['un:tok', 'un:ga-tok']) { try { const v = JSON.parse(sessionStorage.getItem(k)); if (v && v.t && v.exp > Date.now() + 30000) return v.t; } catch (e) { } } const a = window.UN_AUTH; return a && a.token && a.exp > Date.now() + 30000 ? a.token : null; };
  async function call(url, body) {
    const t = tok(); if (!t) throw new Error('Sign in with Google first (Connect Search Console + GA4), then reopen this tab.');
    const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || r.statusText);
    return j;
  }
  const gsc = (start, end, filters, dims) => call(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, { startDate: start, endDate: end, dimensions: dims || [], rowLimit: 30, dimensionFilterGroups: filters && filters.length ? [{ groupType: 'and', filters }] : [] });
  const f = (dimension, operator, expression) => ({ dimension, operator, expression });
  const SEG = {
    all: [], nb: [f('query', 'excludingRegex', BRAND)],
    b2c: [f('page', 'excludingRegex', '/employers/')], b2cnb: [f('page', 'excludingRegex', '/employers/'), f('query', 'excludingRegex', BRAND)],
    b2b: [f('page', 'includingRegex', B2B)], b2e: [f('page', 'includingRegex', '/employers/'), f('page', 'excludingRegex', B2B)]
  };
  const sv = r => { const x = (r.rows || [])[0] || {}; return { c: x.clicks || 0, i: x.impressions || 0 }; };
  async function gscPeriod(s, e) { const k = Object.keys(SEG), out = {}; await Promise.all(k.map(async n => { out[n] = sv(await gsc(s, e, SEG[n])); })); return out; }
  const GA_FILT = (p) => ({ filter: { fieldName: p[0], stringFilter: { matchType: p[1], value: p[2], caseSensitive: false } } });
  const andG = list => ({ andGroup: { expressions: list.map(GA_FILT) } });
  const AIRE = (CFG.aiSources || []).map(s => s.replace(/\./g, '\\.')).join('|');
  async function gaPeriod(s, e, metric, filt) { const j = await call(`https://analyticsdata.googleapis.com/v1beta/properties/${GA}:runReport`, { dateRanges: [{ startDate: s, endDate: e }], metrics: [{ name: metric }], dimensionFilter: andG(filt) }); return +(((j.rows || [])[0] || { metricValues: [{ value: 0 }] }).metricValues[0].value); }
  const ORG = ['sessionDefaultChannelGroup', 'EXACT', 'Organic Search'];
  const gaAll = (s, e) => Promise.all([gaPeriod(s, e, 'sessions', [ORG]), gaPeriod(s, e, 'sessions', [['sessionSource', 'PARTIAL_REGEXP', AIRE]]), gaPeriod(s, e, 'sessions', [['sessionSource', 'PARTIAL_REGEXP', AIRE], ['landingPagePlusQueryString', 'CONTAINS', '/employers']]), gaPeriod(s, e, 'totalUsers', [ORG, ['eventName', 'EXACT', (CFG.events && CFG.events.studentSignup[0]) || 'signup_email_verified']])]).then(a => ({ org: a[0], ai: a[1], aiEmp: a[2], su: a[3] }));
  // sheet: leads rows by Monday key
  async function sheetLeads() {
    const j = await call(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent("'Weekly data'!B3:AR60")}?valueRenderOption=UNFORMATTED_VALUE`);
    const R = j.values || [], key = R.find(r => /^Week key/i.test(r[0] || '')) || [], rows = R.filter(r => /^(B2E leads|B2B leads|Qualified leads|Pipeline from|Revenue from)/.test(r[0] || '')), by = {};
    for (let c = 5; c < key.length; c++) if (key[c]) by[iso((+key[c] - 25569) * DAY)] = c;
    return { rows, by };
  }
  const n0 = v => v == null || v === '' || isNaN(v) ? '—' : Math.round(v).toLocaleString('en-IN');
  const pc = (a, b) => a == null || b == null || !b ? null : (a - b) / b * 100;
  const chip = p => p == null ? '<span style="color:#888">—</span>' : `<b style="color:${p > 0.05 ? '#0a7d3b' : p < -0.05 ? '#c0392b' : '#888'}">${p > 0 ? '+' : ''}${p.toFixed(1)}%</b>`;
  const row = (l, a, b, fmt, key) => `<tr${key ? ` class="wk-d" data-k="${key}" style="cursor:pointer" title="Click to see what moved"` : ''}><td>${esc(l)}${key ? ' <small style="color:#888">▸</small>' : ''}</td><td style="text-align:right">${fmt ? fmt(a) : n0(a)}</td><td style="text-align:right">${fmt ? fmt(b) : n0(b)}</td><td style="text-align:right">${chip(pc(a, b))}</td></tr>`;
  const sec = t => `<tr><th colspan="4" style="text-align:left;padding-top:14px;background:none">${esc(t)}</th></tr>`;
  const pct1 = v => v == null || !isFinite(v) ? '—' : v.toFixed(1) + '%';

  let P = null;
  const mv = (a, b) => { const m = new Map(); a.forEach(r => m.set(r.keys[0], { k: r.keys[0], c1: r.clicks, i1: r.impressions, p1: r.position, c0: 0, i0: 0 })); b.forEach(r => { const o = m.get(r.keys[0]) || { k: r.keys[0], c1: 0, i1: 0, p1: null }; o.c0 = r.clicks; o.i0 = r.impressions; o.p0 = r.position; m.set(r.keys[0], o); }); return [...m.values()].map(o => ({ ...o, c0: o.c0 || 0, d: o.c1 - (o.c0 || 0), di: o.i1 - (o.i0 || 0) })); };
  const folder = u => { try { const p = new URL(u, 'https://unstop.com').pathname.split('/').filter(Boolean); return p.length ? '/' + p.slice(0, p[0] === 'employers' && p[1] ? 2 : 1).join('/') + '/' : '/'; } catch (e) { return u; } };
  const rollUp = list => { const m = new Map(); list.forEach(o => { const k = folder(o.k), x = m.get(k) || { k, c1: 0, c0: 0, i1: 0, i0: 0 }; ['c1', 'c0', 'i1', 'i0'].forEach(f => { x[f] += o[f] || 0; }); m.set(k, x); }); return [...m.values()].map(o => ({ ...o, d: o.c1 - o.c0, di: o.i1 - o.i0 })); };
  let DR = null;
  function renderDrill() {
    const body = document.getElementById('wk-db'), t = DR.tabs[DR.tab], gsc_ = DR.gsc, q = DR.q.toLowerCase();
    let list = t.list.filter(o => !q || o.k.toLowerCase().includes(q));
    const sorters = { d: (x, y) => x.d - y.d, g: (x, y) => y.d - x.d, c: (x, y) => y.c1 - x.c1, i: (x, y) => y.i1 - x.i1 };
    list = list.slice().sort(sorters[DR.sort] || sorters.d);
    const st = o => !o.c0 && o.c1 ? '<b style="color:#0a7d3b">new</b>' : o.c0 && !o.c1 ? '<b style="color:#c0392b">lost</b>' : '';
    const lost = t.list.filter(o => o.d < 0).reduce((a, o) => a + o.d, 0), gain = t.list.filter(o => o.d > 0).reduce((a, o) => a + o.d, 0);
    body.innerHTML = `<div class="un-tabs" style="margin-bottom:8px">${Object.keys(DR.tabs).map(k => `<a data-t="${k}" class="${k === DR.tab ? 'on' : ''}" href="#weekly">${DR.tabs[k].label}</a>`).join('')}</div>
      <p class="hint">${DR.unit}: gains <b style="color:#0a7d3b">+${n0(gain)}</b> · drops <b style="color:#c0392b">${n0(lost)}</b> · net <b>${n0(gain + lost)}</b></p>
      <div style="display:flex;gap:8px;margin:6px 0"><input id="wk-q" placeholder="Search ${t.label.toLowerCase()}" value="${esc(DR.q)}" style="flex:1"><select id="wk-s"><option value="d"${DR.sort === 'd' ? ' selected' : ''}>Biggest drops</option><option value="g"${DR.sort === 'g' ? ' selected' : ''}>Biggest gains</option><option value="c"${DR.sort === 'c' ? ' selected' : ''}>Most ${DR.unit} now</option>${gsc_ ? `<option value="i"${DR.sort === 'i' ? ' selected' : ''}>Most impressions</option>` : ''}</select><button class="btn" id="wk-dc" type="button">Copy list</button></div>
      <table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left">${t.label.replace(/s$/, '')}</th><th style="text-align:right">Latest</th><th style="text-align:right">Previous</th><th style="text-align:right">Change</th><th style="text-align:right">%</th>${gsc_ ? '<th style="text-align:right">Impr. chg</th><th style="text-align:right">Position</th>' : ''}<th></th></tr></thead><tbody>${list.slice(0, DR.n).map(o => `<tr><td style="word-break:break-all">${esc(o.k)}</td><td style="text-align:right">${n0(o.c1)}</td><td style="text-align:right">${n0(o.c0)}</td><td style="text-align:right">${o.d > 0 ? '+' : ''}${n0(o.d)}</td><td style="text-align:right">${chip(pc(o.c1, o.c0))}</td>${gsc_ ? `<td style="text-align:right">${o.di > 0 ? '+' : ''}${n0(o.di)}</td><td style="text-align:right">${o.p1 != null ? o.p1.toFixed(1) : '—'}${o.p0 != null && o.p1 != null ? ` <small style="color:#888">(${o.p0.toFixed(1)})</small>` : ''}</td>` : ''}<td>${st(o)}</td></tr>`).join('') || '<tr><td colspan="8">No data</td></tr>'}</tbody></table>
      ${list.length > DR.n ? `<p><button class="btn" id="wk-more" type="button">Show more (${list.length - DR.n} left)</button></p>` : ''}`;
    body.querySelectorAll('[data-t]').forEach(a => { a.onclick = e => { e.preventDefault(); DR.tab = a.dataset.t; DR.n = 25; renderDrill(); }; });
    const qi = document.getElementById('wk-q'); qi.oninput = () => { DR.q = qi.value; DR.n = 25; const p = qi.selectionStart; renderDrill(); const n = document.getElementById('wk-q'); n.focus(); n.setSelectionRange(p, p); };
    document.getElementById('wk-s').onchange = e => { DR.sort = e.target.value; renderDrill(); };
    const mo = document.getElementById('wk-more'); if (mo) mo.onclick = () => { DR.n += 50; renderDrill(); };
    document.getElementById('wk-dc').onclick = async () => { const tsv = [[t.label, 'Latest', 'Previous', 'Change'].join('\t')].concat(list.map(o => [o.k, o.c1, o.c0, o.d].join('\t'))).join('\n'); try { await navigator.clipboard.writeText(tsv); document.getElementById('wk-dc').textContent = 'Copied'; } catch (e) { } };
  }
  async function gaDim(s, e, dim, filt) { const j = await call(`https://analyticsdata.googleapis.com/v1beta/properties/${GA}:runReport`, { dateRanges: [{ startDate: s, endDate: e }], dimensions: [{ name: dim }], metrics: [{ name: 'sessions' }], dimensionFilter: andG(filt), limit: 1000, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] }); return (j.rows || []).map(r => ({ keys: [r.dimensionValues[0].value], clicks: +r.metricValues[0].value, impressions: 0 })); }
  async function drill(key, label) {
    const box = document.getElementById('wk-detail'), body = document.getElementById('wk-db'); box.hidden = false; document.getElementById('wk-dt').textContent = label + ': what moved (latest vs previous)'; body.textContent = 'Loading…'; box.scrollIntoView({ behavior: 'smooth' });
    try {
      if (key.startsWith('ga:')) {
        const fl = key === 'ga:org' ? [ORG] : key === 'ga:ai' ? [['sessionSource', 'PARTIAL_REGEXP', AIRE]] : [['sessionSource', 'PARTIAL_REGEXP', AIRE], ['landingPagePlusQueryString', 'CONTAINS', '/employers']];
        const [p1, p0, s1, s0] = await Promise.all([gaDim(P.mon, P.ce, 'landingPagePlusQueryString', fl), gaDim(P.ps, P.pe, 'landingPagePlusQueryString', fl), gaDim(P.mon, P.ce, 'sessionSource', fl), gaDim(P.ps, P.pe, 'sessionSource', fl)]);
        const pages = mv(p1, p0);
        DR = { gsc: false, unit: 'sessions', tab: 'pages', sort: 'd', q: '', n: 25, tabs: { pages: { label: 'Landing pages', list: pages }, folders: { label: 'Sections', list: rollUp(pages) }, sources: { label: 'Sources', list: mv(s1, s0) } } };
      } else {
        const fl = SEG[key], big = (s, e, d) => call(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, { startDate: s, endDate: e, dimensions: [d], rowLimit: 25000, dimensionFilterGroups: fl.length ? [{ groupType: 'and', filters: fl }] : [] }).then(r => r.rows || []);
        const [a1, a0, b1, b0, d1, d0] = await Promise.all([big(P.mon, P.ce, 'page'), big(P.ps, P.pe, 'page'), big(P.mon, P.ce, 'query'), big(P.ps, P.pe, 'query'), big(P.mon, P.ce, 'device'), big(P.ps, P.pe, 'device')]);
        const pages = mv(a1, a0);
        DR = { gsc: true, unit: 'clicks', tab: 'pages', sort: 'd', q: '', n: 25, tabs: { pages: { label: 'Landing pages', list: pages }, queries: { label: 'Queries', list: mv(b1, b0) }, folders: { label: 'Sections', list: rollUp(pages) }, devices: { label: 'Devices', list: mv(d1, d0) } } };
      }
      renderDrill();
    } catch (e) { body.textContent = e.message; }
  }
  function copyTable() {
    const t = document.getElementById('wk-t'), msg = document.getElementById('wk-cmsg');
    const tsv = [...t.querySelectorAll('tr')].map(r => [...r.children].map(c => c.textContent.replace('▸', '').trim()).join('\t')).join('\n');
    const html = '<table border="1">' + [...t.querySelectorAll('tr')].map(r => '<tr>' + [...r.children].map(c => `<${c.tagName.toLowerCase()}>${esc(c.textContent.replace('▸', '').trim())}</${c.tagName.toLowerCase()}>`).join('') + '</tr>').join('') + '</table>';
    (async () => { try { if (window.ClipboardItem && navigator.clipboard.write) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([tsv], { type: 'text/plain' }) })]); else await navigator.clipboard.writeText(tsv); msg.textContent = 'Copied. Paste into Google Sheets (A1) with Ctrl/Cmd + V.'; } catch (e) { msg.textContent = 'Copy was blocked by the browser.'; } })();
  }
  V.weekly = () => ({
    html: `<div class="view-h"><h1>Weekly Dashboard</h1><p>Search Console and GA4 load live after sign-in; B2B and B2E leads come from the dashboard sheet's Weekly data tab.</p></div>
    <section class="panel"><div class="panel-h"><div class="un-tabs" id="wk-tabs"><a data-m="mon" href="#weekly">Mon–Sun weeks</a><a data-m="roll" href="#weekly">Rolling 7 days</a></div><p id="wk-range"></p><button type="button" class="btn" id="wk-copy">Copy table</button> <span id="wk-cmsg" class="hint"></span></div><div class="panel-b"><div id="wk-msg">Loading…</div><table id="wk-t" style="width:100%;border-collapse:collapse" hidden><thead><tr><th style="text-align:left">Metric</th><th style="text-align:right">Latest</th><th style="text-align:right">Previous</th><th style="text-align:right">Change</th></tr></thead><tbody id="wk-b"></tbody></table></div></section><section class="panel" id="wk-detail" hidden><div class="panel-h"><h2 id="wk-dt"></h2></div><div class="panel-b" id="wk-db"></div></section>`,
    mount() {
      const m = mode(), msg = document.getElementById('wk-msg'), tb = document.getElementById('wk-b');
      document.querySelectorAll('#wk-tabs a').forEach(a => { a.classList.toggle('on', a.dataset.m === m); a.onclick = e => { e.preventDefault(); try { localStorage.setItem('wk-mode', a.dataset.m); } catch (x) { } V.weekly().mount.call(null); document.querySelectorAll('#wk-tabs a').forEach(z => z.classList.toggle('on', z.dataset.m === a.dataset.m)); }; });
      (async () => {
        try {
          document.getElementById('wk-t').hidden = true; msg.hidden = false; msg.textContent = 'Loading…';
          const probe = await gsc(add(iso(Date.now()), -12), iso(Date.now()), [], ['date']);
          const last = (probe.rows || []).map(r => r.keys[0]).sort().pop();
          let ce, mon;
          if (m === 'mon') { const dow = new Date(last).getUTCDay(); ce = dow === 0 ? last : add(last, -dow); mon = add(ce, -6); } else { ce = last; mon = add(last, -6); }
          const pe = add(mon, -1), ps = add(pe, -6); P = { mon, ce, ps, pe };
          document.getElementById('wk-range').textContent = `Latest ${mon} to ${ce} · Previous ${ps} to ${pe} (Search Console data ends ${last})`;
          const [g1, g0, a1, a0, sh] = await Promise.all([gscPeriod(mon, ce), gscPeriod(ps, pe), gaAll(mon, ce), gaAll(ps, pe), sheetLeads().catch(e => ({ err: e.message }))]);
          const L = (k, key) => { const o = (k === 'c' ? g1 : g0)[key]; return o; };
          let h = sec('Visibility (Search Console)') + row('Google clicks, all pages', g1.all.c, g0.all.c, null, 'all') + row('Non-brand clicks, all pages', g1.nb.c, g0.nb.c, null, 'nb') + row('Non-brand share of clicks', g1.nb.c / g1.all.c * 100, g0.nb.c / g0.all.c * 100, pct1);
          h += sec('B2C') + row('B2C clicks', g1.b2c.c, g0.b2c.c, null, 'b2c') + row('B2C non-brand clicks', g1.b2cnb.c, g0.b2cnb.c, null, 'b2cnb') + row('B2C impressions', g1.b2c.i, g0.b2c.i, null, 'b2c');
          h += sec('B2B') + row('B2B clicks', g1.b2b.c, g0.b2b.c, null, 'b2b') + row('B2B impressions', g1.b2b.i, g0.b2b.i, null, 'b2b') + row('B2B CTR', g1.b2b.c / g1.b2b.i * 100, g0.b2b.c / g0.b2b.i * 100, pct1);
          h += sec('B2E') + row('B2E clicks', g1.b2e.c, g0.b2e.c, null, 'b2e') + row('B2E impressions', g1.b2e.i, g0.b2e.i, null, 'b2e') + row('B2E CTR', g1.b2e.c / g1.b2e.i * 100, g0.b2e.c / g0.b2e.i * 100, pct1);
          h += sec('Traffic and signups (GA4)') + row('Organic sessions, all pages', a1.org, a0.org, null, 'ga:org') + row('AI sessions, all pages', a1.ai, a0.ai, null, 'ga:ai') + row('AI sessions, employer pages', a1.aiEmp, a0.aiEmp, null, 'ga:aiEmp') + row('Student signups, organic (users)', a1.su, a0.su);
          h += sec('B2B and B2E leads (dashboard sheet)');
          if (sh.err) h += `<tr><td colspan="4" style="color:#c0392b">Could not read the sheet: ${esc(sh.err)}</td></tr>`;
          else if (m !== 'mon') h += '<tr><td colspan="4" style="color:#888">Leads are counted per Mon–Sun week. Switch to Mon–Sun weeks to see them.</td></tr>';
          else { const c1 = sh.by[mon], c0 = sh.by[ps]; if (c1 == null) h += `<tr><td colspan="4" style="color:#888">Week of ${mon} is not in the sheet yet.</td></tr>`; else sh.rows.forEach(r => { const a = r[c1], b = c0 == null ? null : r[c0], isPct = /share/i.test(r[0]); h += row(r[0], typeof a === 'number' ? (isPct && a <= 1 ? a * 100 : a) : null, typeof b === 'number' ? (isPct && b <= 1 ? b * 100 : b) : null, isPct ? pct1 : null); }); }
          tb.innerHTML = h; tb.querySelectorAll('tr.wk-d').forEach(r => { r.onclick = () => drill(r.dataset.k, r.firstElementChild.textContent.replace('▸', '').trim()); }); document.getElementById('wk-copy').onclick = copyTable; document.getElementById('wk-detail').hidden = true; msg.hidden = true; document.getElementById('wk-t').hidden = false;
        } catch (e) { msg.textContent = e.message; }
      })();
    }
  });
})();
