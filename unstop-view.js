// Unstop full-funnel screens: Full funnel, Visibility by page type (GSC), GA4 organic, Signup quality
// (MoEngage) and Funnel setup. Settings are kept per site in this browser; GA4 and MoEngage data stay in
// this tab's memory unless the user chooses otherwise.
(function () {
  'use strict';
  const { V, esc, ui } = window.CW_VIEWS;
  const { head, table, drawTable, TABLES, chart, cssVar, posTag, pctf, urlCell } = ui;
  const CW = window.CW, U = window.UN, fmtN = CW.fmtN;
  const CFG = (window.CW_CONFIG && window.CW_CONFIG.unstop) || {};
  const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
  const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

  // ── per-site settings ──
  const KEY = site => 'un:funnel:' + site;
  const DEF = () => ({
    types: null, sections: null, rootArticles: true, clusters: null,
    events: JSON.parse(JSON.stringify(CFG.events || {})),
    ga4Property: CFG.ga4PropertyId || '', pricingPaths: (CFG.pricingPaths || []).slice(), aiSources: (CFG.aiSources || []).slice(),
    pathTypes: ['opp', 'emp', 'org'], pathSections: null, owners: {}, monthlyCost: '', moeThreshold: 80, organicSources: ''
  });
  function settings(site) { let s = null; try { s = JSON.parse(localStorage.getItem(KEY(site))); } catch (e) { } const d = DEF(); return s ? { ...d, ...s, events: { ...d.events, ...(s.events || {}) } } : d; }
  function save(site, s) { try { localStorage.setItem(KEY(site), JSON.stringify(s)); } catch (e) { } }
  const ctx = new Map(); // site → { typeOf, clusterOf } rebuilt when settings change
  function tools(D) {
    const s = settings(D.site); const sig = JSON.stringify([s.types, s.rootArticles, s.clusters]);
    let c = ctx.get(D.site);
    if (!c || c.sig !== sig) { c = { sig, typeOf: U.makeClassifier(s.types, { rootArticles: s.rootArticles }), clusterOf: U.makeClusterer(s.clusters) }; ctx.set(D.site, c); }
    return { ...c, s };
  }

  // ── in-memory data ──
  const GA = new Map();   // site → { raw, model, at, property, start, end, sample }
  const MOE = new Map();  // site → { res, rows, name, at, sample }
  const WEEK = new Map(); // site|start|end → { status, series, error }
  const MAPS = new Map(); // site → { status, rows, error }
  let MSG = { ga: '', moe: '' };

  // ── formatting ──
  const pct1 = v => v == null || isNaN(v) ? '—' : v.toFixed(1) + '%';
  const dchip = (v, invert, unit) => {
    if (v == null || !isFinite(v)) return '<span class="un-d flat">—</span>';
    if (unit === 'pos' && Math.abs(v) < 0.05) return '<span class="un-d flat">±0.0</span>';
    const good = invert ? v < 0 : v > 0, bad = invert ? v > 0 : v < 0;
    const s = unit === 'pos' ? (v > 0 ? '+' : '') + v.toFixed(1) : (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) < 10 ? 1 : 0) + '%';
    return `<span class="un-d ${good ? 'up' : bad ? 'down' : 'flat'}">${s}</span>`;
  };
  const when = t => t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const fmtD = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '?';
  const chip = (st) => ({ live: '<span class="un-st live">Live</span>', file: '<span class="un-st file">Upload</span>', sample: '<span class="un-st sample">Sample</span>', none: '<span class="un-st none">Not connected</span>', later: '<span class="un-st later">Next phase</span>', input: '<span class="un-st file">Input</span>' }[st] || '');
  const brandOf = A => A.isBrand || (() => false);

  // ════════════════════════════ GSC: VISIBILITY BY PAGE TYPE ════════════════════════════
  function gscModel(A, D) {
    const { typeOf, clusterOf } = tools(D);
    const isB = brandOf(A);
    return { vis: U.visibility(A, D, typeOf, isB), ranks: U.rankBuckets(A, D, typeOf, isB, clusterOf), clusters: U.clusters(A, D, isB, clusterOf), strike: U.strikingDistance(A, D, typeOf, isB, clusterOf), typeOf, clusterOf };
  }

  V.visibility = (A, D) => {
    Object.keys(TABLES).filter(k => k.startsWith('t-un-v')).forEach(k => delete TABLES[k]);
    window.CW_LAST_A = A;
    const M = gscModel(A, D), { vis, ranks, typeOf } = M;
    const src = window.CW_SOURCE || {};
    const live = src.kind === 'api' && src.gsc;
    const prevNote = D.prevStart ? `Changes compare with ${fmtD(D.prevStart)} – ${fmtD(D.prevEnd)}.` : 'Turn on “Compare with the previous period” to see changes.';
    const qpNote = vis.hasQP ? `Branded split from ${fmtN(vis.qpRows)} query × page rows (the first 25,000 Search Console returns), applied to each page type’s totals.` : (D.pending && D.pending.qp ? 'Loading query × page rows for the branded split…' : 'The branded split by page type needs query × page rows, which come only from a Search Console connection.');
    const html = head('Visibility by page type', `Search Console impressions, clicks, CTR and position for each Unstop page type, branded vs non-branded, with keyword ranking buckets and indexation. ${prevNote}`) + scopePicker(A, D) +
      `<div class="note">${qpNote} Page types follow the rules in <a href="#funnelsetup">Funnel setup</a>. For exact branded vs non-branded numbers per URL cluster (internships, jobs, hackathons, blog, employers…), open <a href="#urlclusters">Clusters: branded vs non-branded</a>.</div>` +
      `<section class="panel"><div class="panel-h"><h2>Page types</h2><p>Totals from the page report. “Non-branded (est.)” applies the branded share of each type’s query × page rows to its totals.</p></div>
        ${table('t-un-vt', [
        { k: 'name', l: 'Page type', f: r => `<b>${esc(r.name)}</b>` },
        { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) + ' ' + dchip(r.dClicks) },
        { k: 'impr', l: 'Impressions', r: 1, f: r => fmtN(r.impr) + ' ' + dchip(r.dImpr) },
        { k: 'ctr', l: 'CTR', r: 1, f: r => pct1(r.ctr) },
        { k: 'pos', l: 'Avg position', r: 1, f: r => posTag(r.pos) + ' ' + dchip(r.dPos, true, 'pos'), csv: r => r.pos },
        { k: 'urls', l: 'URLs with impressions', r: 1, f: r => fmtN(r.urls) },
        { k: 'bShareC', l: 'Branded share of clicks', r: 1, f: r => r.bShareC == null ? '—' : pct1(r.bShareC * 100), csv: r => r.bShareC == null ? '' : r.bShareC * 100 },
        { k: 'nbClicks', l: 'Non-branded clicks (est.)', r: 1, f: r => r.estNB ? fmtN(r.estNB.clicks) : '—', csv: r => r.estNB ? Math.round(r.estNB.clicks) : '' },
        { k: 'nbCtr', l: 'Non-branded CTR', r: 1, f: r => r.nonBrand ? pct1(r.nonBrand.ctr) : '—', csv: r => r.nonBrand ? r.nonBrand.ctr : '' },
        { k: 'nbPos', l: 'Non-branded position', r: 1, f: r => r.nonBrand && r.nonBrand.impr ? posTag(r.nonBrand.pos) : '—', csv: r => r.nonBrand ? r.nonBrand.pos : '' }
      ], vis.rows.map(r => ({ ...r, nbClicks: r.estNB ? r.estNB.clicks : -1, nbCtr: r.nonBrand ? r.nonBrand.ctr : -1, nbPos: r.nonBrand ? r.nonBrand.pos : 999 })), { search: false, file: 'unstop-visibility-by-page-type', pageSize: 30 })}</section>` +
      `<section class="panel"><div class="panel-h"><h2>Weekly trend by page type</h2><p>Complete Monday–Sunday weeks (partial weeks are left off the chart and marked in the table). Clicks per week for the four core page types, straight from Search Console with a page filter per type (queries Google anonymises are not in query-filtered totals).</p></div><div class="panel-b" id="un-weekly">${live ? weeklyBlock(D) : '<p class="empty">Needs a Search Console connection (exports carry only whole-site daily totals).</p>'}</div></section>` +
      `<section class="panel"><div class="panel-h"><h2>Keyword ranking buckets</h2><p>Each query is counted once, under the page type of the page that got most of its impressions. ${ranks.hasPrev ? 'Previous-period counts use the same page mapping.' : ''}</p></div>
        ${table('t-un-vr', [
        { k: 'name', l: 'Page type', f: r => `<b>${esc(r.name)}</b>` },
        { k: 'n3', l: 'Non-branded top 3', r: 1, f: r => cnt(r.n.top3, r.pn.top3, ranks.hasPrev) },
        { k: 'n10', l: 'Non-branded top 10', r: 1, f: r => cnt(r.n.top10, r.pn.top10, ranks.hasPrev) },
        { k: 'n11', l: 'Non-branded 11–20', r: 1, f: r => cnt(r.n.p11, r.pn.p11, ranks.hasPrev) },
        { k: 'b3', l: 'Branded top 3', r: 1, f: r => cnt(r.b.top3, r.pb.top3, ranks.hasPrev) },
        { k: 'b10', l: 'Branded top 10', r: 1, f: r => cnt(r.b.top10, r.pb.top10, ranks.hasPrev) },
        { k: 'b11', l: 'Branded 11–20', r: 1, f: r => cnt(r.b.p11, r.pb.p11, ranks.hasPrev) },
        { k: 'tot', l: 'Queries ranking', r: 1, f: r => fmtN(r.n.total + r.b.total) }
      ], ranks.byType.concat([{ key: 'all', name: 'All page types', ...ranks.total }]).map(bucketRow), { search: false, file: 'unstop-ranking-buckets', pageSize: 30 })}</section>` +
      `<div class="grid-2 even"><section class="panel"><div class="panel-h"><h2>Query clusters</h2><p>Rules editable in Funnel setup.</p></div>
        ${table('t-un-vc', [
        { k: 'name', l: 'Cluster', f: r => `<b>${esc(r.name)}</b>` },
        { k: 'nbClicks', l: 'Non-branded clicks', r: 1, f: r => fmtN(r.nb.clicks) + ' ' + dchip(r.dNb) },
        { k: 'nbImpr', l: 'Non-branded impr.', r: 1, f: r => fmtN(r.nb.impr) },
        { k: 'nbPos', l: 'NB position', r: 1, f: r => r.nb.impr ? posTag(r.nb.pos) : '—' },
        { k: 'brClicks', l: 'Branded clicks', r: 1, f: r => fmtN(r.br.clicks) },
        { k: 'queries', l: 'Queries', r: 1, f: r => fmtN(r.queries) }
      ], M.clusters.map(r => ({ ...r, nbClicks: r.nb.clicks, nbImpr: r.nb.impr, nbPos: r.nb.pos, brClicks: r.br.clicks })), { search: false, file: 'unstop-query-clusters', sort: 'nbClicks', pageSize: 20 })}</section>
      <section class="panel"><div class="panel-h"><h2>Ranking buckets by cluster</h2><p>Non-branded queries.</p></div>
        ${table('t-un-vrc', [
        { k: 'name', l: 'Cluster', f: r => `<b>${esc(r.name)}</b>` },
        { k: 'n3', l: 'Top 3', r: 1, f: r => cnt(r.n.top3, r.pn.top3, ranks.hasPrev) },
        { k: 'n10', l: 'Top 10', r: 1, f: r => cnt(r.n.top10, r.pn.top10, ranks.hasPrev) },
        { k: 'n11', l: '11–20', r: 1, f: r => cnt(r.n.p11, r.pn.p11, ranks.hasPrev) }
      ], ranks.byCluster.map(bucketRow), { search: false, file: 'unstop-buckets-by-cluster', sort: 'n10', pageSize: 20 })}</section></div>` +
      `<section class="panel"><div class="panel-h"><h2>Quick-win candidates: non-branded queries in positions 11–20</h2><p>Ranked by impressions, with the page type and cluster they belong to.</p></div>
        ${table('t-un-vs', [
        { k: 'q', l: 'Query', cls: 'q', f: r => esc(r.q) },
        { k: 'path', l: 'Top page', cls: 'u', f: r => r.p ? urlCell(r.p, r.path) : '—', csv: r => r.p || '' },
        { k: 'type', l: 'Page type' }, { k: 'cluster', l: 'Cluster' },
        { k: 'impr', l: 'Impressions', r: 1, f: r => fmtN(r.impr) }, { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) }, { k: 'pos', l: 'Position', r: 1, f: r => posTag(r.pos) }
      ], M.strike, { file: 'unstop-positions-11-20', sort: 'impr', pageSize: 15, searchKeys: ['q', 'path', 'type', 'cluster'], placeholder: 'Filter queries, pages, types',
        filters: [{ key: 'type', label: 'Page type', options: typeOf.types.map(t => [t.name, t.name]), test: (r, v) => r.type === v }] })}</section>` +
      `<section class="panel"><div class="panel-h"><h2>Indexation by page type</h2><p>URLs submitted in sitemaps (Search Console API) next to URLs that got impressions. The API no longer reports indexed counts, so “visible ÷ submitted” is a proxy; check Pages › Indexing in Search Console per sitemap for exact indexed counts.</p></div><div class="panel-b" id="un-maps">${live ? mapsBlock(D, vis) : '<p class="empty">Needs a Search Console connection.</p>'}</div></section>` +
      `<section class="panel"><div class="panel-h"><h2>Pages by cluster and folder</h2></div>
        ${table('t-un-vp', [
        { k: 'path', l: 'Page', cls: 'u', f: r => urlCell(r.p, r.path), csv: r => r.p }, { k: 'cluster', l: 'Cluster' }, { k: 'folder', l: 'Folder', f: r => `<code>${esc(r.folder)}</code>`, csv: r => r.folder },
        { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) }, { k: 'impr', l: 'Impressions', r: 1, f: r => fmtN(r.impr) }, { k: 'ctr', l: 'CTR', r: 1, f: r => pct1(r.ctr) }, { k: 'pos', l: 'Position', r: 1, f: r => posTag(r.pos) }
      ], withCluster(D, A.P, r => r.p).map(r => ({ ...r, typeName: typeOf.label(typeOf(r.p)) })), { file: 'unstop-pages-by-cluster', sort: 'clicks', pageSize: 20, searchKeys: ['path', 'folder'], placeholder: 'Filter URLs or folders',
        filters: [{ key: 'type', label: 'Page type', options: typeOf.types.map(t => [t.name, t.name]), test: (r, v) => r.typeName === v }, clusterFilter(D)] })}</section>`;
    const mount = () => {
      ['t-un-vt', 't-un-vr', 't-un-vc', 't-un-vrc', 't-un-vs', 't-un-vp'].forEach(drawTable);
      if (live) { weeklyMount(D); mapsMount(D, vis); } scopeMount(D);
    };
    return { html, mount };
  };
  const clusterFilter = (D, key) => { const so = sectioner(D); return { key: key || 'cl', label: 'Cluster', options: so.sections.map(x => [x.name, x.name]), test: (r, v) => r.cluster === v }; };
  const withCluster = (D, rows, keyOf) => { const so = sectioner(D); return rows.map(r => { const u = keyOf(r); return { ...r, cluster: so.label(so(u)), folder: so.folderOf(u) }; }); };
  function bucketRow(r) { return { ...r, n3: r.n.top3, n10: r.n.top10, n11: r.n.p11, b3: r.b.top3, b10: r.b.top10, b11: r.b.p11, tot: r.n.total + r.b.total }; }
  function cnt(c, p, hasPrev) { if (!hasPrev) return fmtN(c); const d = c - p; return `${fmtN(c)} <span class="un-d ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${d > 0 ? '+' : ''}${d === 0 ? '±0' : fmtN(d)}</span>`; }

  // weekly trend: per core type × branded / non-branded, page-filtered daily rows
  function weeklyKey(D) { return D.site + '|' + D.start + '|' + D.end + '|' + (D.scope || ''); }
  function weeklyBlock(D) {
    const w = WEEK.get(weeklyKey(D));
    if (!w) return `<p class="un-row"><button class="btn-primary sm" type="button" id="un-wk-go">Load weekly trend by page type</button><span class="progress">Runs ${U.CORE.length * 2} Search Console queries.</span></p>`;
    if (w.status === 'loading') return '<p class="progress">Loading weekly data from Search Console…</p>';
    if (w.status === 'error') return `<p class="start-error">${esc(w.error)}</p><button class="btn-quiet" type="button" id="un-wk-go">Try again</button>`;
    return `<div class="un-tabs" role="tablist"><button type="button" class="on" data-wk="nb">Non-branded clicks</button><button type="button" data-wk="b">Branded clicks</button><button type="button" data-wk="nbi">Non-branded impressions</button><button type="button" data-wk="pos">Non-branded position</button></div><div class="chart-box un-tall"><canvas id="un-wk-ch" aria-label="Weekly clicks by page type"></canvas></div>` +
      `<div class="tw"><table class="un-mini"><thead><tr><th>Week starting</th>${w.series.map(s => `<th class="r">${esc(s.name)} NB clicks</th>`).join('')}</tr></thead><tbody>${weeksOf(w).slice().reverse().slice(0, 8).map(k => `<tr><td>${fmtD(k.w)}${k.partial ? ' <span class="tag">partial</span>' : ''}</td>${w.series.map(s => { const x = s.nb.find(r => r.w === k.w); return `<td class="r">${x ? fmtN(x.clicks) : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function weeksOf(w) { const m = new Map(); w.series.forEach(s => s.nb.forEach(r => { if (!m.has(r.w)) m.set(r.w, { w: r.w, partial: r.partial }); })); return [...m.values()].sort((a, b) => a.w.localeCompare(b.w)); }
  function weeklyMount(D) {
    const go = document.getElementById('un-wk-go');
    if (go) go.addEventListener('click', () => loadWeekly(D));
    const w = WEEK.get(weeklyKey(D));
    if (!w || w.status !== 'done') return;
    const colors = ['--signal', '--good', '--orange', '--sky', '--teal', '--watch'];
    let mode = 'nb', ch = null;
    const draw = () => {
      if (ch) { try { ch.destroy(); } catch (e) { } }
      const weeks = weeksOf(w).filter(k => !k.partial);
      ch = chart('un-wk-ch', { type: 'line', data: { labels: weeks.map(k => fmtD(k.w)), datasets: w.series.map((s, i) => {
        const src = mode === 'b' ? s.b : s.nb;
        return { label: s.name, data: weeks.map(k => { const x = src.find(r => r.w === k.w); if (!x) return null; return mode === 'nbi' ? x.impr : mode === 'pos' ? +x.pos.toFixed(2) : x.clicks; }), borderColor: cssVar(colors[i % colors.length]), backgroundColor: cssVar(colors[i % colors.length]), tension: .25, pointRadius: 2, borderWidth: 2 };
      }) }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { reverse: mode === 'pos', beginAtZero: mode !== 'pos' } }, plugins: { legend: { position: 'bottom' } } } });
    };
    draw();
    document.querySelectorAll('[data-wk]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-wk]').forEach(x => x.classList.toggle('on', x === b)); mode = b.dataset.wk; draw(); }));
  }
  async function loadWeekly(D) {
    const k = weeklyKey(D), src = window.CW_SOURCE; if (!src || !src.gsc) return;
    const { typeOf, s } = tools(D);
    const A = window.CW_LAST_A;
    const brandRx = A && A.brandRx;
    WEEK.set(k, { status: 'loading' }); rerender();
    try {
      const types = U.CORE.map(id => (s.types || U.DEFAULT_TYPES).find(t => t.id === id)).filter(Boolean);
      const q = (rx, brand) => src.gsc.query({ startDate: D.start, endDate: D.end, dimensions: ['date'], type: 'web', rowLimit: 1000,
        dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'page', operator: 'includingRegex', expression: rx }, { dimension: 'query', operator: brand ? 'includingRegex' : 'excludingRegex', expression: brandRx }] }] })
        .then(d => (d.rows || []).map(r => ({ d: r.keys[0], clicks: r.clicks, impr: r.impressions, pos: r.position })));
      const series = await Promise.all(types.map(async t => {
        const rx = U.typeRegex(t, null);
        const [nb, b] = await Promise.all([q(rx, false), q(rx, true)]);
        return { id: t.id, name: typeOf.label(t.id), nb: U.weekly(nb), b: U.weekly(b) };
      }));
      WEEK.set(k, { status: 'done', series, at: Date.now() });
    } catch (e) { WEEK.set(k, { status: 'error', error: e.message }); }
    rerender();
  }
  // sitemaps
  function mapsBlock(D, vis) {
    const m = MAPS.get(D.site);
    if (!m) return '<button class="btn-primary sm" type="button" id="un-maps-go">Load sitemaps</button>';
    if (m.status === 'loading') return '<p class="progress">Reading sitemaps from Search Console…</p>';
    if (m.status === 'error') return `<p class="start-error">${esc(m.error)}</p><button class="btn-quiet" type="button" id="un-maps-go">Try again</button>`;
    const { typeOf } = tools(D);
    const byType = new Map();
    m.rows.filter(r => !r.isIndex).forEach(r => { const k = r.type || 'none'; const o = byType.get(k) || { submitted: 0, maps: 0, errors: 0, warnings: 0 }; o.submitted += r.submitted; o.maps++; o.errors += r.errors; o.warnings += r.warnings; byType.set(k, o); });
    const rows = vis.rows.map(v => { const s = byType.get(v.id); return { name: v.name, urls: v.urls, submitted: s ? s.submitted : 0, maps: s ? s.maps : 0, errors: s ? s.errors : 0, rate: s && s.submitted ? v.urls / s.submitted * 100 : null }; });
    const none = byType.get('none');
    return `<div class="tw"><table class="un-mini"><thead><tr><th>Page type</th><th class="r">Sitemaps</th><th class="r">URLs submitted</th><th class="r">URLs with impressions</th><th class="r">Visible ÷ submitted</th><th class="r">Sitemap errors</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${esc(r.name)}</b></td><td class="r">${r.maps || '—'}</td><td class="r">${r.submitted ? fmtN(r.submitted) : '—'}</td><td class="r">${fmtN(r.urls)}</td><td class="r">${r.rate == null ? '—' : pct1(Math.min(999, r.rate))}</td><td class="r">${r.errors || '—'}</td></tr>`).join('')}${none ? `<tr><td>Sitemaps not matched to a type</td><td class="r">${none.maps}</td><td class="r">${fmtN(none.submitted)}</td><td colspan="3"></td></tr>` : ''}</tbody></table></div>
      <details class="un-det"><summary>${m.rows.length} sitemaps</summary><div class="tw"><table class="un-mini"><thead><tr><th>Sitemap</th><th>Page type</th><th class="r">Submitted</th><th>Last read by Google</th><th class="r">Errors</th><th class="r">Warnings</th></tr></thead><tbody>${m.rows.map(r => `<tr><td class="u">${esc(r.path)}${r.isIndex ? ' <span class="tag">index</span>' : ''}</td><td>${esc(r.typeName)}</td><td class="r">${fmtN(r.submitted)}</td><td>${r.lastDownloaded ? fmtD(r.lastDownloaded.slice(0, 10)) : '—'}</td><td class="r">${r.errors}</td><td class="r">${r.warnings}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  function mapsMount(D) {
    const go = document.getElementById('un-maps-go'); if (!go) return;
    go.addEventListener('click', async () => {
      const src = window.CW_SOURCE; MAPS.set(D.site, { status: 'loading' }); rerender();
      try { const d = await src.gsc.sitemaps(); MAPS.set(D.site, { status: 'done', rows: U.sitemapTypes(d.sitemap || [], tools(D).typeOf), at: Date.now() }); }
      catch (e) { MAPS.set(D.site, { status: 'error', error: e.message }); }
      rerender();
    });
  }

  // ════════════════════════════ URL CLUSTERS: BRANDED VS NON-BRANDED ════════════════════════════
  // With Search Console connected every cluster is queried on its own (page regex filter), so totals are
  // exact: all queries, branded only and non-branded only, plus the cluster's query list for ranking
  // buckets. Anonymised queries sit in the total but in neither split. Uploads and sample data fall back to
  // page totals × the branded share of query × page rows (marked as estimates).
  const CL = new Map(); // key → { status, done, total, models: Map, error, at }
  const clKey = D => [D.site, D.start, D.end, D.prevStart || '', D.scope || '', JSON.stringify(settings(D.site).sections || null)].join('|');
  function sectioner(D) { const s = settings(D.site); return U.makeSectioner(s.sections, { rootArticles: s.rootArticles }); }
  async function loadClusters(D, A) {
    const src = window.CW_SOURCE, k = clKey(D);
    if (!src || !src.gsc || !A.brandRx) return;
    const secOf = sectioner(D), list = secOf.sections.filter(x => x.id !== 'other' && x.rules.length);
    const st = { status: 'loading', done: 0, total: list.length, models: new Map(), raw: new Map(), at: null };
    CL.set(k, st); rerender();
    const { clusterOf } = tools(D), isB = brandOf(A);
    const pf = (rx, ex) => [{ dimension: 'page', operator: 'includingRegex', expression: rx }].concat(ex ? [{ dimension: 'page', operator: 'excludingRegex', expression: ex }] : []);
    const agg = (rx, ex, s, e, brand) => {
      const f = pf(rx, ex);
      if (brand != null) f.push({ dimension: 'query', operator: brand ? 'includingRegex' : 'excludingRegex', expression: A.brandRx });
      return src.gsc.query({ startDate: s, endDate: e, type: 'web', rowLimit: 1, dimensionFilterGroups: [{ groupType: 'and', filters: f }] }).then(d => (d.rows || [])[0] || null);
    };
    const qs = (rx, ex, s, e) => src.gsc.query({ startDate: s, endDate: e, type: 'web', dimensions: ['query'], rowLimit: 25000, dimensionFilterGroups: [{ groupType: 'and', filters: pf(rx, ex) }] })
      .then(d => (d.rows || []).map(r => ({ q: r.keys[0], clicks: r.clicks, impr: r.impressions, pos: r.position })));
    let i = 0;
    const errors = [];
    const worker = async () => {
      while (i < list.length) {
        const sec = list[i++];
        const rx = U.sectionRegex(sec, null), ex = U.sectionExclude(sec, settings(D.site).sections);
        try {
          const cur = await Promise.all([agg(rx, ex, D.start, D.end), agg(rx, ex, D.start, D.end, true), agg(rx, ex, D.start, D.end, false), qs(rx, ex, D.start, D.end)]);
          const prev = D.prevStart ? await Promise.all([agg(rx, ex, D.prevStart, D.prevEnd), agg(rx, ex, D.prevStart, D.prevEnd, true), agg(rx, ex, D.prevStart, D.prevEnd, false), qs(rx, ex, D.prevStart, D.prevEnd)]) : [];
          const o = { tot: cur[0], b: cur[1], nb: cur[2], queries: cur[3], capped: cur[3].length >= 25000, prevTot: prev[0], prevB: prev[1], prevNb: prev[2], prevQueries: prev[3] || null };
          st.models.set(sec.id, U.sectionModel(o, isB, clusterOf));
        } catch (e) { errors.push(sec.name + ': ' + e.message); }
        st.done++;
        const p = document.getElementById('un-cl-prog'); if (p) p.textContent = `Loading clusters from Search Console… ${st.done} of ${st.total}`;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    st.status = errors.length && !st.models.size ? 'error' : 'done'; st.error = errors.join(' · '); st.at = Date.now();
    if (CL.get(k) === st) rerender();
  }
  function clustersData(A, D) {
    const live = window.CW_SOURCE && window.CW_SOURCE.kind === 'api' && window.CW_SOURCE.gsc;
    if (live) { const st = CL.get(clKey(D)); return { live: true, st, models: st ? st.models : new Map() }; }
    const { clusterOf } = tools(D);
    return { live: false, st: { status: 'done' }, models: U.sectionsFromRows(A, D, sectioner(D), brandOf(A), clusterOf, { exact: D.source === 'demo' }) };
  }

  // GSC: every cluster › folder from the page report, with the branded split from query × page rows
  function gscFolderRows(A, D) {
    const so = sectioner(D), isB = brandOf(A);
    const g = new Map();
    const get = (u) => { const id = so(u), folder = so.folderOf(u), k = id + '|' + folder; if (!g.has(k)) g.set(k, { id, cluster: so.label(id), type: so.typeOf(id), folder, clicks: 0, impr: 0, posW: 0, urls: 0, pClicks: 0, pImpr: 0, bC: 0, nC: 0, nImpr: 0, nPosW: 0 }); return g.get(k); };
    (A.P || []).forEach(r => { const o = get(r.p); o.clicks += +r.clicks || 0; o.impr += +r.impr || 0; o.posW += (+r.pos || 0) * (+r.impr || 0); if (+r.impr > 0) o.urls++; });
    (D.prevP || []).forEach(r => { const o = get(r.p); o.pClicks += +r.clicks || 0; o.pImpr += +r.impr || 0; });
    (D.QP || []).forEach(r => { const o = get(r.p); if (isB(r.q)) o.bC += +r.clicks || 0; else { o.nC += +r.clicks || 0; o.nImpr += +r.impr || 0; o.nPosW += (+r.pos || 0) * (+r.impr || 0); } });
    return [...g.values()].filter(o => o.impr > 0 || o.pImpr > 0).map(o => ({ ...o, ctr: o.impr ? o.clicks / o.impr * 100 : 0, pos: o.impr ? o.posW / o.impr : 0, dClicks: U.chg(o.clicks, o.pClicks), bShare: o.bC + o.nC ? o.bC / (o.bC + o.nC) * 100 : null, nPos: o.nImpr ? o.nPosW / o.nImpr : null }));
  }
  function folderTable(id, rows, D, hasQP) {
    return table(id, [
      { k: 'cluster', l: 'Cluster', f: r => `<b>${esc(r.cluster)}</b>` }, { k: 'folder', l: 'Folder', f: r => `<code>${esc(r.folder)}</code>`, csv: r => r.folder },
      { k: 'urls', l: 'URLs with impressions', r: 1, f: r => fmtN(r.urls) },
      { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) + ' ' + dchip(r.dClicks) }, { k: 'impr', l: 'Impressions', r: 1, f: r => fmtN(r.impr) },
      { k: 'ctr', l: 'CTR', r: 1, f: r => pct1(r.ctr) }, { k: 'pos', l: 'Position', r: 1, f: r => r.impr ? posTag(r.pos) : '—', csv: r => r.pos },
      ...(hasQP ? [{ k: 'nC', l: 'Non-branded clicks', r: 1, f: r => fmtN(r.nC) }, { k: 'nPos', l: 'NB position', r: 1, f: r => r.nPos ? posTag(r.nPos) : '—', csv: r => r.nPos }, { k: 'bShare', l: 'Branded share', r: 1, f: r => r.bShare == null ? '—' : pct1(r.bShare), csv: r => r.bShare }] : [])
    ], rows, { file: 'unstop-clusters-by-folder', sort: 'clicks', pageSize: 40, searchKeys: ['cluster', 'folder'], placeholder: 'Filter clusters or folders', filters: [clusterFilter(D)] });
  }
  const sumM = list => { const o = { clicks: 0, impr: 0, posW: 0 }; list.forEach(x => { o.clicks += x.clicks; o.impr += x.impr; o.posW += x.pos * x.impr; }); return { clicks: o.clicks, impr: o.impr, ctr: o.impr ? o.clicks / o.impr * 100 : 0, pos: o.impr ? o.posW / o.impr : 0 }; };

  V.urlclusters = (A, D) => {
    demoFill(D);
    Object.keys(TABLES).filter(k => k.startsWith('t-un-cl')).forEach(k => delete TABLES[k]);
    window.CW_LAST_A = A;
    const secOf = sectioner(D), { typeOf } = tools(D);
    const X = clustersData(A, D), st = X.st;
    const intro = head('Clusters: branded vs non-branded', `Clicks, impressions, CTR and position for every Unstop URL cluster, always split into branded and non-branded searches, with keyword counts in the top 3, top 10 and positions 11–20. ${D.prevStart ? `Changes compare with ${fmtD(D.prevStart)} – ${fmtD(D.prevEnd)}.` : 'Turn on “Compare with the previous period” to see changes.'}`);
    if (X.live && (!st || st.status === 'loading')) {
      return { html: intro + `<div class="note"><span id="un-cl-prog">${st ? `Loading clusters from Search Console… ${st.done} of ${st.total}` : 'Starting…'}</span><br><small>Each cluster is queried separately (${D.prevStart ? 8 : 4} Search Console calls per cluster) so branded and non-branded totals are exact. Takes about a minute.</small></div>`, mount: () => { if (!st) loadClusters(D, A); } };
    }
    const typeName = id => id === 'other' ? 'Other' : typeOf.label(id);
    const rows = secOf.sections.map(sec => { const m = X.models.get(sec.id); return m && (m.tot.impr || m.tot.clicks) ? { id: sec.id, name: sec.name, type: sec.type, typeName: typeName(sec.type), m } : null; }).filter(Boolean);
    const order = id => U.CORE.includes(id) ? U.CORE.indexOf(id) : 10 + ['prod', 'home', 'util', 'other'].indexOf(id);
    rows.sort((a, b) => order(a.type) - order(b.type) || b.m.tot.clicks - a.m.tot.clicks);
    // page-type rollup
    const tmap = new Map(); rows.forEach(r => { const t = tmap.get(r.type) || { type: r.type, name: r.typeName, list: [] }; t.list.push(r.m); tmap.set(r.type, t); });
    const trows = [...tmap.values()].sort((a, b) => order(a.type) - order(b.type)).map(t => ({ name: t.name, n: t.list.length, tot: sumM(t.list.map(m => m.tot)), b: sumM(t.list.map(m => m.b)), nb: sumM(t.list.map(m => m.nb)), anon: t.list.reduce((a, m) => a + m.anon.clicks, 0), n10: t.list.reduce((a, m) => a + m.buckets.n.top10, 0), n11: t.list.reduce((a, m) => a + m.buckets.n.p11, 0) }));
    const hasPrev = rows.some(r => r.m.prevBuckets);
    const typeFilter = [{ key: 'typeName', label: 'Page type', options: [...new Set(rows.map(r => r.typeName))].map(n => [n, n]), test: (r, v) => r.typeName === v }];
    const note = X.live ? `<div class="note">Exact Search Console totals per cluster (page filter per cluster). <b>Anonymised</b> = clicks Google reports for the cluster without a query; they belong to neither branded nor non-branded. Brand terms are set in Settings. Loaded ${when(st.at)}.${st.error ? `<br><span class="start-error">Some clusters failed: ${esc(st.error)}</span>` : ''} <button class="btn-quiet sm" type="button" id="un-cl-reload">Reload</button></div>`
      : D.source === 'demo' ? `<div class="note"><b>Sample data.</b> ${D.sampleOf === 'unstop' ? 'Unstop’s URL structure with generated numbers, computed the same way as a live connection.' : 'Fictional site, so the Unstop clusters mostly fall under Other.'} Connect Search Console for real numbers.</div>`
      : `<div class="note"><b>Estimate.</b> Without a Search Console connection, cluster totals come from the page report and the branded split from query × page rows. Connect Search Console for exact branded / non-branded totals per cluster.</div>`;
    const bar = (b, n) => { const t = b + n; return t ? `<span class="un-bar" title="Non-branded ${pct1(n / t * 100)}"><i style="width:${(n / t * 100).toFixed(1)}%"></i></span>` : ''; };
    const html = intro + scopePicker(A, D) + note +
      `<section class="panel"><div class="panel-h"><h2>By page type</h2><p>Sum of the clusters below. Never read the sitewide total on its own.</p></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Page type</th><th class="r">Clusters</th><th class="r">All clicks</th><th class="r">Non-branded clicks</th><th class="r">NB impr.</th><th class="r">NB CTR</th><th class="r">NB position</th><th class="r">Branded clicks</th><th class="r">Branded CTR</th>${X.live ? '<th class="r">Anonymised</th>' : ''}<th class="r">NB top 10</th><th class="r">NB 11–20</th><th>Non-branded share</th></tr></thead><tbody>
        ${trows.map(t => `<tr><td><b>${esc(t.name)}</b></td><td class="r">${t.n}</td><td class="r">${fmtN(t.tot.clicks)}</td><td class="r">${fmtN(Math.round(t.nb.clicks))}</td><td class="r">${fmtN(Math.round(t.nb.impr))}</td><td class="r">${pct1(t.nb.ctr)}</td><td class="r">${t.nb.impr ? posTag(t.nb.pos) : '—'}</td><td class="r">${fmtN(Math.round(t.b.clicks))}</td><td class="r">${pct1(t.b.ctr)}</td>${X.live ? `<td class="r">${fmtN(t.anon)}</td>` : ''}<td class="r">${fmtN(t.n10)}</td><td class="r">${fmtN(t.n11)}</td><td>${bar(t.b.clicks, t.nb.clicks)}</td></tr>`).join('')}
      </tbody></table></div></div></section>` +
      `<section class="panel"><div class="panel-h"><h2>Clusters: clicks, impressions, CTR, position</h2><p>Non-branded first. ${X.live || D.source === 'demo' ? '' : 'Branded / non-branded are estimates.'}</p></div>
        ${table('t-un-clv', [
        { k: 'name', l: 'Cluster', f: r => `<a href="#un-cl-${esc(r.id)}" data-cl="${esc(r.id)}"><b>${esc(r.name)}</b></a> <a class="un-go" href="${esc(focusHref({ c: r.id }))}">Analyse →</a><br><small class="un-n">${esc((secOf.sections.find(x => x.id === r.id) || { rules: [] }).rules.join(', '))}</small>`, csv: r => r.name },
        { k: 'clicks', l: 'All clicks', r: 1, f: r => fmtN(r.m.tot.clicks) + ' ' + dchip(r.m.d && r.m.d.clicks), csv: r => r.m.tot.clicks },
        { k: 'impr', l: 'All impr.', r: 1, f: r => fmtN(r.m.tot.impr), csv: r => r.m.tot.impr },
        { k: 'nbClicks', l: 'NB clicks', r: 1, f: r => fmtN(Math.round(r.m.nb.clicks)) + ' ' + dchip(r.m.d && r.m.d.nbClicks), csv: r => Math.round(r.m.nb.clicks) },
        { k: 'nbImpr', l: 'NB impr.', r: 1, f: r => fmtN(Math.round(r.m.nb.impr)) + ' ' + dchip(r.m.d && r.m.d.nbImpr), csv: r => Math.round(r.m.nb.impr) },
        { k: 'nbCtr', l: 'NB CTR', r: 1, f: r => pct1(r.m.nb.ctr), csv: r => r.m.nb.ctr },
        { k: 'nbPos', l: 'NB position', r: 1, f: r => r.m.nb.impr ? posTag(r.m.nb.pos) + ' ' + dchip(r.m.d && r.m.d.nbPos, true, 'pos') : '—', csv: r => r.m.nb.pos },
        { k: 'bClicks', l: 'Branded clicks', r: 1, f: r => fmtN(Math.round(r.m.b.clicks)) + ' ' + dchip(r.m.d && r.m.d.bClicks), csv: r => Math.round(r.m.b.clicks) },
        { k: 'bImpr', l: 'Branded impr.', r: 1, f: r => fmtN(Math.round(r.m.b.impr)), csv: r => Math.round(r.m.b.impr) },
        { k: 'bCtr', l: 'Branded CTR', r: 1, f: r => pct1(r.m.b.ctr), csv: r => r.m.b.ctr },
        { k: 'bPos', l: 'Branded position', r: 1, f: r => r.m.b.impr ? posTag(r.m.b.pos) : '—', csv: r => r.m.b.pos },
        ...(X.live ? [{ k: 'anon', l: 'Anonymised clicks', r: 1, f: r => fmtN(r.m.anon.clicks), csv: r => r.m.anon.clicks }] : []),
        { k: 'bShare', l: 'Branded share', r: 1, f: r => r.m.bShare == null ? '—' : pct1(r.m.bShare), csv: r => r.m.bShare }
      ], rows.map(r => ({ ...r, clicks: r.m.tot.clicks, impr: r.m.tot.impr, nbClicks: r.m.nb.clicks, nbImpr: r.m.nb.impr, nbCtr: r.m.nb.ctr, nbPos: r.m.nb.impr ? r.m.nb.pos : 999, bClicks: r.m.b.clicks, bImpr: r.m.b.impr, bCtr: r.m.b.ctr, bPos: r.m.b.impr ? r.m.b.pos : 999, anon: r.m.anon.clicks, bShare: r.m.bShare })),
        { search: false, file: 'unstop-clusters-branded-vs-nonbranded', pageSize: 40, filters: typeFilter })}</section>` +
      `<section class="panel"><div class="panel-h"><h2>Folders inside each cluster</h2><p>Every cluster split by the folder rule its pages matched (e.g. <code>/internship</code> vs <code>/internships</code>). Totals from the page report${(D.QP && D.QP.length) ? '; non-branded clicks and branded share from query × page rows' + (X.live ? ' (the first 25,000 Search Console returns, so they can be lower than the cluster totals above)' : '') : ''}.</p></div>
        ${folderTable('t-un-clf', gscFolderRows(A, D), D, !!(D.QP && D.QP.length))}</section>` +
      `<section class="panel"><div class="panel-h"><h2>Keyword ranking buckets by cluster</h2><p>Queries counted once per cluster at the cluster’s average position for that query. ${hasPrev ? 'Change vs the previous period in brackets.' : ''}${rows.some(r => r.m.capped) ? ' Clusters marked * have more than 25,000 queries; counts cover the 25,000 with most clicks.' : ''}</p></div>
        ${table('t-un-clr', [
        { k: 'name', l: 'Cluster', f: r => `<b>${esc(r.name)}</b>${r.m.capped ? ' *' : ''}` },
        { k: 'n3', l: 'NB top 3', r: 1, f: r => cnt(r.n3, r.m.prevBuckets && r.m.prevBuckets.n.top3, !!r.m.prevBuckets) },
        { k: 'n10', l: 'NB top 10', r: 1, f: r => cnt(r.n10, r.m.prevBuckets && r.m.prevBuckets.n.top10, !!r.m.prevBuckets) },
        { k: 'n11', l: 'NB 11–20 (quick wins)', r: 1, f: r => cnt(r.n11, r.m.prevBuckets && r.m.prevBuckets.n.p11, !!r.m.prevBuckets) },
        { k: 'nt', l: 'NB queries', r: 1, f: r => fmtN(r.nt) },
        { k: 'b3', l: 'Branded top 3', r: 1, f: r => cnt(r.b3, r.m.prevBuckets && r.m.prevBuckets.b.top3, !!r.m.prevBuckets) },
        { k: 'b10', l: 'Branded top 10', r: 1, f: r => cnt(r.b10, r.m.prevBuckets && r.m.prevBuckets.b.top10, !!r.m.prevBuckets) },
        { k: 'b11', l: 'Branded 11–20', r: 1, f: r => fmtN(r.b11) },
        { k: 'bt', l: 'Branded queries', r: 1, f: r => fmtN(r.bt) }
      ], rows.map(r => ({ ...r, n3: r.m.buckets.n.top3, n10: r.m.buckets.n.top10, n11: r.m.buckets.n.p11, nt: r.m.buckets.n.total, b3: r.m.buckets.b.top3, b10: r.m.buckets.b.top10, b11: r.m.buckets.b.p11, bt: r.m.buckets.b.total })),
        { search: false, file: 'unstop-cluster-ranking-buckets', pageSize: 40, filters: typeFilter })}</section>` +
      `<section class="panel"><div class="panel-h"><h2>Inside a cluster: query clusters and quick wins</h2><p>Pick a cluster to see its non-branded searches by query cluster (rules in Funnel setup) and its non-branded queries in positions 11–20.</p></div><div class="panel-b">
        <label class="field"><span>Cluster</span><select id="un-cl-pick">${rows.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></label>
        <div id="un-cl-detail"></div></div></section>`;
    const detail = id => {
      const r = rows.find(x => x.id === id); const el = document.getElementById('un-cl-detail'); if (!r || !el) return;
      const m = r.m;
      el.innerHTML = `<div class="grid-2 even"><div><h3 class="un-sub">${esc(r.name)}: query clusters</h3><div class="tw"><table class="un-mini"><thead><tr><th>Query cluster</th><th class="r">NB clicks</th><th class="r">NB impr.</th><th class="r">NB CTR</th><th class="r">NB pos.</th><th class="r">Top 3</th><th class="r">Top 10</th><th class="r">11–20</th><th class="r">Branded clicks</th></tr></thead><tbody>${m.byQueryCluster.length ? m.byQueryCluster.map(c => `<tr><td><b>${esc(c.name)}</b></td><td class="r">${fmtN(c.nb.clicks)}</td><td class="r">${fmtN(c.nb.impr)}</td><td class="r">${pct1(c.nb.ctr)}</td><td class="r">${c.nb.impr ? posTag(c.nb.pos) : '—'}</td><td class="r">${fmtN(c.n3)}</td><td class="r">${fmtN(c.n10)}</td><td class="r">${fmtN(c.n11)}</td><td class="r">${fmtN(c.b.clicks)}</td></tr>`).join('') : '<tr><td colspan="9" class="empty">No query rows for this cluster.</td></tr>'}</tbody></table></div></div>
        <div><h3 class="un-sub">${esc(r.name)}: non-branded queries in positions 11–20</h3><div class="tw"><table class="un-mini"><thead><tr><th>Query</th><th class="r">Impr.</th><th class="r">Clicks</th><th class="r">Position</th></tr></thead><tbody>${m.quick.length ? m.quick.slice(0, 25).map(q => `<tr><td class="q">${esc(q.q)}</td><td class="r">${fmtN(q.impr)}</td><td class="r">${fmtN(q.clicks)}</td><td class="r">${posTag(q.pos)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">None in this period.</td></tr>'}</tbody></table></div></div></div>`;
    };
    const mount = () => {
      ['t-un-clv', 't-un-clf', 't-un-clr'].forEach(drawTable); scopeMount(D);
      const pick = document.getElementById('un-cl-pick');
      if (pick) { pick.addEventListener('change', () => detail(pick.value)); detail(pick.value); }
      const tv = document.getElementById('t-un-clv'); if (tv) tv.addEventListener('click', e => { const a = e.target.closest('[data-cl]'); if (!a || !pick) return; e.preventDefault(); pick.value = a.dataset.cl; detail(a.dataset.cl); pick.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
      const rl = document.getElementById('un-cl-reload'); if (rl) rl.addEventListener('click', () => { CL.delete(clKey(D)); loadClusters(D, A); });
    };
    return { html, mount };
  };

  // ════════════════════════════ SECTION / LANDING PAGE ANALYSIS ════════════════════════════
  // One cluster, one folder inside it, or one landing page through the whole chain: Search Console
  // (branded vs non-branded, ranking buckets, queries, quick wins), GA4 (sessions vs last year, device,
  // state, signups, actions) and its pages. Chosen from the picker at the top of every Unstop screen.
  const FOC = new Map(); // key → { status, model, error }
  const fParams = () => { const h = location.hash, i = h.indexOf('?'); return new URLSearchParams(i >= 0 ? h.slice(i + 1) : ''); };
  function scopeOf(D) {
    const p = fParams(), so = sectioner(D);
    const u = p.get('u'), c = p.get('c'), f = p.get('f');
    if (u) { const path = U.pathOnly(u); return { kind: 'page', path, id: so(path), label: path, test: x => U.pathOnly(x).toLowerCase() === path.toLowerCase() }; }
    if (c) {
      const sec = so.sections.find(x => x.id === c); if (!sec) return null;
      if (f) return { kind: 'folder', id: c, folder: f, label: `${sec.name} › ${f}`, test: x => so(x) === c && so.folderOf(x) === f };
      return { kind: 'cluster', id: c, label: sec.name, test: x => so(x) === c };
    }
    return null;
  }
  const focusHref = o => '#focus?' + new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();
  // picker shown at the top of the Unstop screens
  function scopePicker(A, D, sc) {
    const so = sectioner(D);
    const folders = new Map(); (A.P || []).forEach(r => { const id = so(r.p), f = so.folderOf(r.p); if (!folders.has(id)) folders.set(id, new Map()); const m = folders.get(id); m.set(f, (m.get(f) || 0) + (+r.clicks || 0)); });
    const cur = sc || {};
    const fl = cur.id && folders.get(cur.id) ? [...folders.get(cur.id).entries()].sort((a, b) => b[1] - a[1]) : [];
    const pages = (A.P || []).slice().sort((a, b) => b.clicks - a.clicks).slice(0, 800).map(r => U.pathOnly(r.p));
    return `<form class="un-scope" id="un-scope">
      <span class="un-scope-t">Analyse</span>
      <label class="field"><span>Section (cluster)</span><select id="un-sc-c"><option value="">Choose a cluster…</option>${so.sections.filter(x => folders.has(x.id)).map(x => `<option value="${esc(x.id)}" ${cur.id === x.id && cur.kind !== 'page' ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Folder inside it</span><select id="un-sc-f" ${fl.length ? '' : 'disabled'}><option value="">All folders</option>${fl.map(([f, c]) => `<option value="${esc(f)}" ${cur.folder === f ? 'selected' : ''}>${esc(f)} (${fmtN(c)} clicks)</option>`).join('')}</select></label>
      <span class="un-scope-or">or</span>
      <label class="field un-grow"><span>Landing page</span><input type="text" id="un-sc-u" list="un-sc-pages" value="${esc(cur.kind === 'page' ? cur.path : '')}" placeholder="/internship or https://unstop.com/hackathons/…" spellcheck="false" autocomplete="off"><datalist id="un-sc-pages">${pages.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
      <button class="btn-primary sm" type="submit">Analyse</button>
    </form>`;
  }
  function scopeMount(D) {
    const f = document.getElementById('un-scope'); if (!f) return;
    const c = document.getElementById('un-sc-c'), fo = document.getElementById('un-sc-f'), u = document.getElementById('un-sc-u');
    c.addEventListener('change', () => { u.value = ''; location.hash = c.value ? focusHref({ c: c.value }) : '#focus'; });
    fo.addEventListener('change', () => { location.hash = focusHref({ c: c.value, f: fo.value }); });
    f.addEventListener('submit', e => { e.preventDefault(); const v = u.value.trim(); location.hash = v ? focusHref({ u: U.pathOnly(v) }) : c.value ? focusHref({ c: c.value, f: fo.value }) : '#focus'; });
  }
  // live Search Console numbers for the scope (exact totals, its own query list)
  async function loadScope(D, A, sc, key) {
    const src = window.CW_SOURCE; if (!src || !src.gsc || !A.brandRx) return;
    FOC.set(key, { status: 'loading' }); rerender();
    try {
      const so = sectioner(D), s = settings(D.site);
      let filters;
      if (sc.kind === 'page') filters = [{ dimension: 'page', operator: 'includingRegex', expression: '^https?://[^/]+' + sc.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?(\\?.*)?$' }];
      else {
        const sec = so.sections.find(x => x.id === sc.id);
        const rules = sc.kind === 'folder' ? sec.rules.filter(r => String(r).trim().replace(/^=/, '').replace(/\*$/, '…') === sc.folder) : sec.rules;
        filters = [{ dimension: 'page', operator: 'includingRegex', expression: U.sectionRegex({ id: sec.id, rules }, null) }];
        const ex = U.sectionExclude(sec, s.sections); if (ex) filters.push({ dimension: 'page', operator: 'excludingRegex', expression: ex });
      }
      const agg = (st, en, brand) => src.gsc.query({ startDate: st, endDate: en, type: 'web', rowLimit: 1, dimensionFilterGroups: [{ groupType: 'and', filters: filters.concat(brand == null ? [] : [{ dimension: 'query', operator: brand ? 'includingRegex' : 'excludingRegex', expression: A.brandRx }]) }] }).then(d => (d.rows || [])[0] || null);
      const qs = (st, en) => src.gsc.query({ startDate: st, endDate: en, type: 'web', dimensions: ['query'], rowLimit: 25000, dimensionFilterGroups: [{ groupType: 'and', filters }] }).then(d => (d.rows || []).map(r => ({ q: r.keys[0], clicks: r.clicks, impr: r.impressions, pos: r.position })));
      const cur = await Promise.all([agg(D.start, D.end), agg(D.start, D.end, true), agg(D.start, D.end, false), qs(D.start, D.end)]);
      const prev = D.prevStart ? await Promise.all([agg(D.prevStart, D.prevEnd), agg(D.prevStart, D.prevEnd, true), agg(D.prevStart, D.prevEnd, false), qs(D.prevStart, D.prevEnd)]) : [];
      FOC.set(key, { status: 'done', model: U.sectionModel({ tot: cur[0], b: cur[1], nb: cur[2], queries: cur[3], capped: cur[3].length >= 25000, prevTot: prev[0], prevB: prev[1], prevNb: prev[2], prevQueries: prev[3] || null }, brandOf(A), tools(D).clusterOf) });
    } catch (e) { FOC.set(key, { status: 'error', error: e.message }); }
    rerender();
  }
  // the same model from loaded rows (uploads and sample data)
  function scopeFromRows(A, D, sc) {
    const isB = brandOf(A), P = (A.P || []).filter(r => sc.test(r.p)), PP = (D.prevP || []).filter(r => sc.test(r.p));
    const qm = new Map(); (D.QP || []).filter(r => sc.test(r.p)).forEach(r => { const o = qm.get(r.q) || { q: r.q, clicks: 0, impr: 0, posW: 0 }; o.clicks += +r.clicks || 0; o.impr += +r.impr || 0; o.posW += (+r.pos || 0) * (+r.impr || 0); qm.set(r.q, o); });
    const queries = [...qm.values()].map(o => ({ q: o.q, clicks: o.clicks, impr: o.impr, pos: o.impr ? o.posW / o.impr : 0 }));
    const tot = l => { const o = { clicks: 0, impressions: 0, pw: 0 }; l.forEach(r => { o.clicks += +r.clicks || 0; o.impressions += +r.impr || 0; o.pw += (+r.pos || 0) * (+r.impr || 0); }); o.position = o.impressions ? o.pw / o.impressions : 0; return o; };
    const m = U.sectionModel({ tot: tot(P), b: tot(queries.filter(r => isB(r.q))), nb: tot(queries.filter(r => !isB(r.q))), queries, prevTot: PP.length ? tot(PP) : null, prevB: null, prevNb: null }, isB, tools(D).clusterOf);
    if (D.source !== 'demo') m.estimated = true;
    return m;
  }

  V.focus = (A, D) => {
    demoFill(D);
    window.CW_LAST_A = A;
    Object.keys(TABLES).filter(k => k.startsWith('t-un-fo')).forEach(k => delete TABLES[k]);
    const sc = scopeOf(D);
    const intro = head(sc ? sc.label : 'Section & landing page analysis', 'One cluster, one folder inside it, or one landing page through the whole chain: Search Console visibility (branded vs non-branded), GA4 traffic vs last year, signups and actions.');
    const picker = scopePicker(A, D, sc);
    if (!sc) return { html: intro + picker + '<div class="note">Pick a section (cluster) and, if you want, a folder inside it, or type a landing page.</div>', mount: () => scopeMount(D) };
    const so = sectioner(D);
    const live = window.CW_SOURCE && window.CW_SOURCE.kind === 'api' && window.CW_SOURCE.gsc;
    const key = [D.site, D.start, D.end, D.prevStart || '', sc.kind, sc.id || '', sc.folder || '', sc.path || ''].join('|');
    const F = live ? FOC.get(key) : { status: 'done', model: scopeFromRows(A, D, sc) };
    // pages in scope (Search Console page report)
    const pages = withCluster(D, (A.P || []).filter(r => sc.test(r.p)), r => r.p);
    const prevBy = new Map((D.prevP || []).filter(r => sc.test(r.p)).map(r => [r.p, r]));
    // GA4 in scope
    const g = GA.get(D.site), M = gaModel(D);
    const gp = M ? M.pages.filter(p => sc.test(p.path)) : [];
    const gt = k => gp.reduce((a, p) => a + (p[k] || 0), 0);
    const ses = gt('sessions'), ys = gt('ySessions'), nu = gt('newUsers'), yn = gt('yNewUsers'), sg = gt('signups');
    const crossOf = (name, dim) => { if (!g || !g.raw || !g.raw[name]) return []; const m = new Map(); U.gaRows(g.raw[name]).filter(r => sc.test(r.landingPage)).forEach(r => { const k = r[dim] || '(not set)'; const o = m.get(k) || { key: k, sessions: 0, ySessions: 0, newUsers: 0 }; if (r.range === 'yoy') o.ySessions += r.sessions; else { o.sessions += r.sessions; o.newUsers += r.newUsers; } m.set(k, o); }); return [...m.values()].map(o => ({ ...o, dSessions: U.chg(o.sessions, o.ySessions), share: ses ? o.sessions / ses * 100 : 0 })).sort((a, b) => b.sessions - a.sessions); };
    const dev = crossOf('landingDevice', 'deviceCategory'), st = crossOf('landingRegion', 'region').slice(0, 12);
    const kp = (l, v, d, sub) => `<div class="un-kpi"><span>${esc(l)}</span><b>${v}</b><small>${d || ''} ${sub || ''}</small></div>`;
    const sectionName = sc.kind === 'page' ? `${so.label(sc.id)} › <code>${esc(so.folderOf(sc.path))}</code>` : '';
    let gsc = '';
    if (live && (!F || F.status === 'loading')) gsc = '<div class="note">Loading this section from Search Console…</div>';
    else if (F && F.status === 'error') gsc = `<div class="note"><span class="start-error">${esc(F.error)}</span></div>`;
    else {
      const m = F.model, pb = m.prevBuckets;
      gsc = `<h2 class="un-sub">Search Console${m.estimated ? ' <small class="un-n">(branded split from query × page rows)</small>' : ''}</h2>
      <div class="un-kpis">
        ${kp('Clicks', fmtN(m.tot.clicks), dchip(m.d && m.d.clicks), 'vs previous period')}
        ${kp('Impressions', fmtN(m.tot.impr), dchip(m.d && m.d.impr), '')}
        ${kp('CTR', pct1(m.tot.ctr), '', 'position ' + (m.tot.impr ? m.tot.pos.toFixed(1) : '—'))}
        ${kp('Non-branded clicks', fmtN(Math.round(m.nb.clicks)), dchip(m.d && m.d.nbClicks), `CTR ${pct1(m.nb.ctr)} · pos. ${m.nb.impr ? m.nb.pos.toFixed(1) : '—'}`)}
        ${kp('Branded clicks', fmtN(Math.round(m.b.clicks)), dchip(m.d && m.d.bClicks), `CTR ${pct1(m.b.ctr)} · pos. ${m.b.impr ? m.b.pos.toFixed(1) : '—'}`)}
        ${kp('NB keywords top 3', fmtN(m.buckets.n.top3), pb ? cnt(m.buckets.n.top3, pb.n.top3, true).replace(/^[^<]*/, '') : '', '')}
        ${kp('NB keywords top 10', fmtN(m.buckets.n.top10), pb ? cnt(m.buckets.n.top10, pb.n.top10, true).replace(/^[^<]*/, '') : '', '')}
        ${kp('NB keywords 11–20', fmtN(m.buckets.n.p11), pb ? cnt(m.buckets.n.p11, pb.n.p11, true).replace(/^[^<]*/, '') : '', 'quick wins')}
      </div>
      <div class="grid-2 even"><section class="panel"><div class="panel-h"><h2>Query clusters</h2></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Query cluster</th><th class="r">NB clicks</th><th class="r">NB impr.</th><th class="r">NB pos.</th><th class="r">Top 10</th><th class="r">11–20</th><th class="r">Branded clicks</th></tr></thead><tbody>${m.byQueryCluster.map(c => `<tr><td><b>${esc(c.name)}</b></td><td class="r">${fmtN(c.nb.clicks)}</td><td class="r">${fmtN(c.nb.impr)}</td><td class="r">${c.nb.impr ? posTag(c.nb.pos) : '—'}</td><td class="r">${fmtN(c.n10)}</td><td class="r">${fmtN(c.n11)}</td><td class="r">${fmtN(c.b.clicks)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No query rows.</td></tr>'}</tbody></table></div></div></section>
      <section class="panel"><div class="panel-h"><h2>Quick wins: non-branded queries in positions 11–20</h2></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Query</th><th class="r">Impr.</th><th class="r">Clicks</th><th class="r">Position</th></tr></thead><tbody>${m.quick.slice(0, 20).map(q => `<tr><td class="q">${esc(q.q)}</td><td class="r">${fmtN(q.impr)}</td><td class="r">${fmtN(q.clicks)}</td><td class="r">${posTag(q.pos)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">None in this period.</td></tr>'}</tbody></table></div></div></section></div>
      <section class="panel"><div class="panel-h"><h2>Top queries</h2></div>${table('t-un-foq', [{ k: 'q', l: 'Query', cls: 'q', f: r => esc(r.q) }, { k: 'brand', l: 'Branded', f: r => r.brand ? '<span class="un-st file">Branded</span>' : 'Non-branded', csv: r => r.brand ? 'branded' : 'non-branded' }, { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) }, { k: 'impr', l: 'Impr.', r: 1, f: r => fmtN(r.impr) }, { k: 'ctr', l: 'CTR', r: 1, f: r => pct1(r.ctr) }, { k: 'pos', l: 'Position', r: 1, f: r => posTag(r.pos) }],
        (m.queryList || []).map(q => ({ ...q, ctr: q.impr ? q.clicks / q.impr * 100 : 0, brand: brandOf(A)(q.q) })), { file: 'unstop-scope-queries', sort: 'clicks', pageSize: 15, placeholder: 'Filter queries', filters: [{ key: 'b', label: 'Queries', options: [['n', 'Non-branded'], ['b', 'Branded']], test: (r, v) => v === 'b' ? r.brand : !r.brand }] })}</section>`;
    }
    const ga = !g ? '<h2 class="un-sub">GA4</h2><div class="note"><a href="#ga4">Connect GA4</a> to add sessions, signups and actions for this section.</div>' :
      `<h2 class="un-sub">GA4 organic${g.sample ? ' <span class="un-st sample">Sample</span>' : ''}</h2>
      <div class="un-kpis">
        ${kp('Organic sessions', fmtN(Math.round(ses)), dchip(U.chg(ses, ys)), 'vs last year')}
        ${kp('New users', fmtN(Math.round(nu)), dchip(U.chg(nu, yn)), 'vs last year')}
        ${kp('Signups', fmtN(Math.round(sg)), '', `student ${fmtN(Math.round(gt('stu')))} · employer ${fmtN(Math.round(gt('emp')))}`)}
        ${kp('Signup CVR', pct1(ses ? sg / ses * 100 : null), '', 'signups ÷ sessions')}
        ${kp('Engagement rate', pct1(ses ? gt('engaged') / ses * 100 : null), '', '')}
        ${kp('Register / apply', fmtN(Math.round(gt('opp'))), '', ses ? (gt('opp') / ses * 100).toFixed(1) + ' per 100 sessions' : '')}
        ${kp('Product clicks', fmtN(Math.round(gt('prodClick'))), '', '')}
        ${kp('Demo + contact', fmtN(Math.round(gt('demo') + gt('contact'))), '', '')}
      </div>
      <div class="grid-2 even"><section class="panel"><div class="panel-h"><h2>Device</h2><p>vs last year</p></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Device</th><th class="r">Sessions</th><th class="r">Share</th></tr></thead><tbody>${dev.map(r => `<tr><td>${esc(r.key)}</td><td class="r">${fmtN(Math.round(r.sessions))} ${dchip(r.dSessions)}</td><td class="r">${pct1(r.share)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No device rows.</td></tr>'}</tbody></table></div></div></section>
      <section class="panel"><div class="panel-h"><h2>Indian states</h2><p>Top 12, vs last year</p></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>State</th><th class="r">Sessions</th><th class="r">Share</th></tr></thead><tbody>${st.map(r => `<tr><td>${esc(r.key)}</td><td class="r">${fmtN(Math.round(r.sessions))} ${dchip(r.dSessions)}</td><td class="r">${pct1(r.share)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No state rows.</td></tr>'}</tbody></table></div></div></section></div>`;
    const pagesTbl = sc.kind === 'page' ? '' : `<section class="panel"><div class="panel-h"><h2>Landing pages in this section</h2><p>Click a page to analyse it on its own.</p></div>${table('t-un-fop', [
      { k: 'path', l: 'Page', cls: 'u', f: r => `<a href="${esc(focusHref({ u: r.path }))}">${esc(r.path)}</a>`, csv: r => r.p }, { k: 'folder', l: 'Folder', f: r => `<code>${esc(r.folder)}</code>`, csv: r => r.folder },
      { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) + ' ' + dchip(r.dClicks) }, { k: 'impr', l: 'Impr.', r: 1, f: r => fmtN(r.impr) }, { k: 'ctr', l: 'CTR', r: 1, f: r => pct1(r.ctr) }, { k: 'pos', l: 'Position', r: 1, f: r => posTag(r.pos) },
      ...(M ? [{ k: 'sessions', l: 'Organic sessions', r: 1, f: r => r.ga ? fmtN(Math.round(r.ga.sessions)) + ' ' + dchip(r.ga.dSessions) : '—', csv: r => r.ga ? r.ga.sessions : '' }, { k: 'signups', l: 'Signups', r: 1, f: r => r.ga ? fmtN(Math.round(r.ga.signups)) : '—', csv: r => r.ga ? r.ga.signups : '' }, { k: 'cvr', l: 'CVR', r: 1, f: r => r.ga ? pct1(r.ga.cvr) : '—', csv: r => r.ga ? r.ga.cvr : '' }] : [])
    ], pages.map(r => { const pr = prevBy.get(r.p), gaP = gp.find(x => x.path.toLowerCase() === U.pathOnly(r.p).toLowerCase()); return { ...r, path: U.pathOnly(r.p), dClicks: pr ? U.chg(r.clicks, pr.clicks) : null, ga: gaP || null, sessions: gaP ? gaP.sessions : -1, signups: gaP ? gaP.signups : -1, cvr: gaP ? gaP.cvr : -1 }; }), { file: 'unstop-scope-pages', sort: 'clicks', pageSize: 20, searchKeys: ['path', 'folder'], placeholder: 'Filter URLs' })}</section>`;
    const html = intro + picker + (sectionName ? `<p class="un-meta">Cluster › folder: ${sectionName} · <a href="${esc(focusHref({ c: sc.id }))}">analyse the whole cluster</a></p>` : sc.kind === 'folder' ? `<p class="un-meta"><a href="${esc(focusHref({ c: sc.id }))}">Back to the whole cluster</a></p>` : '') +
      `<p class="un-meta">${fmtN(pages.length)} page${pages.length === 1 ? '' : 's'} with Search Console data${M ? ` · ${fmtN(gp.length)} organic landing page${gp.length === 1 ? '' : 's'} in GA4` : ''}</p>` + gsc + ga + pagesTbl;
    const mount = () => { scopeMount(D); ['t-un-foq', 't-un-fop'].forEach(drawTable); if (live && !F) loadScope(D, A, sc, key); };
    return { html, mount };
  };

  // ════════════════════════════ GA4 ════════════════════════════
  let gaToken = null, gaExp = 0, gaClient = null;
  function sessTok() { try { const v = JSON.parse(sessionStorage.getItem('un:ga-tok')); if (v && v.t && v.exp > Date.now() + 30000) return v; } catch (e) { } return null; }
  function token() { if (gaToken && gaExp > Date.now() + 30000) return gaToken; const s = sessTok(); if (s) { gaToken = s.t; gaExp = s.exp; return gaToken; } return null; }
  function signIn() {
    return new Promise((res, rej) => {
      const cid = window.CW_CONFIG && window.CW_CONFIG.googleClientId;
      if (!cid || !window.google || !google.accounts || !google.accounts.oauth2) { rej(new Error('Google sign-in did not load. Check your connection or ad blocker, then reload.')); return; }
      gaClient = google.accounts.oauth2.initTokenClient({ client_id: cid, scope: GA_SCOPE,
        callback: r => { if (r.error) { rej(new Error('GA4 sign-in was not completed: ' + r.error)); return; } gaToken = r.access_token; gaExp = Date.now() + (+r.expires_in || 3600) * 1000; try { sessionStorage.setItem('un:ga-tok', JSON.stringify({ t: gaToken, exp: gaExp })); } catch (e) { } res(gaToken); },
        error_callback: e => rej(new Error(e && e.type === 'popup_closed' ? 'The sign-in window was closed before finishing.' : 'Sign-in failed. Allow pop-ups for this site and try again.')) });
      gaClient.requestAccessToken({ prompt: '' });
    });
  }
  async function gaFetch(url, body) {
    const t = token(); if (!t) throw new Error('Connect GA4 first.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (res.ok) return res.json();
      const j = await res.json().catch(() => ({}));
      const msg = (j.error && j.error.message) || res.statusText;
      if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
      if (res.status === 401) { gaToken = null; try { sessionStorage.removeItem('un:ga-tok'); } catch (e) { } throw new Error('Your GA4 session expired. Connect GA4 again.'); }
      if (res.status === 403 && /has not been used|disabled/i.test(msg)) throw new Error('The Google Analytics Data API (and Admin API, for the property list) must be enabled in the Google Cloud project that owns this app’s OAuth client. ' + msg);
      if (res.status === 403) throw new Error('No access to this GA4 property with this Google account. ' + msg);
      throw new Error(msg);
    }
  }
  async function listProperties() {
    const out = []; let page = '';
    do {
      const d = await gaFetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200' + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
      (d.accountSummaries || []).forEach(a => (a.propertySummaries || []).forEach(p => out.push({ id: p.property.replace('properties/', ''), name: p.displayName, account: a.displayName })));
      page = d.nextPageToken || '';
    } while (page && out.length < 2000);
    return out;
  }
  async function runReport(pid, body) {
    const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(pid)}:runReport`;
    const first = await gaFetch(url, body);
    let rows = first.rows || [];
    const total = +first.rowCount || rows.length, lim = body.limit || 10000;
    for (let off = lim; off < total && off < lim * 4; off += lim) { const d = await gaFetch(url, { ...body, offset: off }); rows = rows.concat(d.rows || []); }
    return { ...first, rows };
  }
  async function loadGa4(D, o) {
    const s = settings(D.site);
    const reqs = U.ga4Requests({ start: o.start, end: o.end, aiSources: s.aiSources, pricingPaths: s.pricingPaths });
    const keys = Object.keys(reqs), raw = {}, failed = [];
    let done = 0;
    const prog = document.getElementById('un-ga-prog');
    await Promise.all(keys.map(k => runReport(o.property, reqs[k]).then(r => { raw[k] = r; }, e => { failed.push(k + ': ' + e.message); }).finally(() => { done++; if (prog) prog.textContent = `Loading GA4 reports… ${done} of ${keys.length}`; })));
    if (!raw.landing && failed.length) throw new Error(failed[0].replace(/^\w+: /, ''));
    GA.set(D.site, { raw, property: o.property, propertyName: o.propertyName || o.property, start: o.start, end: o.end, at: Date.now(), failed, sample: false });
  }
  function gaModel(D) {
    const g = GA.get(D.site); if (!g) return null;
    const { typeOf, s } = tools(D);
    const sig = JSON.stringify([s.events, s.types, s.rootArticles, s.sections, s.pathSections]);
    if (!g.model || g.sig !== sig) { g.model = U.ga4Model(g.raw, typeOf, s.events, { sectionOf: sectioner(D), pathSections: s.pathSections || U.DEFAULT_PATH_SECTIONS }); g.sig = sig; }
    return g.model;
  }

  V.ga4 = (A, D) => {
    demoFill(D);
    window.CW_LAST_A = A;
    Object.keys(TABLES).filter(k => k.startsWith('t-un-g')).forEach(k => delete TABLES[k]);
    const g = GA.get(D.site), s = settings(D.site);
    const intro = head('GA4 organic', 'Organic sessions and new users by page type, device and geography against the same dates last year, plus signups, engagement, employer leads, blog → product clicks and AI assistant referrals.');
    const start = (g && g.start) || D.start, end = (g && g.end) || D.end;
    const connected = !!token();
    const form = `<section class="panel un-conn"><div class="panel-b">
      <div class="un-row">
        ${connected ? '<span class="un-st live">GA4 connected</span>' : `<button class="btn-primary sm" type="button" id="un-ga-auth">Connect GA4</button>`}
        <label class="field un-f"><span>GA4 property</span>${connected ? `<select id="un-ga-prop"><option value="${esc(s.ga4Property)}">${s.ga4Property ? 'Property ' + esc(s.ga4Property) : 'Loading your properties…'}</option></select>` : `<input id="un-ga-prop" type="text" inputmode="numeric" placeholder="e.g. 312345678" value="${esc(s.ga4Property)}">`}</label>
        <label class="field un-f sm"><span>From</span><input type="date" id="un-ga-start" value="${esc(start || '')}"></label>
        <label class="field un-f sm"><span>To</span><input type="date" id="un-ga-end" value="${esc(end || '')}"></label>
        <button class="btn-primary sm" type="button" id="un-ga-go" ${connected ? '' : 'disabled'}>${g && !g.sample ? 'Reload GA4' : 'Load GA4 data'}</button>
        <button class="btn-quiet" type="button" id="un-ga-sample">Preview with sample numbers</button>
      </div>
      <p class="progress" id="un-ga-prog" aria-live="polite"></p>
      ${MSG.ga ? `<p class="start-error" role="alert">${esc(MSG.ga)}</p>` : ''}
      <p class="hint">Dates default to the Search Console period so the two line up. Year-on-year uses the same calendar dates a year earlier. Read-only access; GA4 numbers stay in this tab.</p>
    </div></section>`;
    if (!g) return { html: intro + form + `<div class="note">Connect GA4 and load the data. If sign-in at the start already granted Analytics access, no new pop-up appears. Event names for signups, demo requests, register / apply and product clicks are set in <a href="#funnelsetup">Funnel setup</a>; after loading, the event list below shows what GA4 actually records so the names can be matched.</div>`, mount: () => gaMount(D) };
    const M = gaModel(D);
    const t = M.total;
    const sampleNote = g.sample ? '<div class="note"><b>Sample numbers.</b> Generated from this site’s Search Console pages so the screens can be previewed. Connect GA4 for real data.</div>' : '';
    const emptyNote = !M.ok ? '<div class="note"><b>GA4 returned no organic sessions for these dates.</b> Check the property and dates, and that the property records the Organic Search channel.</div>' : '';
    const failNote = g.failed && g.failed.length ? `<div class="note">Some GA4 reports did not load: ${esc(g.failed.join('; '))}</div>` : '';
    const kp = (l, v, d, sub) => `<div class="un-kpi"><span>${esc(l)}</span><b>${v}</b><small>${d || ''} ${sub || ''}</small></div>`;
    const html = intro + scopePicker(A, D) + form + sampleNote + emptyNote + failNote +
      `<p class="un-meta">${esc(g.propertyName || '')} · ${fmtD(g.start)} – ${fmtD(g.end)} · loaded ${when(g.at)}</p>` +
      `<div class="un-kpis">
        ${kp('Organic sessions', fmtN(t.sessions), dchip(M.dSessions), 'vs last year')}
        ${kp('Organic new users', fmtN(t.newUsers), dchip(M.dNewUsers), 'vs last year')}
        ${kp('Student signups', fmtN(M.ev.stu), dchip(U.chg(M.ev.stu, M.ev.yStu)), 'events')}
        ${kp('Employer signups', fmtN(M.ev.emp), dchip(U.chg(M.ev.emp, M.ev.yEmp)), 'events')}
        ${kp('Signup CVR', pct1(t.sessions ? (M.ev.stu + M.ev.emp) / t.sessions * 100 : null), '', 'signups ÷ sessions')}
        ${kp('Engagement rate', pct1(t.engRate), '', fmtN(t.pps ? +t.pps.toFixed(2) : null) + ' pages / session')}
        ${kp('Demo + contact (organic)', fmtN(M.ev.demo + M.ev.contact), dchip(U.chg(M.ev.demo + M.ev.contact, M.ev.yDemo + M.ev.yContact)), '')}
        ${kp('AI assistant sessions', fmtN(M.ai.reduce((a, r) => a + r.sessions, 0)), dchip(U.chg(M.ai.reduce((a, r) => a + r.sessions, 0), M.ai.reduce((a, r) => a + r.ySessions, 0))), 'all channels')}
      </div>` +
      `<section class="panel"><div class="panel-h"><h2>Organic sessions per day vs last year</h2></div><div class="panel-b"><div class="chart-box"><canvas id="un-ga-daily" aria-label="Organic sessions per day"></canvas></div></div></section>` +
      `<section class="panel"><div class="panel-h"><h2>By page type</h2><p>Landing page classified with the same rules as Search Console. Signups and actions are events counted in organic sessions that landed on that page type.</p></div>
        ${table('t-un-gt', [
        { k: 'name', l: 'Page type', f: r => `<b>${esc(r.name)}</b>` },
        { k: 'sessions', l: 'Sessions', r: 1, f: r => fmtN(r.sessions) + ' ' + dchip(r.dSessions) },
        { k: 'newUsers', l: 'New users', r: 1, f: r => fmtN(r.newUsers) + ' ' + dchip(r.dNewUsers) },
        { k: 'engRate', l: 'Engagement rate', r: 1, f: r => pct1(r.engRate) },
        { k: 'pps', l: 'Pages / session', r: 1, f: r => r.pps == null ? '—' : r.pps.toFixed(2) },
        { k: 'stu', l: 'Student signups', r: 1, f: r => fmtN(r.stu) },
        { k: 'emp', l: 'Employer signups', r: 1, f: r => fmtN(r.emp) },
        { k: 'cvr', l: 'Signup CVR', r: 1, f: r => pct1(r.cvr) },
        { k: 'opp', l: 'Register / apply', r: 1, f: r => fmtN(r.opp) },
        { k: 'prodClick', l: 'Product clicks', r: 1, f: r => fmtN(r.prodClick) },
        { k: 'leads', l: 'Demo + contact', r: 1, f: r => fmtN(r.demo + r.contact), csv: r => r.demo + r.contact }
      ], M.types.map(r => ({ ...r, leads: r.demo + r.contact })), { search: false, file: 'unstop-ga4-by-page-type', pageSize: 30 })}</section>` +
      gaPathBlock(M, s, D) + gaCrossBlocks(M, D) +
      `<div class="grid-2 even"><section class="panel"><div class="panel-h"><h2>Device</h2></div>${splitTable('t-un-gd', 'Device', M.device)}</section>
        <section class="panel"><div class="panel-h"><h2>Country</h2></div>${splitTable('t-un-gc', 'Country', M.country)}</section></div>` +
      (M.region.length ? `<section class="panel"><div class="panel-h"><h2>Indian states and regions</h2><p>All organic sessions in India, vs the same dates last year.</p></div>${table('t-un-gr', [{ k: 'key', l: 'Region' }, { k: 'sessions', l: 'Sessions', r: 1, f: r => fmtN(r.sessions) + ' ' + dchip(r.dSessions) }, { k: 'newUsers', l: 'New users', r: 1, f: r => fmtN(r.newUsers) }], M.region, { search: false, file: 'unstop-ga4-regions', pageSize: 15 })}</section>` : '') +
      `<section class="panel"><div class="panel-h"><h2>Blog → product journeys</h2><p>Organic sessions that landed on Blog & guides and fired a product-click event (events in Funnel setup).</p></div>
        ${table('t-un-gb', [
        { k: 'path', l: 'Blog landing page', cls: 'u' }, { k: 'sessions', l: 'Sessions', r: 1, f: r => fmtN(r.sessions) },
        { k: 'prodClick', l: 'Product clicks', r: 1, f: r => fmtN(r.prodClick) }, { k: 'rate', l: 'Clicks per 100 sessions', r: 1, f: r => r.rate == null ? '—' : r.rate.toFixed(1) },
        { k: 'opp', l: 'Register / apply', r: 1, f: r => fmtN(r.opp) }, { k: 'signups', l: 'Signups', r: 1, f: r => fmtN(r.signups) }
      ], M.pages.filter(p => p.type === 'blog').map(p => ({ ...p, rate: p.sessions ? p.prodClick / p.sessions * 100 : null })), { file: 'unstop-blog-to-product', sort: 'sessions', placeholder: 'Filter blog URLs' })}</section>` +
      `<section class="panel"><div class="panel-h"><h2>Employer-facing leads from organic</h2><p>Demo requests, contact submissions and pricing-page sessions.</p></div><div class="panel-b">
        <div class="un-kpis sm">${kp('Demo requests', fmtN(M.ev.demo), dchip(U.chg(M.ev.demo, M.ev.yDemo)), '')}${kp('Contact submissions', fmtN(M.ev.contact), dchip(U.chg(M.ev.contact, M.ev.yContact)), '')}${kp('Pricing-page sessions', fmtN(M.pricing.sessions), dchip(U.chg(M.pricing.sessions, M.pricing.ySessions)), '')}</div></div>
        ${table('t-un-ge', [
        { k: 'path', l: 'Landing page', cls: 'u' }, { k: 'typeName', l: 'Page type' }, { k: 'sessions', l: 'Sessions', r: 1, f: r => fmtN(r.sessions) },
        { k: 'demo', l: 'Demo requests', r: 1, f: r => fmtN(r.demo) }, { k: 'contact', l: 'Contact', r: 1, f: r => fmtN(r.contact) }, { k: 'emp', l: 'Employer signups', r: 1, f: r => fmtN(r.emp) }
      ], M.pages.filter(p => p.type === 'emp' || p.demo + p.contact + p.emp > 0), { file: 'unstop-employer-leads', sort: 'demo', placeholder: 'Filter URLs' })}</section>` +
      `<section class="panel"><div class="panel-h"><h2>Organic vs other channels</h2><p>All channels, same dates, same event lists.</p></div>
        ${table('t-un-gch', [
        { k: 'channel', l: 'Channel', f: r => r.channel === 'Organic Search' ? `<b>${esc(r.channel)}</b>` : esc(r.channel) }, { k: 'sessions', l: 'Sessions', r: 1, f: r => fmtN(r.sessions) }, { k: 'newUsers', l: 'New users', r: 1, f: r => fmtN(r.newUsers) },
        { k: 'engRate', l: 'Engagement rate', r: 1, f: r => pct1(r.engRate) }, { k: 'stu', l: 'Student signups', r: 1, f: r => fmtN(r.stu) }, { k: 'emp', l: 'Employer signups', r: 1, f: r => fmtN(r.emp) },
        { k: 'cvr', l: 'Signup CVR', r: 1, f: r => pct1(r.cvr) }, { k: 'leads', l: 'Demo + contact', r: 1, f: r => fmtN(r.leads) }
      ], M.channels, { search: false, file: 'unstop-channels', pageSize: 20 })}</section>` +
      `<section class="panel"><div class="panel-h"><h2>AI assistant referrals</h2><p>Sessions whose source matches ${esc(s.aiSources.slice(0, 6).join(', '))}… (all channels).</p></div>
        ${table('t-un-gai', [{ k: 'source', l: 'Assistant', f: r => `<b>${esc(r.source)}</b>` }, { k: 'sessions', l: 'Sessions', r: 1, f: r => fmtN(r.sessions) + ' ' + dchip(r.dSessions) }, { k: 'engRate', l: 'Engagement rate', r: 1, f: r => pct1(r.engRate) }, { k: 'keyEvents', l: 'Key events', r: 1, f: r => fmtN(r.keyEvents) }, { k: 'raw', l: 'GA4 sources' }], M.ai, { search: false, file: 'unstop-ai-referrals', pageSize: 20 })}
        ${table('t-un-gaip', [{ k: 'path', l: 'Landing page', cls: 'u' }, { k: 'type', l: 'Page type' }, { k: 'sessions', l: 'AI sessions', r: 1, f: r => fmtN(r.sessions) }, { k: 'keyEvents', l: 'Key events', r: 1, f: r => fmtN(r.keyEvents) }], M.aiPages, { file: 'unstop-ai-landing-pages', sort: 'sessions', pageSize: 10, placeholder: 'Filter URLs' })}</section>` +
      `<section class="panel"><div class="panel-h"><h2>Landing pages</h2></div>
        ${table('t-un-gp', [
        { k: 'path', l: 'Landing page', cls: 'u' }, { k: 'cluster', l: 'Cluster' }, { k: 'folder', l: 'Folder', f: r => `<code>${esc(r.folder)}</code>`, csv: r => r.folder }, { k: 'sessions', l: 'Sessions', r: 1, f: r => fmtN(r.sessions) + ' ' + dchip(r.dSessions) }, { k: 'newUsers', l: 'New users', r: 1, f: r => fmtN(r.newUsers) },
        { k: 'engRate', l: 'Eng. rate', r: 1, f: r => pct1(r.engRate) }, { k: 'signups', l: 'Signups', r: 1, f: r => fmtN(r.signups) }, { k: 'cvr', l: 'CVR', r: 1, f: r => pct1(r.cvr) }, { k: 'opp', l: 'Register / apply', r: 1, f: r => fmtN(r.opp) }
      ], withCluster(D, M.pages, r => r.path), { file: 'unstop-ga4-landing-pages', sort: 'sessions', placeholder: 'Filter URLs or folders', searchKeys: ['path', 'folder'], filters: [{ key: 't', label: 'Page type', options: tools(D).typeOf.types.map(t => [t.name, t.name]), test: (r, v) => r.typeName === v }, clusterFilter(D)] })}</section>` +
      `<section class="panel"><div class="panel-h"><h2>Events in organic sessions</h2><p>Every event GA4 recorded in organic sessions, and which funnel step it counts toward. Change the lists in <a href="#funnelsetup">Funnel setup</a>.</p></div>
        ${table('t-un-gev', [{ k: 'name', l: 'Event name' }, { k: 'step', l: 'Counts as' }, { k: 'count', l: 'Events', r: 1, f: r => fmtN(r.count) }, { k: 'users', l: 'Users (sum by landing page)', r: 1, f: r => fmtN(r.users) }], M.events.map(e => ({ ...e, step: stepOf(e.name, s.events) })), { file: 'unstop-ga4-events', sort: 'count', placeholder: 'Filter events' })}</section>` +
      `<div class="note"><b>How to read this.</b> Events are counted in the session’s channel and landing page, so a signup made later in an organic session counts for the page that session started on. GA4’s returning-user split is not a strict 30-day return window. Branded vs non-branded is not visible in GA4; the Full funnel screen gives a labelled estimate using Search Console.</div>`;
    const mount = () => {
      gaMount(D); scopeMount(D);
      ['t-un-gt', 't-un-gpc', 't-un-gfo', 't-un-gd', 't-un-gc', 't-un-gr', 't-un-gb', 't-un-ge', 't-un-gch', 't-un-gai', 't-un-gaip', 't-un-gp', 't-un-gev'].forEach(drawTable);
      chart('un-ga-daily', { type: 'line', data: { labels: M.daily.map(d => fmtD(d.d)), datasets: [
        { label: 'Organic sessions', data: M.daily.map(d => d.sessions), borderColor: cssVar('--signal'), backgroundColor: cssVar('--signal'), tension: .25, pointRadius: 0, borderWidth: 2 },
        { label: 'Same dates last year', data: M.daily.map(d => d.ySessions), borderColor: cssVar('--muted'), borderDash: [5, 4], tension: .25, pointRadius: 0, borderWidth: 1.5 }
      ] }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } } });
    };
    return { html, mount };
  };
  const STEP_LABEL = { studentSignup: 'Student signup', employerSignup: 'Employer signup', demoRequest: 'Demo request', contactSubmit: 'Contact submission', opportunityAction: 'Register / apply', productClick: 'Product click', scroll: 'Scroll' };
  function stepOf(name, ev) { const n = String(name).toLowerCase(); const hit = Object.keys(STEP_LABEL).filter(k => (ev[k] || []).some(x => String(x).toLowerCase() === n)); return hit.map(k => STEP_LABEL[k]).join(', ') || '—'; }

  // conversion-path coverage and organic traffic by URL cluster
  function gaPathBlock(M, s, D) {
    if (!M.sections) return '';
    const c = M.pathCov || {};
    return `<section class="panel"><div class="panel-h"><h2>By URL cluster and conversion-path coverage</h2><p>Share of organic landing sessions on clusters with a clear conversion path (register, apply, post a job, book a demo). Choose the clusters in <a href="#funnelsetup">Funnel setup</a>.</p></div>
      <div class="panel-b"><div class="un-big"><b>${pct1(c.share)}</b><span>of organic sessions land on pages with a clear conversion path${c.yShare != null ? ` · ${pct1(c.yShare)} the same dates last year` : ''} · ${fmtN(Math.round(c.sessions || 0))} sessions across ${c.sections || 0} clusters</span></div></div>
      ${table('t-un-gpc', [
      { k: 'name', l: 'Cluster', f: r => `<b>${esc(r.name)}</b>` },
      { k: 'pathL', l: 'Conversion path', f: r => r.path ? '<span class="un-st live">Yes</span>' : '<span class="un-st none">No</span>', csv: r => r.path ? 'yes' : 'no' },
      { k: 'sessions', l: 'Organic sessions', r: 1, f: r => fmtN(r.sessions) + ' ' + dchip(r.dSessions) }, { k: 'share', l: 'Share', r: 1, f: r => pct1(r.share) },
      { k: 'newUsers', l: 'New users', r: 1, f: r => fmtN(r.newUsers) + ' ' + dchip(r.dNewUsers) },
      { k: 'engRate', l: 'Eng. rate', r: 1, f: r => pct1(r.engRate) }, { k: 'signups', l: 'Signups', r: 1, f: r => fmtN(r.signups) }, { k: 'cvr', l: 'Signup CVR', r: 1, f: r => pct1(r.cvr) }, { k: 'opp', l: 'Register / apply', r: 1, f: r => fmtN(r.opp) }
    ], M.sections.filter(x => x.sessions > 0 || x.ySessions > 0).map(x => ({ ...x, pathL: x.path ? 1 : 0 })), { search: false, file: 'unstop-ga4-by-cluster', pageSize: 30, sort: 'sessions',
      filters: [{ key: 'p', label: 'Conversion path', options: [['y', 'Yes'], ['n', 'No']], test: (r, v) => v === 'y' ? r.path : !r.path }] })}</section>` +
      `<section class="panel"><div class="panel-h"><h2>Folders inside each cluster</h2><p>Organic landing sessions by the folder rule each landing page matched, vs the same dates last year.</p></div>
      ${table('t-un-gfo', [
      { k: 'cluster', l: 'Cluster', f: r => `<b>${esc(r.cluster)}</b>` }, { k: 'folder', l: 'Folder', f: r => `<code>${esc(r.folder)}</code>`, csv: r => r.folder },
      { k: 'landings', l: 'Landing pages', r: 1, f: r => fmtN(r.landings) },
      { k: 'sessions', l: 'Organic sessions', r: 1, f: r => fmtN(Math.round(r.sessions)) + ' ' + dchip(r.dSessions) }, { k: 'newUsers', l: 'New users', r: 1, f: r => fmtN(Math.round(r.newUsers)) + ' ' + dchip(r.dNewUsers) },
      { k: 'engRate', l: 'Eng. rate', r: 1, f: r => pct1(r.engRate) }, { k: 'signups', l: 'Signups', r: 1, f: r => fmtN(Math.round(r.signups)) }, { k: 'cvr', l: 'Signup CVR', r: 1, f: r => pct1(r.cvr) }, { k: 'opp', l: 'Register / apply', r: 1, f: r => fmtN(Math.round(r.opp)) }
    ], gaFolders(M, D), { file: 'unstop-ga4-by-folder', sort: 'sessions', pageSize: 40, searchKeys: ['cluster', 'folder'], placeholder: 'Filter clusters or folders', filters: [clusterFilter(D)] })}</section>`;
  }
  function gaFolders(M, D) {
    return U.byFolder(M.pages, p => p.path, sectioner(D)).map(g => { const t = k => g.rows.reduce((a, r) => a + (r[k] || 0), 0); const ses = t('sessions'), ys = t('ySessions'), nu = t('newUsers'), yn = t('yNewUsers'), sg = t('signups');
      return { cluster: g.cluster, folder: g.folder, landings: g.rows.filter(r => r.sessions > 0).length, sessions: ses, newUsers: nu, dSessions: U.chg(ses, ys), dNewUsers: U.chg(nu, yn), engRate: ses ? t('engaged') / ses * 100 : null, signups: sg, cvr: ses ? sg / ses * 100 : null, opp: t('opp') }; }).filter(r => r.sessions > 0);
  }
  // device and state inside each page type, both against last year
  function gaCrossBlocks(M, D) {
    if (!M.typeDevice.length && !M.typeRegion.length) return '';
    const { typeOf } = tools(D);
    const types = typeOf.types.filter(t => M.typeDevice.some(r => r.type === t.id) || M.typeRegion.some(r => r.type === t.id));
    const order = id => U.CORE.includes(id) ? U.CORE.indexOf(id) : 10 + types.findIndex(t => t.id === id);
    types.sort((a, b) => order(a.id) - order(b.id));
    const cell = (rows, type, key) => { const r = rows.find(x => x.type === type && x.key === key); return r ? `${fmtN(Math.round(r.sessions))} ${dchip(r.dSessions)}` : '—'; };
    const devs = ['mobile', 'desktop', 'tablet'].filter(d => M.typeDevice.some(r => r.key === d));
    const dev = M.typeDevice.length ? `<section class="panel"><div class="panel-h"><h2>Page type × device</h2><p>Organic sessions, vs the same dates last year.</p></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Page type</th>${devs.map(d => `<th class="r">${esc(d.charAt(0).toUpperCase() + d.slice(1))}</th>`).join('')}<th class="r">Mobile share</th></tr></thead><tbody>
      ${types.map(t => { const rs = M.typeDevice.filter(r => r.type === t.id), tot = rs.reduce((a, r) => a + r.sessions, 0), mob = rs.filter(r => r.key === 'mobile').reduce((a, r) => a + r.sessions, 0); return `<tr><td><b>${esc(t.name)}</b></td>${devs.map(d => `<td class="r">${cell(M.typeDevice, t.id, d)}</td>`).join('')}<td class="r">${tot ? pct1(mob / tot * 100) : '—'}</td></tr>`; }).join('')}</tbody></table></div></div></section>` : '';
    const stTot = new Map(); M.typeRegion.forEach(r => stTot.set(r.key, (stTot.get(r.key) || 0) + r.sessions));
    const states = [...stTot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]);
    const core = types.filter(t => U.CORE.includes(t.id));
    const reg = M.typeRegion.length ? `<section class="panel"><div class="panel-h"><h2>Page type × Indian state</h2><p>Top 12 states by organic sessions, core page types, vs the same dates last year.</p></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>State</th>${core.map(t => `<th class="r">${esc(t.name)}</th>`).join('')}</tr></thead><tbody>
      ${states.map(st => `<tr><td><b>${esc(st)}</b></td>${core.map(t => `<td class="r">${cell(M.typeRegion, t.id, st)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div></section>` : '';
    return dev + reg;
  }
  function splitTable(id, label, rows) {
    return table(id, [{ k: 'key', l: label }, { k: 'sessions', l: 'Sessions', r: 1, f: r => fmtN(r.sessions) + ' ' + dchip(r.dSessions) }, { k: 'share', l: 'Share', r: 1, f: r => pct1(r.share) }, { k: 'newUsers', l: 'New users', r: 1, f: r => fmtN(r.newUsers) }], rows, { search: false, file: 'unstop-ga4-' + label.toLowerCase(), pageSize: 10 });
  }
  function gaMount(D) {
    const s = settings(D.site);
    const $ = id => document.getElementById(id);
    const auth = $('un-ga-auth');
    if (auth) auth.addEventListener('click', async () => { MSG.ga = ''; try { await signIn(); rerender(); } catch (e) { MSG.ga = e.message; rerender(); } });
    const sel = $('un-ga-prop');
    if (sel && sel.tagName === 'SELECT' && token()) {
      listProperties().then(list => {
        if (!document.body.contains(sel)) return;
        if (!list.length) { sel.innerHTML = '<option value="">No GA4 properties for this account</option>'; return; }
        const cur = s.ga4Property || (list.find(p => /unstop/i.test(p.name + p.account)) || list[0]).id;
        sel.innerHTML = list.map(p => `<option value="${esc(p.id)}" ${p.id === cur ? 'selected' : ''}>${esc(p.name)} · ${esc(p.account)} (${esc(p.id)})</option>`).join('');
        if (!list.some(p => p.id === cur)) sel.insertAdjacentHTML('afterbegin', `<option value="${esc(cur)}" selected>Property ${esc(cur)}</option>`);
      }, e => { if (document.body.contains(sel)) { sel.outerHTML = `<input id="un-ga-prop" type="text" inputmode="numeric" placeholder="GA4 property ID" value="${esc(s.ga4Property)}">`; const p = $('un-ga-prog'); if (p) p.textContent = 'Could not list properties (' + e.message + '). Type the property ID instead.'; } });
    }
    const go = $('un-ga-go');
    if (go) go.addEventListener('click', async () => {
      const el = $('un-ga-prop'); const property = String(el.value || '').trim().replace(/^properties\//, '');
      const start = $('un-ga-start').value, end = $('un-ga-end').value;
      if (!/^\d{5,}$/.test(property)) { MSG.ga = 'Enter the numeric GA4 property ID (GA4 Admin › Property details).'; rerender(); return; }
      if (!start || !end || start > end) { MSG.ga = 'Choose a valid date range.'; rerender(); return; }
      const name = el.tagName === 'SELECT' && el.selectedOptions[0] ? el.selectedOptions[0].textContent : 'Property ' + property;
      s.ga4Property = property; save(D.site, s); MSG.ga = ''; go.disabled = true;
      try { await loadGa4(D, { property, propertyName: name, start, end }); } catch (e) { MSG.ga = e.message; }
      rerender();
    });
    const sm = $('un-ga-sample');
    if (sm) sm.addEventListener('click', () => { GA.set(D.site, { raw: sampleGa(D), property: 'sample', propertyName: 'Sample numbers', start: D.start, end: D.end, at: Date.now(), sample: true, failed: [] }); MSG.ga = ''; rerender(); });
  }

  // Sample GA4 responses built from the loaded Search Console pages (for previewing the screens).
  function sampleGa(D) {
    let seed = 7; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const s = settings(D.site), ev = s.events, { typeOf } = tools(D);
    const mk = (dims, mets, rows, two) => ({ dimensionHeaders: dims.concat(two ? ['dateRange'] : []).map(name => ({ name })), metricHeaders: mets.map(name => ({ name })), rows: rows.map(r => ({ dimensionValues: r.d.map(value => ({ value: String(value) })), metricValues: r.m.map(v => ({ value: String(Math.max(0, Math.round(v))) })) })), rowCount: rows.length });
    const pages = (D.P || []).slice(0, 600).map(p => ({ path: U.pathOnly(p.p), clicks: p.clicks, type: typeOf(p.p) }));
    const land = [], events = [];
    pages.forEach(p => {
      const ses = p.clicks * (1.1 + R() * .4), y = ses / (1.05 + R() * .5);
      land.push({ d: [p.path, 'cur'], m: [ses, ses * .62, ses * (.45 + R() * .3), ses * (1.6 + R()), ses * 70, ses * .05] }, { d: [p.path, 'yoy'], m: [y, y * .64, y * .5, y * 1.8, y * 65, y * .04] });
      const r = { opp: [.002, .018, .06], emp: [.001, .004, .01], blog: [.004, .012, .015], org: [.002, .01, .02] }[p.type] || [.002, .006, .01];
      const e = (name, rate) => { const c = ses * rate * (.6 + R() * .8); if (c >= 1 && name) events.push({ d: [p.path, name], m: [c, c * .9] }); };
      e(ev.studentSignup[0], r[2]); e(ev.opportunityAction[0], r[1] * 3); e(ev.productClick[0], p.type === 'blog' ? .09 : .02); e(ev.scroll[0], .4); e('page_view', 1.8); e('session_start', 1); e('user_engagement', .7);
      if (p.type === 'emp') { e(ev.demoRequest[0], .02); e(ev.contactSubmit[0], .008); e(ev.employerSignup[0], .01); }
    });
    const sumCur = land.filter(r => r.d[1] === 'cur').reduce((a, r) => a + r.m[0], 0), sumY = land.filter(r => r.d[1] === 'yoy').reduce((a, r) => a + r.m[0], 0);
    const days = Math.max(1, Math.round((new Date(D.end) - new Date(D.start)) / 864e5) + 1);
    const daily = []; for (let i = 0; i < days; i++) { const d = new Date(D.start + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); const k = d.toISOString().slice(0, 10).replace(/-/g, ''); const wk = [1, 1.05, 1.04, 1.02, .95, .8, .78][(d.getUTCDay() + 6) % 7]; daily.push({ d: [k, 'cur'], m: [sumCur / days * wk * (.9 + R() * .2), sumCur / days * .6 * wk] }); const y = new Date(d); y.setUTCFullYear(y.getUTCFullYear() - 1); daily.push({ d: [y.toISOString().slice(0, 10).replace(/-/g, ''), 'yoy'], m: [sumY / days * wk * (.9 + R() * .2), sumY / days * .6 * wk] }); }
    const split = (vals) => vals.flatMap(([k, sh]) => [{ d: [k, 'cur'], m: [sumCur * sh, sumCur * sh * .6, sumCur * sh * .55] }, { d: [k, 'yoy'], m: [sumY * sh * (.9 + R() * .2), sumY * sh * .62, sumY * sh * .5] }]);
    const evTot = name => events.filter(e => e.d[1] === name).reduce((a, e) => a + e.m[0], 0);
    const STATES = [['Uttar Pradesh', .14], ['Maharashtra', .12], ['Tamil Nadu', .09], ['Karnataka', .08], ['Delhi', .07], ['Telangana', .07], ['West Bengal', .06], ['Andhra Pradesh', .05], ['Rajasthan', .045], ['Madhya Pradesh', .04], ['Gujarat', .035], ['Kerala', .03], ['Punjab', .025], ['Haryana', .025]];
    const DEV = [['mobile', .74], ['desktop', .245], ['tablet', .015]];
    const chans = [['Organic Search', 1], ['Direct', .55], ['Organic Social', .18], ['Paid Search', .12], ['Referral', .08], ['Email', .05]];
    return {
      landing: mk(['landingPage'], ['sessions', 'newUsers', 'engagedSessions', 'screenPageViews', 'userEngagementDuration', 'keyEvents'], land, true),
      device: mk(['deviceCategory'], ['sessions', 'newUsers', 'engagedSessions'], split([['mobile', .71], ['desktop', .27], ['tablet', .02]]), true),
      country: mk(['country'], ['sessions', 'newUsers'], split([['India', .93], ['United States', .015], ['Nepal', .008], ['Bangladesh', .006], ['United Arab Emirates', .005]]).map(r => ({ d: r.d, m: r.m.slice(0, 2) })), true),
      region: mk(['region'], ['sessions', 'newUsers'], STATES.flatMap(([k, sh]) => [{ d: [k, 'cur'], m: [sumCur * .93 * sh, sumCur * .55 * sh] }, { d: [k, 'yoy'], m: [sumY * .93 * sh * (.8 + R() * .35), sumY * .55 * sh * .85] }]), true),
      landingDevice: mk(['landingPage', 'deviceCategory'], ['sessions', 'newUsers'], land.flatMap(r => DEV.map(([dv, sh]) => { const f = sh * (r.d[1] === 'yoy' ? (dv === 'mobile' ? .95 : 1.08) : 1); return { d: [r.d[0], dv, r.d[1]], m: [r.m[0] * f, r.m[1] * f] }; })), true),
      landingRegion: mk(['landingPage', 'region'], ['sessions', 'newUsers'], land.flatMap(r => STATES.map(([st, sh], i) => { const tilt = 1 + ((r.d[0].length + i) % 5 - 2) * .12; const f = .93 * sh * tilt * (r.d[1] === 'yoy' ? .8 + (i % 4) * .08 : 1); return { d: [r.d[0], st, r.d[1]], m: [r.m[0] * f, r.m[1] * f] }; })), true),
      daily: mk(['date'], ['sessions', 'newUsers'], daily, true),
      events: mk(['landingPage', 'eventName'], ['eventCount', 'totalUsers'], events, false),
      eventsYoy: mk(['eventName'], ['eventCount', 'totalUsers'], [...new Set(events.map(e => e.d[1]))].map(n => ({ d: [n], m: [evTot(n) * (.75 + R() * .2), evTot(n) * .7] })), false),
      returning: mk(['newVsReturning'], ['activeUsers', 'sessions'], [{ d: ['new', 'cur'], m: [sumCur * .55, sumCur * .6] }, { d: ['returning', 'cur'], m: [sumCur * .3, sumCur * .4] }, { d: ['new', 'yoy'], m: [sumY * .58, sumY * .6] }, { d: ['returning', 'yoy'], m: [sumY * .27, sumY * .4] }], true),
      pricing: mk(['pagePath'], ['sessions', 'screenPageViews', 'activeUsers'], [{ d: [s.pricingPaths[0] || '/pricing', 'cur'], m: [sumCur * .002, sumCur * .003, sumCur * .0018] }, { d: [s.pricingPaths[0] || '/pricing', 'yoy'], m: [sumY * .0016, sumY * .0024, sumY * .0014] }], true),
      channels: mk(['sessionDefaultChannelGroup'], ['sessions', 'newUsers', 'engagedSessions', 'keyEvents'], chans.map(([c, f]) => ({ d: [c], m: [sumCur * f, sumCur * f * (c === 'Direct' ? .3 : .6), sumCur * f * .55, sumCur * f * .03] })), false),
      channelEvents: mk(['sessionDefaultChannelGroup', 'eventName'], ['eventCount'], chans.flatMap(([c, f]) => [ev.studentSignup[0], ev.employerSignup[0], ev.demoRequest[0], ev.contactSubmit[0]].map(n => ({ d: [c, n], m: [evTot(n) * f * (c === 'Organic Search' ? 1 : .5 + R())] }))), false),
      ai: mk(['sessionSource', 'landingPage'], ['sessions', 'engagedSessions', 'keyEvents', 'newUsers'], [['chatgpt.com', .006], ['perplexity.ai', .0015], ['gemini.google.com', .0012], ['copilot.microsoft.com', .0004]].flatMap(([src, sh]) => pages.slice(0, 8).flatMap(p => [{ d: [src, p.path, 'cur'], m: [sumCur * sh / 8, sumCur * sh / 8 * .7, sumCur * sh / 8 * .04, sumCur * sh / 8 * .6] }, { d: [src, p.path, 'yoy'], m: [sumY * sh / 8 * .35, sumY * sh / 8 * .25, 0, sumY * sh / 8 * .2] }])), true)
    };
  }

  // ════════════════════════════ MOENGAGE: SIGNUP QUALITY ════════════════════════════
  async function readSheet(file) {
    if (!window.XLSX) throw new Error('The spreadsheet reader is still loading. Try again in a moment.');
    if (file.size > 60e6) throw new Error('That file is larger than 60 MB. Export a shorter date range or fewer columns.');
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', raw: true, cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).filter(r => r.some(c => c !== ''));
  }
  // ════════════════════════════ MOENGAGE LIVE (Custom Dashboards API) ════════════════════════════
  // Two ways in: through the Unstop proxy (key stays on the server, recommended) or straight from this
  // browser with a workspace ID and key kept for this tab only. Charts are read as tables and mapped to
  // funnel metrics; the mappings are saved per site.
  const MU = window.UN_MOE;
  const MOELIVE = new Map(); // site → { status, error, dashboards, dash, tables: { id: { name, tbl, error } }, at }
  const moeCfg = s => ({ mode: 'proxy', proxy: '', dc: '01', workspace: '', dashboard: '', maps: {}, ...(s.moe || {}) });
  // In the sample, MoEngage is a generated dashboard held in memory; mappings are not saved.
  const moeCfgFor = D => { const c = moeCfg(settings(D.site)), L = MOELIVE.get(D.site); return L && L.demo ? { ...c, mode: 'demo', dashboard: 'sample', maps: L.maps || {} } : c; };
  function setMaps(D, maps) { const L = MOELIVE.get(D.site); if (L && L.demo) { L.maps = maps; return; } const s = settings(D.site), c = moeCfg(s); c.maps = maps; s.moe = c; save(D.site, s); }
  const moeKey = () => { try { return sessionStorage.getItem('un:moe-key') || ''; } catch (e) { return ''; } };
  function googleTok() {
    for (const k of ['un:tok', 'un:ga-tok']) { try { const v = JSON.parse(sessionStorage.getItem(k)); if (v && v.t && v.exp > Date.now() + 30000) return v.t; } catch (e) { } }
    return token();
  }
  function moeReady(c) { return c.mode === 'proxy' ? !!c.proxy : !!(c.workspace && moeKey()); }
  async function moeGet(c, path, fresh) {
    let url, headers = { Accept: 'application/json' };
    if (c.mode === 'proxy') {
      const t = googleTok();
      if (!t) throw new Error('Sign in with Google first (Connect GA4 on the GA4 screen, or open the analysis through Connect Search Console). The proxy only answers people who can open Unstop’s Search Console or GA4.');
      url = c.proxy.replace(/\/+$/, '') + path.replace('/v5/analytics', '') + (fresh ? '?cache=false' : '');
      headers.Authorization = 'Bearer ' + t;
    } else {
      url = MU.host(c.dc) + path + (fresh ? '?cache=false' : '');
      headers.Authorization = 'Basic ' + btoa(c.workspace + ':' + moeKey());
      headers['MOE-APPKEY'] = c.workspace;
    }
    let res;
    try { res = await fetch(url, { headers }); }
    catch (e) { throw new Error(c.mode === 'proxy' ? 'Could not reach the proxy. Check its URL and that this site’s address is in ALLOWED_ORIGINS.' : 'The browser could not call MoEngage directly (MoEngage does not allow calls from web pages, or a firewall blocked it). Use the proxy instead: see moengage-proxy/README.md.'); }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(MU.errorText(res.status, body));
    return body;
  }
  async function moeLoad(D, opt = {}) {
    const s = settings(D.site), c = moeCfg(s);
    const st = MOELIVE.get(D.site) || {};
    MOELIVE.set(D.site, { ...st, status: 'loading', error: '' }); rerender();
    try {
      let dashboards = st.dashboards;
      if (!dashboards || opt.list) { try { dashboards = MU.dashboards(await moeGet(c, MU.PATHS.dashboards())); } catch (e) { if (!c.dashboard) throw e; dashboards = dashboards || []; } }
      let dash = null; const tables = {};
      if (c.dashboard) {
        dash = MU.charts(await moeGet(c, MU.PATHS.charts(c.dashboard)));
        const list = dash.charts.slice(0, 25);
        let done = 0;
        await Promise.all(list.map(ch => moeGet(c, MU.PATHS.chart(c.dashboard, ch.id), opt.fresh)
          .then(r => { tables[ch.id] = { name: ch.name, type: ch.type, tbl: MU.table(r) }; }, e => { tables[ch.id] = { name: ch.name, error: e.message }; })
          .finally(() => { done++; const p = document.getElementById('un-moe-prog'); if (p) p.textContent = `Loading charts… ${done} of ${list.length}`; })));
      }
      MOELIVE.set(D.site, { status: 'ok', error: '', dashboards, dash, tables, at: Date.now() });
    } catch (e) { MOELIVE.set(D.site, { ...st, status: 'error', error: e.message }); }
    rerender();
  }
  // Live MoEngage values for the funnel (null when nothing is mapped or loaded).
  function moeLive(D) {
    const L = MOELIVE.get(D.site); if (!L || !L.tables) return null;
    const c = moeCfgFor(D);
    const tbls = {}; Object.entries(L.tables).forEach(([k, v]) => { if (v.tbl) tbls[k] = v.tbl; });
    const m = MU.metrics(c.maps, tbls);
    return Object.keys(m).length ? { m, at: L.at } : null;
  }
  // Start a background load when everything needed is present (used by Signup quality and Full funnel).
  function moeAuto(D) {
    const c = moeCfg(settings(D.site));
    if (!c.dashboard || !moeReady(c) || MOELIVE.has(D.site)) return;
    if (c.mode === 'proxy' && !googleTok()) return;
    moeLoad(D);
  }

  function moeLiveBlock(D) {
    const s = settings(D.site), c = moeCfgFor(D), L = MOELIVE.get(D.site) || {};
    const ready = L.demo || moeReady(c);
    const dcOpt = MU.DCS.map(d => `<option value="${d}" ${c.dc === d ? 'selected' : ''}>DC-${d}</option>`).join('');
    const conn = `<details class="un-moe-conn" ${ready ? '' : 'open'}><summary>${L.demo ? 'Sample dashboard (generated charts; connect MoEngage for real ones)' : ready ? `Connection: ${c.mode === 'proxy' ? 'Unstop proxy · ' + esc(c.proxy) : 'direct · workspace ' + esc(c.workspace) + ' · DC-' + esc(c.dc)}` : 'Connect MoEngage'}</summary>
      <form id="un-moe-conn" class="un-grid2">
        <fieldset class="field"><span>How to connect</span>
          <label class="check"><input type="radio" name="un-moe-mode" value="proxy" ${c.mode === 'proxy' ? 'checked' : ''}> Through the Unstop proxy (recommended: the API key stays on the server; only people with access to Unstop’s Search Console or GA4 get data)</label>
          <label class="check"><input type="radio" name="un-moe-mode" value="direct" ${c.mode === 'direct' ? 'checked' : ''}> Directly from this browser (key kept for this tab only; works only if MoEngage accepts browser calls)</label>
        </fieldset>
        <div>
          <label class="field" data-mode="proxy"><span>Proxy URL</span><input type="url" id="un-moe-proxy" value="${esc(c.proxy)}" placeholder="https://unstop-moengage-proxy.<you>.workers.dev"></label>
          <div class="un-grid2" data-mode="direct">
            <label class="field"><span>Data centre</span><select id="un-moe-dc">${dcOpt}</select></label>
            <label class="field"><span>Workspace ID (App ID)</span><input type="text" id="un-moe-ws" value="${esc(c.workspace)}" autocomplete="off" spellcheck="false"></label>
          </div>
          <label class="field" data-mode="direct"><span>API key (Dashboard &amp; Analyze access) · not saved</span><input type="password" id="un-moe-key" value="" placeholder="${moeKey() ? 'Kept for this tab' : ''}" autocomplete="off"></label>
          <div class="un-row"><button class="btn-primary sm" type="submit">Save and connect</button>${ready ? '<button class="btn-quiet" type="button" id="un-moe-forget">Disconnect</button>' : ''}</div>
        </div>
      </form>
      <p class="hint">MoEngage › Settings › Account › APIs: copy the Workspace ID and create an API key with “Dashboard &amp; Analyze” ticked. The data centre is the number in your dashboard address (dashboard-<b>01</b>.moengage.com). Proxy set-up: <code>moengage-proxy/README.md</code>.</p>
    </details>`;
    let body = '';
    if (ready) {
      const opts = (L.dashboards || []).map(d => `<option value="${esc(d.id)}" ${d.id === c.dashboard ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
      body += `<div class="un-row">
        <label class="field"><span>Dashboard</span>${opts ? `<select id="un-moe-dash"><option value="">Choose a dashboard…</option>${opts}</select>` : `<input type="text" id="un-moe-dash" value="${esc(c.dashboard)}" placeholder="Dashboard ID" spellcheck="false">`}</label>
        ${L.demo ? '' : `<button class="btn-primary sm" type="button" id="un-moe-load">${c.dashboard ? 'Refresh data' : 'Load dashboards'}</button>`}
        ${!L.demo && c.dashboard && L.status === 'ok' ? '<button class="btn-quiet" type="button" id="un-moe-fresh" title="Asks MoEngage to recompute every chart instead of using its cache (slower)">Recompute charts</button>' : ''}
        <span class="progress" id="un-moe-prog" role="status">${L.status === 'loading' ? 'Loading…' : L.at ? 'Loaded ' + when(L.at) : ''}</span>
      </div>`;
      if (L.status === 'error') body += `<p class="start-error" role="alert">${esc(L.error)}</p>`;
      body += '<p class="hint">Build one MoEngage custom dashboard for SEO with charts such as: Sign-ups by source (Session &amp; Source), Sign up → Profile completed (Funnel), Sign up → Registered / Applied in 7 days (Funnel), Retention of organic signups (Retention). Charts keep their own date range and segment from MoEngage.</p>';
      const T = L.tables || {}, ids = Object.keys(T);
      if (c.dashboard && ids.length) {
        const live = moeLive(D);
        const chartOpt = sel => `<option value="">—</option>` + ids.map(id => `<option value="${esc(id)}" ${id === sel ? 'selected' : ''}>${esc(T[id].name)}</option>`).join('');
        const colOpt = (id, sel, numeric) => { const t = T[id] && T[id].tbl; return `<option value="">—</option>` + (t ? t.columns.filter(x => !numeric || x.numeric).map(x => `<option value="${esc(x.key)}" ${x.key === sel ? 'selected' : ''}>${esc(x.key)}</option>`).join('') : ''); };
        const val = (t, v) => !v ? '' : v.missing ? '<span class="un-n">chart not loaded</span>' : v.empty ? '<span class="un-n">no matching rows</span>' : `<b>${t.rate ? pct1(v.value) : fmtN(Math.round(v.value))}</b><span class="un-n">${v.compare != null ? `vs ${t.rate ? pct1(v.compare) : fmtN(Math.round(v.compare))} · ` : ''}${fmtN(v.rows)} row${v.rows === 1 ? '' : 's'}</span>`;
        body += `<form id="un-moe-map"><div class="tw"><table class="un-mini un-map"><thead><tr><th>Funnel metric</th><th>Chart</th><th>Value column</th><th>Combine</th><th>Only rows where</th><th>contains</th><th>Compare with rows containing</th><th>Value now</th></tr></thead><tbody>
          ${MU.TARGETS.map(t => { const m = c.maps[t.id] || {}; return `<tr data-t="${t.id}" title="${esc(t.hint)}"><td><b>${esc(t.label)}</b></td>
            <td><select data-k="chart">${chartOpt(m.chart)}</select></td>
            <td><select data-k="column">${colOpt(m.chart, m.column, true)}</select></td>
            <td><select data-k="agg">${Object.entries(MU.AGG).map(([k, l]) => `<option value="${k}" ${(m.agg || (t.rate ? 'avg' : 'sum')) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
            <td><select data-k="filterCol">${colOpt(m.chart, m.filterCol, false)}</select></td>
            <td><input type="text" data-k="filterText" value="${esc(m.filterText || '')}" placeholder="organic, google"></td>
            <td><input type="text" data-k="compareText" value="${esc(m.compareText || '')}" placeholder="optional, e.g. paid, direct"></td>
            <td class="r">${val(t, live && live.m[t.id])}</td></tr>`; }).join('')}
          </tbody></table></div>
          <div class="un-row"><button class="btn-primary sm" type="submit">Save mapping</button><span class="hint">Mapped values appear on Full funnel as <b>Live</b> and replace the uploaded file for the same metric. Rates of 1 or less are read as fractions (0.42 = 42%).</span></div></form>`;
        body += `<div class="un-moe-charts">${ids.map(id => { const x = T[id]; if (x.error) return `<details><summary>${esc(x.name)} <span class="un-st none">Error</span></summary><p class="start-error">${esc(x.error)}</p></details>`;
          const t = x.tbl; return `<details><summary>${esc(x.name)}${x.type ? ` <small class="un-n">${esc(x.type)}</small>` : ''} <span class="un-n">${fmtN(t.rows.length)} rows · ${t.columns.length} columns</span></summary>${t.rows.length ? `<div class="tw"><table class="un-mini"><thead><tr>${t.columns.slice(0, 14).map(col => `<th class="${col.numeric ? 'r' : ''}">${esc(col.key)}</th>`).join('')}</tr></thead><tbody>${t.rows.slice(0, 40).map(r => `<tr>${t.columns.slice(0, 14).map(col => `<td class="${col.numeric ? 'r' : ''}">${esc(r[col.key] == null ? '' : r[col.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${t.rows.length > 40 ? `<p class="hint">First 40 of ${fmtN(t.rows.length)} rows.</p>` : ''}` : '<p class="empty">This chart returned no rows.</p>'}</details>`; }).join('')}</div>`;
      } else if (c.dashboard && L.status === 'ok') body += '<p class="empty">This dashboard has no charts, or none could be read.</p>';
    }
    return `<section class="panel un-moe-live"><div class="panel-h"><h2>MoEngage live ${L.demo ? chip('sample') : L.status === 'ok' && c.dashboard ? chip('live') : ready ? '' : chip('none')}</h2><p>Reads charts from a MoEngage custom dashboard through MoEngage’s Custom Dashboards API, then maps them to the funnel metrics below.</p></div><div class="panel-b">${conn}${body}</div></section>`;
  }
  function moeLiveMount(D) {
    const $ = id => document.getElementById(id);
    const f = $('un-moe-conn'); if (!f) return;
    const sync = () => { const mode = (f.querySelector('[name=un-moe-mode]:checked') || {}).value || 'proxy'; f.querySelectorAll('[data-mode]').forEach(el => { el.hidden = el.dataset.mode !== mode; }); };
    f.querySelectorAll('[name=un-moe-mode]').forEach(r => r.addEventListener('change', sync)); sync();
    f.addEventListener('submit', e => {
      e.preventDefault();
      const s = settings(D.site), c = moeCfg(s);
      c.mode = (f.querySelector('[name=un-moe-mode]:checked') || {}).value || 'proxy';
      c.proxy = $('un-moe-proxy').value.trim(); c.dc = $('un-moe-dc').value; c.workspace = $('un-moe-ws').value.trim();
      const k = $('un-moe-key').value.trim(); if (k) { try { sessionStorage.setItem('un:moe-key', k); } catch (x) { } }
      if (c.mode === 'proxy' && !/^https:\/\//i.test(c.proxy) && !/^http:\/\/localhost/i.test(c.proxy)) { MOELIVE.set(D.site, { status: 'error', error: 'Enter the proxy’s https:// address.' }); rerender(); return; }
      if (c.mode === 'direct' && (!c.workspace || !moeKey())) { MOELIVE.set(D.site, { status: 'error', error: 'Enter the workspace ID and API key.' }); rerender(); return; }
      s.moe = c; save(D.site, s); MOELIVE.delete(D.site); moeLoad(D, { list: true });
    });
    const fg = $('un-moe-forget');
    if (fg) fg.addEventListener('click', () => { const s = settings(D.site); s.moe = { ...moeCfg(s), proxy: '', workspace: '' }; save(D.site, s); try { sessionStorage.removeItem('un:moe-key'); } catch (x) { } MOELIVE.delete(D.site); rerender(); });
    const ld = $('un-moe-load');
    if (ld) ld.addEventListener('click', () => { const s = settings(D.site), c = moeCfg(s); const d = $('un-moe-dash'); c.dashboard = d ? d.value.trim() : c.dashboard; s.moe = c; save(D.site, s); moeLoad(D, { list: !c.dashboard }); });
    const dsel = $('un-moe-dash');
    if (dsel && dsel.tagName === 'SELECT') dsel.addEventListener('change', () => { const s = settings(D.site), c = moeCfg(s); c.dashboard = dsel.value; s.moe = c; save(D.site, s); if (c.dashboard) moeLoad(D); });
    const fr = $('un-moe-fresh');
    if (fr) fr.addEventListener('click', () => moeLoad(D, { fresh: true }));
    const mf = $('un-moe-map');
    if (mf) {
      // changing the chart refreshes that row's column lists
      mf.querySelectorAll('[data-k=chart]').forEach(sel => sel.addEventListener('change', () => {
        const c = moeCfgFor(D), id = sel.closest('tr').dataset.t;
        setMaps(D, { ...c.maps, [id]: { ...(c.maps[id] || {}), chart: sel.value, column: '', filterCol: '' } }); rerender();
      }));
      mf.addEventListener('submit', e => {
        e.preventDefault();
        const maps = {};
        mf.querySelectorAll('tr[data-t]').forEach(tr => { const m = {}; tr.querySelectorAll('[data-k]').forEach(i => { if (i.value.trim()) m[i.dataset.k] = i.value.trim(); }); if (m.chart) maps[tr.dataset.t] = m; });
        setMaps(D, maps); rerender();
      });
    }
    moeAuto(D);
  }

  function moeOpt(s) { return { profileThreshold: +s.moeThreshold || 80, organicSources: s.organicSources ? s.organicSources.split(',').map(x => x.trim()).filter(Boolean) : undefined }; }
  V.quality = (A, D) => {
    demoFill(D);
    window.CW_LAST_A = A;
    Object.keys(TABLES).filter(k => k.startsWith('t-un-q')).forEach(k => delete TABLES[k]);
    const s = settings(D.site), m = MOE.get(D.site);
    const intro = head('Signup quality (MoEngage)', 'Profile completion, 7-day activation and 30-day retention for organic signups compared with other channels, student vs employer, by monthly signup cohort.') + moeLiveBlock(D) + '<h2 class="un-sub">User export (deeper cohort view)</h2>';
    const up = `<section class="panel"><div class="panel-b"><div class="un-row">
        <label class="btn-primary sm un-file">Upload MoEngage export<input type="file" id="un-moe-file" accept=".csv,.xlsx,.xls" hidden></label>
        <button class="btn-quiet" type="button" id="un-moe-tpl">Download column template</button>
        <button class="btn-quiet" type="button" id="un-moe-sample">Preview with sample users</button>
        ${m ? '<button class="btn-quiet" type="button" id="un-moe-clear">Remove file</button>' : ''}
      </div>
      ${MSG.moe ? `<p class="start-error" role="alert">${esc(MSG.moe)}</p>` : ''}
      <p class="hint">In MoEngage: Segment › create a segment of users who signed up in the period › Export users (CSV) with these attributes: user ID, signup / first seen date, acquisition source and medium (UTM), user type, profile completion, first registration or application date, last seen. The file stays in this tab.</p></div></section>`;
    if (!m) return { html: intro + up + '<div class="note">No MoEngage file yet. The template lists the columns this screen understands; any extra columns are ignored. Column names are matched loosely (for example “Created at” or “First seen” both work as the signup date).</div>', mount: () => moeMount(D) };
    const res = m.res;
    if (!res.ok) return { html: intro + up + `<div class="note"><b>Could not read the file.</b> ${esc(res.error)}${res.header ? `<br>Columns found: ${esc(res.header.slice(0, 30).join(', '))}` : ''}</div>`, mount: () => moeMount(D) };
    const S = res.seg;
    const r = x => x ? `${pct1(x.rate)} <small class="un-n">n=${fmtN(x.n)}</small>` : '—';
    const segRow = (name, x) => `<tr><td><b>${esc(name)}</b></td><td class="r">${fmtN(x.users)}</td><td class="r">${r(x.profile)}</td><td class="r">${r(x.act7)}</td><td class="r">${r(x.ret30)}</td></tr>`;
    const miss = [!res.has.source && 'acquisition source / medium (everyone counts as non-organic)', !res.has.type && 'user type (everyone counts as student)', !res.has.profile && 'profile completion', !res.has.act && 'first registration / application date', !res.has.ret && 'last seen date'].filter(Boolean);
    const html = intro + up + (m.sample ? '<div class="note"><b>Sample users.</b> Generated to preview the screen. Upload a MoEngage export for real numbers.</div>' : '') +
      `<p class="un-meta">${esc(m.name)} · ${fmtN(res.total)} users who signed up ${fmtD(res.start)} – ${fmtD(res.end)} · rates measured as of ${fmtD(res.asOf)} · loaded ${when(m.at)}</p>` +
      (miss.length ? `<div class="note">Columns not found: ${esc(miss.join('; '))}.</div>` : '') +
      `<section class="panel"><div class="panel-h"><h2>Organic vs other channels</h2><p>Users who signed up less than 7 (or 30) days before the export date are left out of the 7-day (or 30-day) rate. Profile complete = at or above ${esc(s.moeThreshold)}%.</p></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Segment</th><th class="r">Signups</th><th class="r">Profile complete</th><th class="r">7-day activation</th><th class="r">30-day retention</th></tr></thead><tbody>
        ${segRow('Organic: all', S.organic)}${segRow('Organic: students', S.orgStudent)}${segRow('Organic: employers / recruiters', S.orgEmployer)}
        ${segRow('Other channels: all', S.other)}${segRow('Other channels: students', S.othStudent)}${segRow('Other channels: employers / recruiters', S.othEmployer)}
      </tbody></table></div></div></section>` +
      `<section class="panel"><div class="panel-h"><h2>Monthly cohorts</h2></div><div class="panel-b"><div class="chart-box"><canvas id="un-moe-ch" aria-label="30-day retention by cohort"></canvas></div></div>
        ${table('t-un-qc', [{ k: 'month', l: 'Signup month' }, { k: 'ou', l: 'Organic signups', r: 1, f: x => fmtN(x.ou) }, { k: 'op', l: 'Organic profile', r: 1, f: x => pct1(x.op) }, { k: 'oa', l: 'Organic 7-day act.', r: 1, f: x => pct1(x.oa) }, { k: 'or', l: 'Organic 30-day ret.', r: 1, f: x => pct1(x.or) }, { k: 'xu', l: 'Other signups', r: 1, f: x => fmtN(x.xu) }, { k: 'xa', l: 'Other 7-day act.', r: 1, f: x => pct1(x.xa) }, { k: 'xr', l: 'Other 30-day ret.', r: 1, f: x => pct1(x.xr) }],
        res.cohorts.map(c => ({ month: c.month, ou: c.organic.users, op: c.organic.profile && c.organic.profile.rate, oa: c.organic.act7 && c.organic.act7.rate, or: c.organic.ret30 && c.organic.ret30.rate, xu: c.other.users, xa: c.other.act7 && c.other.act7.rate, xr: c.other.ret30 && c.other.ret30.rate })), { search: false, sort: 'month', dir: 1, file: 'unstop-signup-cohorts', pageSize: 24 })}</section>` +
      `<section class="panel"><div class="panel-h"><h2>Acquisition sources in the file</h2><p>Check that organic is detected correctly; adjust organic source words in Funnel setup.</p></div>${table('t-un-qs', [{ k: 'source', l: 'Source' }, { k: 'medium', l: 'Medium' }, { k: 'org', l: 'Counted as', f: x => x.organic ? '<span class="un-st live">Organic</span>' : 'Other' }, { k: 'users', l: 'Signups', r: 1, f: x => fmtN(x.users) }], res.sources.map(x => ({ ...x, org: x.organic ? 1 : 0 })), { file: 'unstop-moe-sources', sort: 'users', pageSize: 15 })}</section>`;
    const mount = () => {
      moeMount(D); ['t-un-qc', 't-un-qs'].forEach(drawTable);
      chart('un-moe-ch', { type: 'bar', data: { labels: res.cohorts.map(c => c.month), datasets: [
        { label: 'Organic 30-day retention', data: res.cohorts.map(c => c.organic.ret30 ? +c.organic.ret30.rate.toFixed(1) : null), backgroundColor: cssVar('--signal') },
        { label: 'Other channels 30-day retention', data: res.cohorts.map(c => c.other.ret30 ? +c.other.ret30.rate.toFixed(1) : null), backgroundColor: cssVar('--line') }
      ] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { callback: v => v + '%' } } } } });
    };
    return { html, mount };
  };
  function moeMount(D) {
    moeLiveMount(D);
    const $ = id => document.getElementById(id), s = settings(D.site);
    const f = $('un-moe-file');
    if (f) f.addEventListener('change', async () => {
      const file = f.files[0]; if (!file) return; MSG.moe = '';
      try { const rows = await readSheet(file); MOE.set(D.site, { rows, res: U.moeQuality(rows, moeOpt(s)), name: file.name, at: Date.now() }); }
      catch (e) { MSG.moe = e.message; }
      rerender();
    });
    const t = $('un-moe-tpl');
    if (t) t.addEventListener('click', () => download('moengage-user-export-template.csv', 'User ID,Signup date,UTM source,UTM medium,User type,Profile completion %,First registration date,Last seen\nu_001,2026-09-02,google,organic,Student,85,2026-09-04,2026-10-20\nu_002,2026-09-03,facebook,cpc,Student,40,,2026-09-03\nu_003,2026-09-05,google,organic,Recruiter,100,2026-09-05,2026-10-18\n'));
    const sm = $('un-moe-sample');
    if (sm) sm.addEventListener('click', () => { const rows = sampleMoe(D); MOE.set(D.site, { rows, res: U.moeQuality(rows, moeOpt(s)), name: 'Sample users', at: Date.now(), sample: true }); MSG.moe = ''; rerender(); });
    const c = $('un-moe-clear');
    if (c) c.addEventListener('click', () => { MOE.delete(D.site); rerender(); });
  }
  function sampleMoe(D) {
    let seed = 11; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const end = new Date((D.end || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
    const rows = [['User ID', 'Signup date', 'UTM source', 'UTM medium', 'User type', 'Profile completion %', 'First registration date', 'Last seen']];
    const src = [['google', 'organic', .42], ['(direct)', '(none)', .2], ['facebook', 'cpc', .14], ['instagram', 'social', .1], ['google', 'cpc', .08], ['newsletter', 'email', .06]];
    const iso = d => d.toISOString().slice(0, 10);
    for (let i = 0; i < 3000; i++) {
      const sd = new Date(end); sd.setUTCDate(sd.getUTCDate() - Math.floor(R() * 150));
      let x = R(), sIdx = 0; while (sIdx < src.length - 1 && x > src[sIdx][2]) { x -= src[sIdx][2]; sIdx++; }
      const [so, me] = src[sIdx], org = me === 'organic', emp = R() < .06;
      const prof = Math.round(Math.min(100, (org ? 55 : 45) + R() * 60));
      const fa = R() < (org ? .52 : .4) ? new Date(+sd + Math.floor(R() * (R() < .7 ? 6 : 20)) * 864e5) : null;
      const ls = new Date(Math.min(+end, +sd + Math.floor(R() * (R() < (org ? .45 : .33) ? 120 : 20)) * 864e5));
      rows.push(['u' + i, iso(sd), so, me, emp ? 'Recruiter' : 'Student', prof, fa && fa <= end ? iso(fa) : '', iso(ls)]);
    }
    return rows;
  }
  function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }


  // ── sample data: fill GA4, MoEngage export and a MoEngage dashboard so every screen has numbers ──
  function sampleMoeLive() {
    const t = r => MU.table({ data: r });
    const months = ['2026-07', '2026-08', '2026-09'];
    return { status: 'ok', demo: true, at: Date.now(), dashboards: [{ id: 'sample', name: 'SEO funnel (sample)' }], dash: { name: 'SEO funnel (sample)' },
      tables: {
        c1: { name: 'Sign-ups by source', type: 'Session & Source', tbl: t([{ source: 'google / organic', signups: 48210 }, { source: 'bing / organic', signups: 1630 }, { source: '(direct) / (none)', signups: 21900 }, { source: 'google / cpc', signups: 9800 }, { source: 'instagram / social', signups: 7400 }, { source: 'whatsapp / referral', signups: 5100 }, { source: 'chatgpt.com / referral', signups: 640 }]) },
        c2: { name: 'Sign up → Profile completed', type: 'Funnels', tbl: t([{ channel: 'organic', conversion: 0.58 }, { channel: 'paid', conversion: 0.41 }, { channel: 'direct', conversion: 0.52 }, { channel: 'social', conversion: 0.37 }]) },
        c3: { name: 'Sign up → Registered or applied (7 days)', type: 'Funnels', tbl: t([{ channel: 'organic', conversion: 0.44 }, { channel: 'paid', conversion: 0.29 }, { channel: 'direct', conversion: 0.39 }, { channel: 'social', conversion: 0.26 }]) },
        c4: { name: 'Retention of new signups', type: 'Retention', tbl: t(months.flatMap(m => [{ cohort: m, source: 'organic', day_7: 0.36, day_30: 0.21 }, { cohort: m, source: 'paid', day_7: 0.27, day_30: 0.13 }])) }
      },
      maps: {
        moeSignups: { chart: 'c1', column: 'signups', agg: 'sum', filterCol: 'source', filterText: 'organic', compareText: 'cpc, social, referral' },
        profile: { chart: 'c2', column: 'conversion', agg: 'avg', filterCol: 'channel', filterText: 'organic', compareText: 'paid' },
        act7: { chart: 'c3', column: 'conversion', agg: 'avg', filterCol: 'channel', filterText: 'organic', compareText: 'paid' },
        ret30: { chart: 'c4', column: 'day_30', agg: 'avg', filterCol: 'source', filterText: 'organic', compareText: 'paid' }
      } };
  }
  function demoFill(D) {
    if (D.source !== 'demo' || D.sampleOf !== 'unstop') return;
    if (!GA.has(D.site)) GA.set(D.site, { raw: sampleGa(D), property: 'sample', propertyName: 'Sample numbers', start: D.start, end: D.end, at: Date.now(), sample: true, failed: [] });
    if (!MOE.has(D.site)) { const rows = sampleMoe(D); MOE.set(D.site, { rows, res: U.moeQuality(rows, moeOpt(settings(D.site))), name: 'Sample users', at: Date.now(), sample: true }); }
    if (!MOELIVE.has(D.site)) MOELIVE.set(D.site, sampleMoeLive());
  }

  // ════════════════════════════ FULL FUNNEL ════════════════════════════
  V.funnel = (A, D) => {
    demoFill(D);
    Object.keys(TABLES).filter(k => k.startsWith('t-un-f')).forEach(k => delete TABLES[k]);
    window.CW_LAST_A = A;
    const { typeOf, s } = tools(D);
    const G = gscModel(A, D), ga = gaModel(D), g = GA.get(D.site), m = MOE.get(D.site), moe = m && m.res.ok ? m.res : null;
    const src = window.CW_SOURCE || {};
    const ml = moeLive(D), mlv = ml ? ml.m : {}, mlL = MOELIVE.get(D.site), mlSt = mlL && mlL.demo ? 'sample' : 'live';
    const gscSt = D.source === 'api' ? 'live' : D.source === 'demo' ? 'sample' : 'file', gaSt = g ? (g.sample ? 'sample' : 'live') : 'none', moeSt = ml ? mlSt : m ? (m.sample ? 'sample' : 'file') : 'none';
    const gscAt = src.kind === 'api' ? Date.now() : null;
    const nbTot = A.totNB, bTot = A.totB;
    const site = A.site, ps = A.prevSite;
    const tr = G.ranks.total;
    const visUrls = G.vis.rows.reduce((a, r) => a + r.urls, 0), prevUrls = G.vis.rows.reduce((a, r) => a + (r.prevUrls || 0), 0);
    const sigs = ga ? ga.ev.stu + ga.ev.emp : null;
    const days = ga && g ? Math.round((new Date(g.end) - new Date(g.start)) / 864e5) + 1 : null;
    const demoCost = D.sampleOf === 'unstop' && !String(s.monthlyCost || '').trim();
    const cost = demoCost ? 450000 : parseFloat(String(s.monthlyCost).replace(/[^0-9.]/g, ''));
    const pathCov = ga && ga.pathCov ? ga.pathCov.share : null;
    const blogT = ga && ga.types.find(t => t.id === 'blog');
    const ret = ga && ga.returning.cur;
    const aiS = ga ? ga.ai.reduce((a, r) => a + r.sessions, 0) : null, aiY = ga ? ga.ai.reduce((a, r) => a + r.ySessions, 0) : null;
    const V2 = {
      impr: [fmtN(site.impr), ps ? U.chg(site.impr, ps.impr) : null, gscSt, gscAt],
      clicks: [fmtN(site.clicks), ps ? U.chg(site.clicks, ps.clicks) : null, gscSt, gscAt],
      ctr: [pct1(site.ctr), ps ? U.chg(site.ctr, ps.ctr) : null, gscSt, gscAt],
      pos: [site.pos ? site.pos.toFixed(1) : '—', ps && ps.pos && site.pos ? site.pos - ps.pos : null, gscSt, gscAt, 'pos'],
      nbClicks: [fmtN(nbTot.clicks), A.prev ? U.chg(nbTot.clicks, A.prev.nb.clicks) : null, gscSt, gscAt, null, `${pct1(nbTot.clicks / Math.max(1, nbTot.clicks + bTot.clicks) * 100)} of query clicks`],
      top10: [fmtN(tr.n.top10), G.ranks.hasPrev ? U.chg(tr.n.top10, tr.pn.top10) : null, gscSt, gscAt, null, `top 3: ${fmtN(tr.n.top3)}`],
      p11: [fmtN(tr.n.p11), G.ranks.hasPrev ? U.chg(tr.n.p11, tr.pn.p11) : null, gscSt, gscAt],
      indexed: [fmtN(visUrls), prevUrls ? U.chg(visUrls, prevUrls) : null, gscSt, gscAt, null, A.coverage && A.coverage.rowLimit ? 'capped by row limit' : ''],
      sessions: ga ? [fmtN(ga.total.sessions), ga.dSessions, gaSt, g.at, null, 'vs last year'] : null,
      newUsers: ga ? [fmtN(ga.total.newUsers), ga.dNewUsers, gaSt, g.at, null, 'vs last year'] : null,
      pathCov: ga ? [pct1(pathCov), ga.pathCov && ga.pathCov.yShare != null && pathCov != null ? pathCov - ga.pathCov.yShare : null, gaSt, g.at, 'pp', 'vs last year'] : null,
      stu: ga ? [fmtN(ga.ev.stu), U.chg(ga.ev.stu, ga.ev.yStu), gaSt, g.at, null, 'vs last year'] : null,
      emp: ga ? [fmtN(ga.ev.emp), U.chg(ga.ev.emp, ga.ev.yEmp), gaSt, g.at, null, 'vs last year'] : null,
      cvr: ga ? [pct1(ga.total.sessions ? sigs / ga.total.sessions * 100 : null), null, gaSt, g.at] : null,
      cps: ga && cost > 0 && sigs ? ['₹' + fmtN(cost / (sigs * 30 / days)), null, 'input', g.at, null, `₹${fmtN(cost)} / month${demoCost ? ' (sample cost)' : ''}`] : null,
      profile: moe && moe.seg.organic.profile ? [pct1(moe.seg.organic.profile.rate), moe.seg.other.profile ? moe.seg.organic.profile.rate - moe.seg.other.profile.rate : null, moeSt, m.at, 'pp', 'vs other channels'] : null,
      act7: moe && moe.seg.organic.act7 ? [pct1(moe.seg.organic.act7.rate), moe.seg.other.act7 ? moe.seg.organic.act7.rate - moe.seg.other.act7.rate : null, moeSt, m.at, 'pp', 'vs other channels'] : null,
      ret30: moe && moe.seg.organic.ret30 ? [pct1(moe.seg.organic.ret30.rate), moe.seg.other.ret30 ? moe.seg.organic.ret30.rate - moe.seg.other.ret30.rate : null, moeSt, m.at, 'pp', 'vs other channels'] : null,
      ...Object.fromEntries(['moeSignups', 'profile', 'act7', 'ret30'].filter(k => mlv[k] && mlv[k].value != null).map(k => { const x = mlv[k]; return [k, x.rate ? [pct1(x.value), x.compare != null ? x.value - x.compare : null, mlSt, ml.at, 'pp', x.compare != null ? 'vs compared rows' : 'MoEngage live'] : [fmtN(Math.round(x.value)), null, mlSt, ml.at, null, x.compare != null ? 'vs ' + fmtN(Math.round(x.compare)) + ' compared' : 'MoEngage live']]; })),
      engRate: ga ? [pct1(ga.total.engRate), null, gaSt, g.at] : null,
      pps: ga ? [ga.total.pps ? ga.total.pps.toFixed(2) : '—', null, gaSt, g.at] : null,
      returning: ga && ret ? [pct1(ret.share), ga.returning.yoy ? ret.share - ga.returning.yoy.share : null, gaSt, g.at, 'pp', 'vs last year'] : null,
      opp: ga ? [fmtN(ga.ev.opp), U.chg(ga.ev.opp, ga.ev.yOpp), gaSt, g.at, null, 'vs last year'] : null,
      prodClick: ga ? [fmtN(blogT ? blogT.prodClick : 0), null, gaSt, g.at, null, blogT && blogT.sessions ? (blogT.prodClick / blogT.sessions * 100).toFixed(1) + ' per 100 blog sessions' : ''] : null,
      demo: ga ? [fmtN(ga.ev.demo), U.chg(ga.ev.demo, ga.ev.yDemo), gaSt, g.at, null, 'vs last year'] : null,
      contact: ga ? [fmtN(ga.ev.contact), U.chg(ga.ev.contact, ga.ev.yContact), gaSt, g.at, null, 'vs last year'] : null,
      pricing: ga ? [fmtN(ga.pricing.sessions), U.chg(ga.pricing.sessions, ga.pricing.ySessions), gaSt, g.at, null, 'vs last year'] : null,
      aiSessions: ga ? [fmtN(aiS), U.chg(aiS, aiY), gaSt, g.at, null, 'vs last year'] : null
    };
    const owners = s.owners || {};
    const stages = ['Visibility', 'Traffic', 'Signups', 'Engagement', 'Leads', 'Pipeline & revenue'];
    const link = { Visibility: '#visibility', Traffic: '#ga4', Signups: '#ga4', Engagement: '#ga4', Leads: '#ga4', 'Pipeline & revenue': null };
    const card = mt => {
      const v = V2[mt.id];
      const st = mt.later ? 'later' : v ? v[2] : mt.src === 'MoEngage' ? 'none' : mt.src === 'Cost input' ? 'input' : 'none';
      const need = mt.later ? 'CRM export (next phase)' : mt.src === 'GA4' ? '<a href="#ga4">Connect GA4</a>' : mt.src === 'MoEngage' ? '<a href="#quality">Connect MoEngage or upload an export</a>' : mt.src === 'Cost input' ? '<a href="#funnelsetup">Add monthly SEO cost</a>' : '';
      const d = v ? (v[4] === 'pos' ? dchip(v[1], true, 'pos') : v[4] === 'pp' ? (v[1] == null ? '' : `<span class="un-d ${v[1] > 0 ? 'up' : v[1] < 0 ? 'down' : 'flat'}">${v[1] > 0 ? '+' : ''}${v[1].toFixed(1)} pts</span>`) : dchip(v[1])) : '';
      return `<div class="un-m${v ? '' : ' empty'}" title="${esc(mt.def)}"><div class="un-m-top"><span>${esc(mt.label)}</span>${chip(st)}</div>
        <b>${v ? v[0] : '—'}</b><div class="un-m-sub">${v ? d + ' ' + esc(v[5] || (v[1] != null && mt.src === 'GSC' ? 'vs previous period' : '')) : need}</div>
        <div class="un-m-foot"><span>${esc(owners[mt.id] || mt.owner)}</span><span>${esc(mt.src)} · ${esc(mt.cadence)}</span></div></div>`;
    };
    const chain = U.joinChain(G.vis, ga, typeOf).filter(r => (r.gsc && r.gsc.impr) || (r.ga && r.ga.sessions));
    const q1 = U.topSignupPages(ga, 15), q2 = U.nonBrandedSignupShare(ga, D, brandOf(A));
    const html = head('Full funnel', 'Visibility → traffic → signups → engagement → leads → pipeline in one view. Every metric shows its source, owner, cadence and whether it is live. Hover a metric for its definition.') + scopePicker(A, D) +
      `<div class="un-sources">
        <div><span>Search Console</span>${chip(gscSt)}<small>${esc(D.site)} · ${fmtD(D.start)} – ${fmtD(D.end)}${D.prevStart ? '' : ' · no comparison period'}</small></div>
        <div><span>GA4</span>${chip(gaSt)}<small>${g ? esc(g.propertyName) + ' · ' + fmtD(g.start) + ' – ' + fmtD(g.end) : '<a href="#ga4">Connect GA4</a>'}</small></div>
        <div><span>MoEngage</span>${chip(moeSt)}<small>${ml ? 'Live dashboard · ' + Object.keys(mlv).length + ' metric(s) mapped' + (m ? ' · plus export' : '') : mlL && mlL.status === 'loading' ? 'Loading live dashboard…' : m ? esc(m.name) + ' · ' + fmtN(m.res.total || 0) + ' users' : '<a href="#quality">Connect live or upload export</a>'}</small></div>
        <div><span>CRM</span>${chip('later')}<small>MQLs, pipeline and revenue come next</small></div>
      </div>` +
      `<div class="un-stages">${stages.map(st => `<section class="un-stage"><h2>${link[st] ? `<a href="${link[st]}">${esc(st)}</a>` : esc(st)}</h2>${U.METRICS.filter(x => x.stage === st).map(card).join('')}</section>`).join('')}</div>` +
      `<section class="panel"><div class="panel-h"><h2>The chain by page type</h2><p>Search Console pages and GA4 landing pages classified with the same rules. Never read a single sitewide number in isolation.</p></div>
        ${table('t-un-fc', [
        { k: 'name', l: 'Page type', f: r => `<b>${esc(r.name)}</b>` },
        { k: 'impr', l: 'Impressions', r: 1, f: r => r.gsc ? fmtN(r.gsc.impr) : '—', csv: r => r.gsc ? r.gsc.impr : '' },
        { k: 'clicks', l: 'Clicks', r: 1, f: r => r.gsc ? fmtN(r.gsc.clicks) + ' ' + dchip(r.gsc.dClicks) : '—', csv: r => r.gsc ? r.gsc.clicks : '' },
        { k: 'nb', l: 'Non-branded clicks (est.)', r: 1, f: r => r.gsc && r.gsc.estNB ? fmtN(r.gsc.estNB.clicks) : '—', csv: r => r.gsc && r.gsc.estNB ? Math.round(r.gsc.estNB.clicks) : '' },
        { k: 'pos', l: 'Position', r: 1, f: r => r.gsc && r.gsc.impr ? posTag(r.gsc.pos) : '—', csv: r => r.gsc ? r.gsc.pos : '' },
        { k: 'sessions', l: 'Organic sessions', r: 1, f: r => r.ga ? fmtN(r.ga.sessions) + ' ' + dchip(r.ga.dSessions) : '—', csv: r => r.ga ? r.ga.sessions : '' },
        { k: 'engRate', l: 'Eng. rate', r: 1, f: r => r.ga ? pct1(r.ga.engRate) : '—', csv: r => r.ga ? r.ga.engRate : '' },
        { k: 'signups', l: 'Signups (student / employer)', r: 1, f: r => r.ga ? `${fmtN(r.ga.signups)} <small class="un-n">${fmtN(r.ga.stu)} / ${fmtN(r.ga.emp)}</small>` : '—', csv: r => r.ga ? r.ga.signups : '' },
        { k: 'cvr', l: 'Signup CVR', r: 1, f: r => r.ga ? pct1(r.ga.cvr) : '—', csv: r => r.ga ? r.ga.cvr : '' },
        { k: 'opp', l: 'Register / apply', r: 1, f: r => r.ga ? fmtN(r.ga.opp) : '—', csv: r => r.ga ? r.ga.opp : '' },
        { k: 'leads', l: 'Demo + contact', r: 1, f: r => r.ga ? fmtN(r.ga.demo + r.ga.contact) : '—', csv: r => r.ga ? r.ga.demo + r.ga.contact : '' }
      ], chain.map(r => ({ ...r, impr: r.gsc ? r.gsc.impr : -1, clicks: r.gsc ? r.gsc.clicks : -1, sessions: r.ga ? r.ga.sessions : -1, signups: r.ga ? r.ga.signups : -1 })), { search: false, file: 'unstop-funnel-by-page-type', pageSize: 30 })}</section>` +
      `<div class="grid-2 even">
        <section class="panel"><div class="panel-h"><h2>1. Which pages drove the most signups?</h2><p>Organic landing pages ranked by signup events in the GA4 period.</p></div>${ga ? (q1.length ? `<div class="tw"><table class="un-mini"><thead><tr><th>Landing page</th><th>Cluster › folder</th><th class="r">Signups</th><th class="r">CVR</th></tr></thead><tbody>${withCluster(D, q1, p => p.path).map(p => `<tr><td class="u">${esc(p.path)}</td><td>${esc(p.cluster)} <code>${esc(p.folder)}</code></td><td class="r">${fmtN(p.signups)}</td><td class="r">${pct1(p.cvr)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No signup events found in organic sessions. Check the signup event names in Funnel setup against the GA4 event list.</p>') : '<p class="empty"><a href="#ga4">Connect GA4</a> to answer this.</p>'}</section>
        <section class="panel"><div class="panel-h"><h2>2. What share of organic signups comes from non-branded searches?</h2><p>Estimate: each landing page’s signups × the non-branded share of its Search Console clicks.</p></div><div class="panel-b">${q2 ? `<div class="un-big"><b>${pct1(q2.share)}</b><span>estimated non-branded share of organic signups</span></div><p class="hint">${fmtN(Math.round(q2.nb))} of ${fmtN(q2.matched)} signups on pages found in Search Console query × page rows (${pct1(q2.coverage)} of organic signups). ${fmtN(q2.unmatched)} signups landed on pages without query data and are left out. Search Console never ties a query to a signup, so treat this as a labelled proxy.</p>` : `<p class="empty">${!ga ? '<a href="#ga4">Connect GA4</a> and ' : ''}${!(D.QP && D.QP.length) ? 'connect Search Console (query × page rows are needed)' : 'load signup events'} to estimate this.</p>`}</div></section>
      </div>` +
      `<section class="panel"><div class="panel-h"><h2>3. How much pipeline can we trace to organic?</h2></div><div class="panel-b"><p class="empty">Next phase: needs the CRM export (lead ID, first-touch and assisted channel, opportunity, amount, stage). Report organic first-touch and organic-assisted pipeline separately, and only after join coverage is validated.</p></div></section>` +
      `<p class="un-row"><button class="btn-quiet" type="button" id="un-f-export">Download funnel metrics (CSV)</button><span class="hint">Metric, stage, value, change, status, source, owner, cadence, definition and last refresh.</span></p>`;
    const mount = () => {
      drawTable('t-un-fc');
      moeAuto(D); scopeMount(D);
      const ex = document.getElementById('un-f-export');
      if (ex) ex.addEventListener('click', () => {
        const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
        const lines = [['Stage', 'Metric', 'Value', 'Change', 'Status', 'Source', 'Owner', 'Cadence', 'Definition', 'Last refresh'].map(cell).join(',')];
        U.METRICS.forEach(mt => { const v = V2[mt.id]; lines.push([mt.stage, mt.label, v ? v[0] : '', v && v[1] != null ? (+v[1]).toFixed(1) + (v[4] === 'pos' ? '' : v[4] === 'pp' ? ' pts' : '%') : '', mt.later ? 'Next phase' : v ? { live: 'Live', file: 'Upload', sample: 'Sample', input: 'Input' }[v[2]] : 'Not connected', mt.src, owners[mt.id] || mt.owner, mt.cadence, mt.def, v && v[3] ? new Date(v[3]).toISOString() : ''].map(cell).join(',')); });
        download(`unstop-funnel-${D.start}-${D.end}.csv`, lines.join('\n'));
      });
    };
    return { html, mount };
  };

  // ════════════════════════════ SETUP ════════════════════════════
  V.funnelsetup = (A, D) => {
    window.CW_LAST_A = A;
    const s = settings(D.site);
    const { typeOf } = tools(D);
    const evRow = (k, l) => `<label class="field"><span>${esc(l)}</span><input type="text" data-ev="${k}" value="${esc((s.events[k] || []).join(', '))}"></label>`;
    // folders in the loaded data that no rule covers
    const other = new Map();
    (A.P || []).forEach(r => { if (typeOf(r.p) !== 'other') return; const seg = '/' + (U.pathOnly(r.p).split('/')[1] || ''); other.set(seg, (other.get(seg) || 0) + (+r.clicks || 0)); });
    const unc = [...other.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    const html = head('Funnel setup', 'Page-type rules, query clusters, GA4 event names, metric owners and cost. Saved in this browser for ' + esc(D.site) + '.') +
      `<form id="un-setup" class="un-setup">
      <section class="panel"><div class="panel-h"><h2>Page types</h2><p>One type per line: <code>Name: /folder, /other-folder, /prefix-*, =/exact-path</code>. First match wins, top to bottom. The four tracking-sheet types are Opportunity & competition, College & company, Blog & guides and Employer-facing.</p></div><div class="panel-b">
        <textarea id="un-types" rows="9" spellcheck="false">${esc(U.typesText(s.types || U.DEFAULT_TYPES))}</textarea>
        <label class="check"><input type="checkbox" id="un-rootart" ${s.rootArticles ? 'checked' : ''}> Treat root-level article slugs (one folder, 4+ hyphens) as Blog & guides</label>
        ${unc.length ? `<p class="hint">Folders in this data that no rule covers (counted as Other), by clicks: ${unc.map(([k, c]) => `<code>${esc(k)}</code> ${fmtN(c)}`).join(' · ')}</p>` : '<p class="hint">Every page in this data matches a rule.</p>'}
      </div></section>
      <section class="panel"><div class="panel-h"><h2>URL clusters</h2><p>The finer split inside each page type, used on <a href="#urlclusters">Clusters: branded vs non-branded</a>. One cluster per line: <code>Name | Page type: /folder, /prefix-*, =/exact</code>. First match wins, so put narrower rules (e.g. <code>/employers/hire-*</code>) above wider ones (<code>/employers</code>).</p></div><div class="panel-b">
        <textarea id="un-sections" rows="12" spellcheck="false">${esc(U.sectionsText(s.sections, s.types))}</textarea>
        ${(() => { const so = U.makeSectioner(s.sections, { rootArticles: s.rootArticles }); const o = new Map(); (A.P || []).forEach(r => { if (so(r.p) !== 'other') return; const seg = '/' + (U.pathOnly(r.p).split('/')[1] || ''); o.set(seg, (o.get(seg) || 0) + (+r.clicks || 0)); }); const u = [...o.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20); return u.length ? `<p class="hint">Folders no cluster covers, by clicks: ${u.map(([k, c]) => `<code>${esc(k)}</code> ${fmtN(c)}`).join(' · ')}</p>` : '<p class="hint">Every page in this data matches a cluster.</p>'; })()}
      </div></section>
      <section class="panel"><div class="panel-h"><h2>Query clusters</h2><p>One cluster per line: <code>Name: word, phrase, word</code>. First match wins.</p></div><div class="panel-b"><textarea id="un-clusters" rows="9" spellcheck="false">${esc(U.clustersText(s.clusters || U.DEFAULT_CLUSTERS))}</textarea></div></section>
      <section class="panel"><div class="panel-h"><h2>GA4 event names</h2><p>Comma-separated, exact GA4 event names. The GA4 screen lists every event recorded in organic sessions.</p></div><div class="panel-b un-grid2">
        ${evRow('studentSignup', 'Student signup')}${evRow('employerSignup', 'Employer / recruiter signup')}${evRow('demoRequest', 'Demo request')}${evRow('contactSubmit', 'Contact form submission')}${evRow('opportunityAction', 'Opportunity register / apply')}${evRow('productClick', 'Product click (blog → product)')}${evRow('scroll', 'Scroll')}
        <label class="field"><span>Pricing page paths</span><input type="text" id="un-pricing" value="${esc(s.pricingPaths.join(', '))}"></label>
        <label class="field"><span>AI assistant sources (GA4 session source contains)</span><input type="text" id="un-ai" value="${esc(s.aiSources.join(', '))}"></label>
        <label class="field"><span>GA4 property ID</span><input type="text" id="un-prop" inputmode="numeric" value="${esc(s.ga4Property)}"></label>
      </div></section>
      <section class="panel"><div class="panel-h"><h2>Conversion paths, cost and MoEngage</h2></div><div class="panel-b un-grid2">
        <fieldset class="field"><span>URL clusters with a clear conversion path (register, apply, post a job, book a demo)</span>${(() => { const ps = s.pathSections || U.DEFAULT_PATH_SECTIONS; return U.makeSectioner(s.sections).sections.filter(x => x.id !== 'other').map(x => `<label class="check"><input type="checkbox" data-path="${esc(x.id)}" ${ps.includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join(''); })()}</fieldset>
        <div>
          <label class="field"><span>Monthly SEO cost in ₹ (content, agency, tools, team share)</span><input type="text" id="un-cost" inputmode="decimal" value="${esc(s.monthlyCost)}" placeholder="e.g. 450000"></label>
          <label class="field"><span>Profile counts as complete at (%)</span><input type="number" id="un-moe-th" min="1" max="100" value="${esc(s.moeThreshold)}"></label>
          <label class="field"><span>Extra organic source words for MoEngage (optional)</span><input type="text" id="un-orgsrc" value="${esc(s.organicSources)}" placeholder="google, bing, organic, seo"></label>
        </div>
      </div></section>
      <section class="panel"><div class="panel-h"><h2>Metric owners</h2><p>Defaults come from the tracking sheet.</p></div><div class="panel-b un-grid3">
        ${U.METRICS.map(mt => `<label class="field"><span>${esc(mt.stage)} · ${esc(mt.label)}</span><input type="text" data-owner="${esc(mt.id)}" value="${esc((s.owners || {})[mt.id] || mt.owner)}"></label>`).join('')}
      </div></section>
      <div class="un-row"><button class="btn-primary" type="submit">Save setup</button><button class="btn-quiet" type="button" id="un-reset">Reset to defaults</button><span class="progress" id="un-saved" role="status"></span></div>
      </form>`;
    const mount = () => {
      const f = document.getElementById('un-setup');
      f.addEventListener('submit', e => {
        e.preventDefault();
        const n = settings(D.site);
        const types = U.parseTypes(document.getElementById('un-types').value);
        const cl = U.parseClusters(document.getElementById('un-clusters').value);
        n.types = types.length ? types : null; n.clusters = cl.length ? cl : null;
        const secs = U.parseSections(document.getElementById('un-sections').value, n.types || U.DEFAULT_TYPES); n.sections = secs.length ? secs : null;
        n.rootArticles = document.getElementById('un-rootart').checked;
        f.querySelectorAll('[data-ev]').forEach(i => { n.events[i.dataset.ev] = i.value.split(',').map(x => x.trim()).filter(Boolean); });
        n.pricingPaths = document.getElementById('un-pricing').value.split(',').map(x => x.trim()).filter(Boolean);
        n.aiSources = document.getElementById('un-ai').value.split(',').map(x => x.trim()).filter(Boolean);
        n.ga4Property = document.getElementById('un-prop').value.trim().replace(/^properties\//, '');
        n.pathSections = [...f.querySelectorAll('[data-path]')].filter(i => i.checked).map(i => i.dataset.path);
        n.monthlyCost = document.getElementById('un-cost').value.trim();
        n.moeThreshold = +document.getElementById('un-moe-th').value || 80;
        n.organicSources = document.getElementById('un-orgsrc').value.trim();
        const owners = {}; f.querySelectorAll('[data-owner]').forEach(i => { const def = U.METRICS.find(x => x.id === i.dataset.owner); if (i.value.trim() && def && i.value.trim() !== def.owner) owners[i.dataset.owner] = i.value.trim(); }); n.owners = owners;
        save(D.site, n);
        const mm = MOE.get(D.site); if (mm && mm.rows) mm.res = U.moeQuality(mm.rows, moeOpt(n));
        const g = GA.get(D.site); if (g) g.model = null;
        WEEK.forEach((v, k) => { if (k.startsWith(D.site + '|')) WEEK.delete(k); });
        rerender();
        setTimeout(() => { const el = document.getElementById('un-saved'); if (el) el.textContent = 'Saved. All funnel screens now use these settings.'; }, 50);
      });
      document.getElementById('un-reset').addEventListener('click', () => { if (!confirm('Reset page types, clusters, events, owners and cost for this site to the defaults?')) return; try { localStorage.removeItem(KEY(D.site)); } catch (e) { } const g = GA.get(D.site); if (g) g.model = null; rerender(); });
    };
    return { html, mount };
  };

  window.UN_VIEW = { GA, MOE, settings, sampleGa, sampleMoe };
})();
