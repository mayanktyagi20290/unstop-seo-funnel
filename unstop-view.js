// Unstop full-funnel screens: Full funnel, Visibility by page type (GSC), GA4 organic, Signup quality
// (MoEngage) and Funnel setup. Settings are kept per site in this browser; GA4 and MoEngage data stay in
// this tab's memory unless the user chooses otherwise.
(function () {
  'use strict';
  const { V, esc, ui } = window.CW_VIEWS;
  const { head, table, drawTable, TABLES, chart, cssVar, posTag, pctf, urlCell } = ui;
  const CW = window.CW, U = window.UN, fmtN = CW.fmtN;
  const CFG = (window.CW_CONFIG && window.CW_CONFIG.unstop) || {};
  const GA_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/spreadsheets.readonly'; // webmasters too: the MoEngage proxy checks Search Console access
  // Re-render after the current task, and only once however many loaders finish together. A loader that
  // starts during a screen's mount therefore never re-renders the page under that mount.
  let rrPending = false;
  const rerender = () => { if (rrPending) return; rrPending = true; setTimeout(() => { rrPending = false; window.dispatchEvent(new HashChangeEvent('hashchange')); }, 0); };

  // ── per-site settings ──
  const KEY = site => 'un:funnel:' + site;
  const DEF = () => ({
    types: null, sections: null, rootArticles: true, clusters: null,
    events: JSON.parse(JSON.stringify(CFG.events || {})),
    ga4Property: CFG.ga4PropertyId || '', pricingPaths: (CFG.pricingPaths || []).slice(), aiSources: (CFG.aiSources || []).slice(),
    pathTypes: ['opp', 'emp', 'org'], pathSections: null, owners: {}, monthlyCost: '', empCostShare: '', moeThreshold: 80, organicSources: ''
  });
  function settings(site) { let s = null; try { s = JSON.parse(localStorage.getItem(KEY(site))); } catch (e) { } const d = DEF(); if (s && Array.isArray(s.sections)) s.sections = s.sections.map(x => { const d = U.DEFAULT_SECTIONS.find(y => y.id === x.id); if (!d || !['empjobboard', 'empb2b'].includes(x.id) || !/^Employer › (Job board|B2B products)$/.test(x.name)) return x; return { ...x, name: d.name, rules: x.id === 'empjobboard' ? d.rules : x.rules }; }); if (s && s.events && JSON.stringify(s.events.contactSubmit) === '["contact_form_submit","form_submit"]') s.events.contactSubmit = d.events.contactSubmit; return s ? { ...d, ...s, events: { ...d.events, ...(s.events || {}) } } : d; }
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
  let MSG = { ga: '', moe: '', crm: '' };

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
      sovBlock(A, D) +
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
      `<section class="panel"><div class="panel-h"><h2>Indexation by page type</h2><p>URLs submitted in sitemaps (Search Console API) next to URLs that got impressions. The API no longer reports indexed counts, so “visible ÷ submitted” is a proxy; upload the indexed count per sitemap from Search Console’s Pages report (below) for exact indexed ÷ submitted. Programmatic sitemaps (internships, jobs, company pages) are where indexation is usually the bottleneck.</p></div><div class="panel-b" id="un-maps">${mapsBlock(D, vis, live)}</div></section>` +
      `<section class="panel"><div class="panel-h"><h2>Pages by cluster and folder</h2></div>
        ${table('t-un-vp', [
        { k: 'path', l: 'Page', cls: 'u', f: r => urlCell(r.p, r.path), csv: r => r.p }, { k: 'cluster', l: 'Cluster' }, { k: 'folder', l: 'Folder', f: r => `<code>${esc(r.folder)}</code>`, csv: r => r.folder },
        { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) }, { k: 'impr', l: 'Impressions', r: 1, f: r => fmtN(r.impr) }, { k: 'ctr', l: 'CTR', r: 1, f: r => pct1(r.ctr) }, { k: 'pos', l: 'Position', r: 1, f: r => posTag(r.pos) }
      ], withCluster(D, A.P, r => r.p).map(r => ({ ...r, typeName: typeOf.label(typeOf(r.p)) })), { file: 'unstop-pages-by-cluster', sort: 'clicks', pageSize: 20, searchKeys: ['path', 'folder'], placeholder: 'Filter URLs or folders',
        filters: [{ key: 'type', label: 'Page type', options: typeOf.types.map(t => [t.name, t.name]), test: (r, v) => r.typeName === v }, clusterFilter(D)] })}</section>`;
    const mount = () => {
      ['t-un-vt', 't-un-vr', 't-un-vc', 't-un-vrc', 't-un-vs', 't-un-vp'].forEach(drawTable);
      if (live) weeklyMount(D); mapsMount(D); sovMount(A, D); scopeMount(D); ['t-un-vsov'].forEach(drawTable);
    };
    return { html, mount };
  };
  const clusterFilter = (D, key) => { const so = sectioner(D); return { key: key || 'cl', label: 'Cluster', options: so.sections.map(x => [x.name, x.name]), test: (r, v) => r.cluster === v }; };
  const withCluster = (D, rows, keyOf) => { const so = sectioner(D); return rows.map(r => { const u = keyOf(r); return { ...r, cluster: so.label(so(u)), folder: so.folderOf(u) }; }); };

  // ── share of voice against the named competitors on the fixed keyword set ──
  const DEF_COMP = ['internshala.com', 'naukri.com', 'hackerearth.com', 'careers360.com'];
  const compOf = s => (s.competitors && s.competitors.length ? s.competitors : DEF_COMP).slice(0, 8);
  function sampleSov(D) {
    let seed = 77; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const s = settings(D.site), comps = compOf(s);
    const kws = [['internship', 220000, [8, 1, 5, 30, 12]], ['summer internship 2026', 48000, [5, 1, 9, 40, 7]], ['work from home internship', 26000, [12, 1, 6, null, 15]], ['hackathons', 90000, [2, 14, 11, 1, 9]], ['hackathon 2026', 52000, [3, null, 18, 2, 6]], ['online hackathons', 26000, [2, 25, null, 1, 12]], ['case study competition', 40000, [2, 6, null, 15, 4]], ['competitions for college students', 30000, [6, 3, null, 9, 2]], ['jobs for freshers', 70000, [12, 6, 1, 20, 8]], ['off campus drive 2026', 42000, [6, 9, 2, null, 5]], ['scholarships for students 2026', 36000, [12, 7, 10, null, 1]], ['campus ambassador program', 26000, [3, 1, 15, null, 8]], ['tcs nqt exam pattern', 30000, [6, 9, 5, 4, 1]], ['coding questions for placement', 14000, [9, 20, 12, 1, 7]], ['ats software', 22000, [24, null, 9, 30, null]], ['campus hiring platform', 4000, [10, 4, 3, 6, null]], ['online assessment platform', 9000, [13, null, 11, 2, null]], ['college fests 2026', 26000, [3, 20, null, null, 4]]];
    const rows = [['Keyword', 'Volume', 'Domain', 'Position', 'Date']];
    ['2026-09-01', '2026-10-01'].forEach((dt, k) => kws.forEach(([kw, v, pos]) => ['unstop.com'].concat(comps.slice(0, 4)).forEach((d, i) => { let p = pos[i]; if (p == null) return; p = Math.max(1, Math.round(p + (k ? (i === 0 ? -R() * 1.5 : R() * 1.2 - .4) : 0))); rows.push([kw, v, d, p, dt]); })));
    return rows;
  }
  function sovOf(D) {
    const X = scd(D.site), s = settings(D.site);
    if (!X.sov && D.sampleOf === 'unstop') X.sov = { name: 'Sample rank tracking', sample: true, rows: sampleSov(D) };
    if (!X.sov) return null;
    return U && window.UN_SC.sovModel(X.sov.rows, { own: (D.site || 'unstop.com').replace(/^sc-domain:/, ''), competitors: compOf(s), keywords: s.sovKeywords || [], clusterOf: tools(D).clusterOf, ctr: CW.expCtr });
  }
  function sovBlock(A, D) {
    const X = scd(D.site), s = settings(D.site), M = sovOf(D);
    const head2 = `<section class="panel"><div class="panel-h"><h2>Share of voice vs ${esc(compOf(s).join(', '))}</h2><p>Fixed keyword set from a rank tracker (Semrush Position Tracking, Ahrefs Rank Tracker, SE Ranking, DataForSEO…). Share of voice = estimated clicks (search volume × expected CTR at the position) ÷ the same for Unstop and the competitors together. Competitors and the fixed keyword list are set in Funnel setup.</p></div><div class="panel-b"><div class="un-row"><label class="btn-quiet un-file">Upload rank tracking export<input type="file" id="un-sov-file" accept=".csv,.xlsx,.xls" hidden></label><button class="btn-quiet" type="button" id="un-sov-tpl">Template</button>${X.sov ? `<span class="hint">${esc(X.sov.name)}${X.sov.sample ? ' (sample)' : ''}</span>` : ''}</div>${M && !M.ok ? `<p class="start-error">${esc(M.error)}</p>` : ''}</div>`;
    if (!M || !M.ok) return head2 + '</section>';
    const per = M.cur.per.slice().sort((a, b) => (b.sov || 0) - (a.sov || 0));
    const doms = M.domains;
    return head2 + `<div class="panel-b"><p class="un-meta">${M.latest ? 'Latest check ' + fmtD(M.latest) + (M.prevDate ? ', compared with ' + fmtD(M.prevDate) : '') + ' · ' : ''}${fmtN(M.cur.keywords)} keywords${M.fixed ? ` of the ${M.fixed}-keyword fixed set${M.missing.length ? ` (${M.missing.length} not in the file)` : ''}` : ''}</p>
      <div class="tw"><table class="un-mini"><thead><tr><th>Domain</th><th class="r">Share of voice</th><th class="r">Change</th><th class="r">Keywords ranking</th><th class="r">Top 3</th><th class="r">Top 10</th><th class="r">Average position</th><th>Share</th></tr></thead><tbody>${per.map(x => `<tr${x.own ? ' class="on"' : ''}><td><b>${esc(x.domain)}</b></td><td class="r">${pct1(x.sov)}</td><td class="r">${x.dSov == null ? '—' : `<span class="un-d ${x.dSov > 0 ? 'up' : x.dSov < 0 ? 'down' : 'flat'}">${x.dSov > 0 ? '+' : ''}${x.dSov.toFixed(1)} pts</span>`}</td><td class="r">${x.ranked}</td><td class="r">${x.top3}</td><td class="r">${x.top10}</td><td class="r">${x.avgPos == null ? '—' : x.avgPos.toFixed(1)}</td><td><span class="un-bar"><i style="width:${(x.sov || 0).toFixed(1)}%"></i></span></td></tr>`).join('')}</tbody></table></div></div>
      ${M.byCluster.length ? `<div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Query cluster</th><th class="r">Keywords</th><th class="r">Unstop share of voice</th><th>Leader</th><th class="r">Leader share</th></tr></thead><tbody>${M.byCluster.map(c => `<tr><td><b>${esc(c.cluster)}</b></td><td class="r">${c.keywords}</td><td class="r">${pct1(c.sov)}</td><td>${esc(c.leader || '—')}</td><td class="r">${pct1(c.leaderSov)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      ${table('t-un-vsov', [{ k: 'kw', l: 'Keyword', cls: 'q' }, { k: 'vol', l: 'Volume', r: 1, f: r => r.vol == null ? '—' : fmtN(r.vol) }, { k: 'cluster', l: 'Cluster' }].concat(doms.map(d => ({ k: d, l: d, r: 1, f: r => r[d] == null ? '—' : posTag(r[d]) }))).concat([{ k: 'leader', l: 'Leader' }, { k: 'gap', l: 'Unstop gap', r: 1, f: r => r.gap == null ? 'not ranking' : r.gap === 0 ? 'leads' : '+' + r.gap.toFixed(0) }]), M.kwRows, { file: 'unstop-share-of-voice-keywords', sort: 'vol', pageSize: 15, placeholder: 'Filter keywords' })}</section>`;
  }
  function sovMount(A, D) {
    const f = document.getElementById('un-sov-file');
    if (f) f.addEventListener('change', async () => { const file = f.files[0]; if (!file) return; try { scd(D.site).sov = { name: file.name, rows: await readSheet(file) }; } catch (e) { scd(D.site).sov = { name: file.name, rows: [] }; } rerender(); });
    const t = document.getElementById('un-sov-tpl');
    if (t) t.addEventListener('click', () => download('share-of-voice-template.csv', 'Keyword,Volume,Domain,Position,Date\ninternship,220000,unstop.com,8,2026-10-01\ninternship,220000,internshala.com,1,2026-10-01\nhackathons,90000,unstop.com,2,2026-10-01\nhackathons,90000,hackerearth.com,11,2026-10-01\n'));
  }
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
  function sampleMaps(D) {
    let seed = 5; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const { typeOf } = tools(D);
    const list = [['sitemap-hackathons.xml', 4200], ['sitemap-competitions.xml', 9800], ['sitemap-internships.xml', 52000], ['sitemap-jobs.xml', 31000], ['sitemap-quiz.xml', 2100], ['sitemap-c.xml', 61000], ['sitemap-blog.xml', 3900], ['sitemap-employers.xml', 60], ['sitemap-misc.xml', 300]];
    const rows = U.sitemapTypes(list.map(([f, n]) => ({ path: 'https://unstop.com/' + f, contents: [{ submitted: String(n) }], lastDownloaded: new Date(Date.now() - R() * 6 * 864e5).toISOString(), errors: 0, warnings: R() < .3 ? 1 : 0 })), typeOf);
    const idx = new Map(list.map(([f, n]) => ['https://unstop.com/' + f, Math.round(n * (/internships|jobs|-c\./.test(f) ? .28 + R() * .2 : .7 + R() * .25))]));
    return { status: 'done', rows, at: Date.now(), sample: true, idx };
  }
  // Indexed counts per sitemap come only from Search Console's Pages report (not the API): upload
  // Sitemap, Indexed[, Not indexed][, Submitted].
  function idxRows(rows) {
    const map = window.UN_SC.headerMap(rows[0] || [], { sitemap: ['sitemap', 'sitemap url', 'sitemap path'], indexed: ['indexed', 'indexed pages'], not: ['not indexed', 'not indexed pages'], submitted: ['submitted', 'submitted urls'] });
    if (map.sitemap == null || map.indexed == null) return { error: 'Expected Sitemap and Indexed columns.' };
    const out = new Map(); rows.slice(1).forEach(r => { const sm = String(r[map.sitemap] || '').trim(); if (!sm) return; out.set(sm, { indexed: +String(r[map.indexed]).replace(/,/g, '') || 0, not: map.not != null ? +String(r[map.not]).replace(/,/g, '') || 0 : null, submitted: map.submitted != null ? +String(r[map.submitted]).replace(/,/g, '') || 0 : null }); });
    return { map: out };
  }
  function mapsBlock(D, vis, live) {
    let m = MAPS.get(D.site);
    if (!m && D.sampleOf === 'unstop') { m = sampleMaps(D); MAPS.set(D.site, m); }
    const X = scd(D.site), up = X.idx && X.idx.map ? X.idx.map : null;
    const upl = `<div class="un-row"><label class="btn-quiet un-file">Upload indexed counts per sitemap<input type="file" id="un-idx-file" accept=".csv,.xlsx,.xls" hidden></label><button class="btn-quiet" type="button" id="un-idx-tpl">Template</button>${X.idx ? `<span class="hint">${esc(X.idx.name)}${X.idx.error ? ' · ' + esc(X.idx.error) : ''}</span>` : ''}</div><p class="hint">Search Console › Pages › filter by sitemap shows indexed and not-indexed counts (the API does not). Copy them into Sitemap, Indexed, Not indexed for exact indexed ÷ submitted.</p>`;
    if (!m) return (live ? '<button class="btn-primary sm" type="button" id="un-maps-go">Load sitemaps</button>' : '<p class="empty">Sitemaps need a Search Console connection.</p>') + upl;
    if (m.status === 'loading') return '<p class="progress">Reading sitemaps from Search Console…</p>';
    if (m.status === 'error') return `<p class="start-error">${esc(m.error)}</p><button class="btn-quiet" type="button" id="un-maps-go">Try again</button>`;
    const idxOf = r => { if (up) { const k = [...up.keys()].find(x => x === r.path || r.path.endsWith(x) || x.endsWith(r.path.replace(/^https?:\/\/[^/]+/, ''))); if (k) return up.get(k).indexed; } return m.idx ? m.idx.get(r.path) : null; };
    const byType = new Map();
    m.rows.filter(r => !r.isIndex).forEach(r => { const k = r.type || 'none'; const o = byType.get(k) || { submitted: 0, maps: 0, errors: 0, warnings: 0, indexed: null }; o.submitted += r.submitted; o.maps++; o.errors += r.errors; o.warnings += r.warnings; const ix = idxOf(r); if (ix != null) o.indexed = (o.indexed || 0) + ix; byType.set(k, o); });
    const rows = vis.rows.map(v => { const s2 = byType.get(v.id); return { name: v.name, urls: v.urls, submitted: s2 ? s2.submitted : 0, maps: s2 ? s2.maps : 0, errors: s2 ? s2.errors : 0, indexed: s2 ? s2.indexed : null, rate: s2 && s2.submitted ? v.urls / s2.submitted * 100 : null, irate: s2 && s2.submitted && s2.indexed != null ? s2.indexed / s2.submitted * 100 : null }; });
    const anyIdx = rows.some(r => r.indexed != null);
    const none = byType.get('none');
    return `${m.sample ? '<p class="hint"><b>Sample sitemaps and indexed counts.</b></p>' : ''}<div class="tw"><table class="un-mini"><thead><tr><th>Page type</th><th class="r">Sitemaps</th><th class="r">URLs submitted</th>${anyIdx ? '<th class="r">Indexed</th><th class="r">Indexed ÷ submitted</th>' : ''}<th class="r">URLs with impressions</th><th class="r">Visible ÷ submitted</th><th class="r">Sitemap errors</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${esc(r.name)}</b></td><td class="r">${r.maps || '—'}</td><td class="r">${r.submitted ? fmtN(r.submitted) : '—'}</td>${anyIdx ? `<td class="r">${r.indexed == null ? '—' : fmtN(r.indexed)}</td><td class="r">${r.irate == null ? '—' : `<b class="${r.irate < 50 ? 'un-bad' : ''}">${pct1(Math.min(100, r.irate))}</b>`}</td>` : ''}<td class="r">${fmtN(r.urls)}</td><td class="r">${r.rate == null ? '—' : pct1(Math.min(999, r.rate))}</td><td class="r">${r.errors || '—'}</td></tr>`).join('')}${none ? `<tr><td>Sitemaps not matched to a type</td><td class="r">${none.maps}</td><td class="r">${fmtN(none.submitted)}</td><td colspan="${anyIdx ? 5 : 3}"></td></tr>` : ''}</tbody></table></div>
      <details class="un-det"><summary>${m.rows.length} sitemaps</summary><div class="tw"><table class="un-mini"><thead><tr><th>Sitemap</th><th>Page type</th><th class="r">Submitted</th>${anyIdx ? '<th class="r">Indexed</th>' : ''}<th>Last read by Google</th><th class="r">Errors</th><th class="r">Warnings</th></tr></thead><tbody>${m.rows.map(r => `<tr><td class="u">${esc(r.path)}${r.isIndex ? ' <span class="tag">index</span>' : ''}</td><td>${esc(r.typeName)}</td><td class="r">${fmtN(r.submitted)}</td>${anyIdx ? `<td class="r">${idxOf(r) == null ? '—' : fmtN(idxOf(r))}</td>` : ''}<td>${r.lastDownloaded ? fmtD(r.lastDownloaded.slice(0, 10)) : '—'}</td><td class="r">${r.errors}</td><td class="r">${r.warnings}</td></tr>`).join('')}</tbody></table></div></details>` + upl;
  }
  function mapsMount(D) {
    const go = document.getElementById('un-maps-go');
    if (go) go.addEventListener('click', async () => {
      const src = window.CW_SOURCE; MAPS.set(D.site, { status: 'loading' }); rerender();
      try { const d = await src.gsc.sitemaps(); MAPS.set(D.site, { status: 'done', rows: U.sitemapTypes(d.sitemap || [], tools(D).typeOf), at: Date.now() }); }
      catch (e) { MAPS.set(D.site, { status: 'error', error: e.message }); }
      rerender();
    });
    const f = document.getElementById('un-idx-file');
    if (f) f.addEventListener('change', async () => { const file = f.files[0]; if (!file) return; try { const r = idxRows(await readSheet(file)); scd(D.site).idx = { name: file.name, map: r.map || null, error: r.error || '' }; } catch (e) { scd(D.site).idx = { name: file.name, error: e.message }; } rerender(); });
    const t = document.getElementById('un-idx-tpl');
    if (t) t.addEventListener('click', () => download('indexed-per-sitemap-template.csv', 'Sitemap,Indexed,Not indexed\nhttps://unstop.com/sitemap-internships.xml,18500,33500\n'));
  }


  // ════════════════════════════ URL CLUSTERS: BRANDED VS NON-BRANDED ════════════════════════════
  // With Search Console connected every cluster is queried on its own (page regex filter), so totals are
  // exact: all queries, branded only and non-branded only, plus the cluster's query list for ranking
  // buckets. Anonymised queries sit in the total but in neither split. Uploads and sample data fall back to
  // page totals × the branded share of query × page rows (marked as estimates).
  const CL = new Map(); // key → { status, done, total, models: Map, error, at }
  const clKey = D => [D.site, D.start, D.end, D.prevStart || '', D.scope || '', JSON.stringify(settings(D.site).sections || null)].join('|');
  const SECT = new Map(); // settings signature → sectioner (keeps its URL cache between renders)
  function sectioner(D) { const s = settings(D.site); const k = D.site + '|' + JSON.stringify([s.sections, s.rootArticles]); let f = SECT.get(k); if (!f) { f = U.makeSectioner(s.sections, { rootArticles: s.rootArticles }); if (SECT.size > 20) SECT.clear(); SECT.set(k, f); } return f; }
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
  async function loadScope(D, A, sc, key, ov) {
    const src = window.CW_SOURCE; if (!src || !src.gsc || !A.brandRx) return;
    FOC.set(key, { status: 'loading' }); rerender();
    try {
      const so = (ov && ov.so) || sectioner(D), s = settings(D.site), secList = (ov && ov.sections) || s.sections;
      let filters;
      if (sc.kind === 'page') filters = [{ dimension: 'page', operator: 'includingRegex', expression: '^https?://[^/]+' + sc.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?(\\?.*)?$' }];
      else {
        const sec = so.sections.find(x => x.id === sc.id);
        const rules = sc.kind === 'folder' ? sec.rules.filter(r => String(r).trim().replace(/^=/, '').replace(/\*$/, '…') === sc.folder) : sec.rules;
        filters = [{ dimension: 'page', operator: 'includingRegex', expression: U.sectionRegex({ id: sec.id, rules }, null) }];
        const ex = U.sectionExclude(sec, secList); if (ex) filters.push({ dimension: 'page', operator: 'excludingRegex', expression: ex });
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
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      if (res.ok) return res.json();
      const j = await res.json().catch(() => ({}));
      const msg = (j.error && j.error.message) || res.statusText;
      if ((res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt) + Math.random() * 800)); continue; }
      if (res.status === 401) { gaToken = null; try { sessionStorage.removeItem('un:ga-tok'); } catch (e) { } throw new Error('Your GA4 session expired. Connect GA4 again.'); }
      if (res.status === 403 && /has not been used|disabled/i.test(msg)) throw new Error('The Google Analytics Data API (and Admin API, for the property list) must be enabled in the Google Cloud project that owns this app’s OAuth client. ' + msg);
      if (res.status === 429) throw new Error('GA4 is rate-limiting this property right now (too many reports at once or the hourly quota). Reload GA4 in a few minutes. ' + msg);
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
    for (let off = lim; off < total && off < lim * 2; off += lim) { const d = await gaFetch(url, { ...body, offset: off }); rows = rows.concat(d.rows || []); }
    return { ...first, rows };
  }
  async function loadGa4(D, o) {
    const s = settings(D.site);
    const reqs = U.ga4Requests({ start: o.start, end: o.end, aiSources: s.aiSources, pricingPaths: s.pricingPaths, events: s.events });
    const keys = Object.keys(reqs), raw = {}, failed = [];
    const opt = new Set(keys.filter(k => reqs[k].optional)); keys.forEach(k => { delete reqs[k].optional; });
    let done = 0;
    const prog = document.getElementById('un-ga-prog');
    // GA4 allows about 10 requests at once per property: run 4 at a time, the reports every screen needs first
    const FIRST = ['landing', 'events', 'daily', 'device', 'region', 'landingDevice', 'landingRegion', 'eventsYoy', 'pricing', 'ai', 'assisted', 'channels', 'channelEvents'];
    keys.sort((a, b) => (FIRST.includes(a) ? FIRST.indexOf(a) : 99) - (FIRST.includes(b) ? FIRST.indexOf(b) : 99));
    // phase 1: what the dashboards show first; the screen renders as soon as these arrive
    const first = keys.filter(k => FIRST.includes(k) || k === 'aiMonthly'), rest = keys.filter(k => !first.includes(k));
    const run = async list => { const queue = list.slice(); const worker = async () => { while (queue.length) { const k = queue.shift(); try { raw[k] = await runReport(o.property, reqs[k]); } catch (e) { if (!opt.has(k)) failed.push(k + ': ' + e.message); } finally { done++; if (prog) prog.textContent = `Loading GA4 reports… ${done} of ${keys.length}`; } } }; await Promise.all([worker(), worker(), worker(), worker()]); };
    await run(first);
    if (!raw.landing && failed.length) throw new Error(failed[0].replace(/^\w+: /, ''));
    const entry = { raw, property: o.property, propertyName: o.propertyName || o.property, start: o.start, end: o.end, at: Date.now(), failed, sample: false, more: rest.length > 0 };
    GA.set(D.site, entry);
    // phase 2: engagement, cohorts and the rest load in the background and fill in when ready
    if (rest.length) run(rest).then(() => { if (GA.get(D.site) !== entry) return; entry.more = false; entry.model = null; entry.at = Date.now(); rerender(); });
  }
  // One sign-in for both: "Connect Search Console" already asks for GA4 access, so when this tab has that
  // token and a GA4 property is known (saved, in config.js, or the one Unstop property on the account),
  // GA4 loads by itself for the same dates as Search Console.
  const GAAUTO = new Map(); // site|start|end → 'loading' | 'done' | 'noprop' | 'error'
  async function gaAuto(D) {
    if (!(window.CW_SOURCE && window.CW_SOURCE.kind === 'api') || !D || !D.start || !D.end) return;
    const g = GA.get(D.site); if (g && !g.sample) return;
    if (!token()) return;
    const key = D.site + '|' + D.start + '|' + D.end; if (GAAUTO.has(key)) return;
    GAAUTO.set(key, 'loading'); rerender();
    const s = settings(D.site);
    let property = s.ga4Property, name = property ? 'Property ' + property : '';
    try {
      if (!property) {
        const list = await listProperties();
        const pick = list.find(p => /unstop/i.test(p.name + ' ' + p.account)) || (list.length === 1 ? list[0] : null);
        if (!pick) { GAAUTO.set(key, 'noprop'); rerender(); return; }
        property = pick.id; name = `${pick.name} (${pick.id})`; s.ga4Property = property; save(D.site, s);
      }
      await loadGa4(D, { property, propertyName: name, start: D.start, end: D.end });
      GAAUTO.set(key, 'done'); MSG.ga = '';
    } catch (e) { GAAUTO.set(key, 'error'); MSG.ga = 'GA4 did not load automatically: ' + e.message; }
    rerender();
  }
  const gaAutoState = D => GAAUTO.get(D.site + '|' + D.start + '|' + D.end);
  function gaModel(D) {
    const g = GA.get(D.site); if (!g) return null;
    const { typeOf, s } = tools(D);
    const sig = JSON.stringify([s.events, s.types, s.rootArticles, s.sections, s.pathSections]);
    if (!g.model || g.sig !== sig) { g.model = U.ga4Model(g.raw, typeOf, s.events, { start: g.start, end: g.end, sectionOf: sectioner(D), pathSections: s.pathSections || U.DEFAULT_PATH_SECTIONS }); g.sig = sig; }
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
        ${kp('Student signups', fmtN(M.ev.stu), dchip(U.chg(M.ev.stu, M.ev.yStu)), evSrc(M, s.events, ['studentSignup']))}
        ${kp('Employer signups', fmtN(M.ev.emp), dchip(U.chg(M.ev.emp, M.ev.yEmp)), evSrc(M, s.events, ['employerSignup']))}
        ${kp('Signup CVR', pct1(t.sessions ? (M.ev.stu + M.ev.emp) / t.sessions * 100 : null), '', 'signups ÷ sessions')}
        ${kp('Engagement rate', pct1(t.engRate), '', fmtN(t.pps ? +t.pps.toFixed(2) : null) + ' pages / session')}
        ${kp('Demo + contact (organic)', fmtN(M.ev.demo + M.ev.contact), dchip(U.chg(M.ev.demo + M.ev.contact, M.ev.yDemo + M.ev.yContact)), evSrc(M, s.events, ['demoRequest', 'contactSubmit']))}
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
  const STEP_LABEL = { oppClick: 'Click into an opportunity', studentSignup: 'Student signup', employerSignup: 'Employer signup', demoRequest: 'Demo request', contactSubmit: 'Contact submission', opportunityAction: 'Register / apply', productClick: 'Product click', scroll: 'Scroll' };
  // Which GA4 event names make up an event tile, so every number can be traced back to GA4.
  function evSrc(M, ev, keys) {
    const want = new Set(keys.flatMap(k => (ev && ev[k]) || []).map(x => String(x).toLowerCase()));
    const hit = (M.events || []).filter(e => want.has(String(e.name).toLowerCase()) && e.count > 0).sort((a, b) => b.count - a.count);
    if (!hit.length) return `<span class="un-src">no matching GA4 event · <a href="#funnelsetup">set event names</a></span>`;
    const list = hit.map(e => `${esc(e.name)} ${fmtN(e.count)}`).join(' + ');
    return `<span class="un-src">GA4 events: ${list}${hit.length > 1 ? ' <b class="un-warn">· ' + hit.length + ' events added up: if one signup fires more than one of these it is counted twice. Keep only one in <a href="#funnelsetup">Funnel setup</a>.</b>' : ''}</span>`;
  }
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
  // extra engagement reports for the sample (same shapes as GA4)
  function sampleEngagement(D, land, events, mk, R, ev) {
    const cur = land.filter(r => r.d[1] === 'cur'), yoy = land.filter(r => r.d[1] === 'yoy');
    const sum = (l, i) => l.reduce((a, r) => a + r.m[i], 0);
    const pv = cur.flatMap(r => { const y = yoy.find(x => x.d[0] === r.d[0]); return [{ d: [r.d[0], 'cur'], m: [r.m[3], r.m[1] * 1.1] }].concat(y ? [{ d: [r.d[0], 'yoy'], m: [y.m[3], y.m[1] * 1.1] }] : []); });
    const so = sectioner(D);
    const scrollP = cur.map(r => { const id = so(r.d[0]); const rate = id === 'blog' || id === 'resources' ? .48 : /hackathons|competitions|internships|jobs/.test(id) ? .36 : .27; return { d: [r.d[0]], m: [r.m[3] * rate * (.75 + R() * .5)] }; });
    const depth = cur.flatMap(r => { const id = so(r.d[0]), base = id === 'blog' ? .9 : .78; return [[25, base], [50, base * .72], [75, base * .55], [90, base * .4]].map(([d, f]) => ({ d: [r.d[0], String(d)], m: [r.m[3] * f * (.8 + R() * .3)] })); });
    const users = sum(cur, 1) * 1.15, yUsers = sum(yoy, 1) * 1.12;
    const evTot = name => events.filter(e => e.d[1] === name).reduce((a, e) => a + e.m[0], 0);
    const names = [...new Set(events.map(e => e.d[1]))];
    const eu = names.flatMap(n => [{ d: [n, 'cur'], m: [Math.min(users * .9, evTot(n) * .62), evTot(n)] }, { d: [n, 'yoy'], m: [Math.min(yUsers * .9, evTot(n) * .55), evTot(n) * .8] }]);
    const sessions = sum(cur, 0), ySessions = sum(yoy, 0);
    const blogs = cur.filter(r => ['blog', 'resources'].includes(so(r.d[0]))), dests = cur.filter(r => !['blog', 'resources', 'home', 'util', 'other'].includes(so(r.d[0]))).sort((a, b) => b.m[0] - a.m[0]).slice(0, 40);
    const bn = []; blogs.forEach((b, i) => { for (let j = 0; j < 4; j++) { const t = dests[(i * 3 + j * 7) % dests.length]; if (!t) continue; const v = b.m[3] * (.012 + R() * .02); bn.push({ d: [t.d[0], 'https://unstop.com' + b.d[0], 'cur'], m: [v] }, { d: [t.d[0], 'https://unstop.com' + b.d[0], 'yoy'], m: [v * (.7 + R() * .2)] }); } });
    const coh = (k) => ['w1', 'w2', 'w3', 'w4'].flatMap((c, i) => { const base = sessions * .14 * (1 + i * .03) * k; return [1, .21, .14, .11, .095].map((f, w) => ({ d: [c, String(w).padStart(4, '0')], m: [base * f * (w ? (k < 1 ? .85 : 1) : 1), base] })); });
    return {
      pageViews: mk(['pagePath'], ['screenPageViews', 'activeUsers'], pv, true),
      scrollPages: mk(['pagePath'], ['eventCount'], scrollP, false),
      scrollDepth: mk(['pagePath', 'customEvent:percent_scrolled'], ['eventCount'], depth, false),
      eventUsers: mk(['eventName'], ['totalUsers', 'eventCount'], eu, true),
      totals: mk([], ['totalUsers', 'activeUsers', 'sessions', 'engagedSessions', 'screenPageViews'], [{ d: ['cur'], m: [users, users * .97, sessions, sum(cur, 2), sum(cur, 3)] }, { d: ['yoy'], m: [yUsers, yUsers * .97, ySessions, sum(yoy, 2), sum(yoy, 3)] }], true),
      blogNext: mk(['pagePath', 'pageReferrer'], ['screenPageViews'], bn, true),
      cohorts: mk(['cohort', 'cohortNthWeek'], ['cohortActiveUsers', 'cohortTotalUsers'], coh(1), false),
      cohortsYoy: mk(['cohort', 'cohortNthWeek'], ['cohortActiveUsers', 'cohortTotalUsers'], coh(.9), false),
      assisted: mk(['firstUserDefaultChannelGroup', 'sessionDefaultChannelGroup', 'eventName'], ['eventCount'], [ev.demoRequest[0], ev.contactSubmit[0], ev.employerSignup[0]].filter(Boolean).flatMap((n, i) => { const base = evTot(n) || 20; return [['Organic Search', 'Organic Search', 1], ['Organic Search', 'Email', .22], ['Organic Search', 'Direct', .31], ['Organic Search', 'Paid Search', .08], ['Paid Search', 'Organic Search', .1], ['Direct', 'Direct', .6], ['Email', 'Email', .3], ['Paid Search', 'Paid Search', .7]].flatMap(([f, sc, k]) => [{ d: [f, sc, n, 'cur'], m: [base * k * (.85 + R() * .3)] }, { d: [f, sc, n, 'yoy'], m: [base * k * .75] }]); }), true)
    };
  }
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
      if (ev.oppClick && ev.oppClick[0] && p.type !== 'emp') e(ev.oppClick[0], p.type === 'opp' ? .22 : .08);
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
      ...sampleEngagement(D, land, events, mk, R, ev),
      aiMonthly: (() => { const aiP = pages.filter(p => /\/employers|saas-pricing/.test(p.path)).slice(0, 10).concat(pages.slice(0, 6)); const e = new Date((D.end || '2026-10-25') + 'T00:00:00Z'); const rows = []; for (let i = 15; i >= 0; i--) { const d = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - i, 1)); const ym = d.toISOString().slice(0, 7).replace('-', ''), g = Math.pow(1.13, 15 - i); [['chatgpt.com', 9], ['perplexity.ai', 2.4], ['gemini.google.com', 1.6], ['copilot.microsoft.com', .6], ['claude.ai', .4]].forEach(([src, w]) => aiP.forEach(p => { const v = w * g * (p.clicks / 400 + .3) * (.7 + R() * .6); if (v >= .5) rows.push({ d: [ym, src, p.path], m: [v, v * .6, v * .55, v * .04] }); })); } return mk(['yearMonth', 'sessionSource', 'landingPage'], ['sessions', 'newUsers', 'engagedSessions', 'keyEvents'], rows, false); })(),
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
    const a = window.UN_AUTH; if (a && a.token && a.exp > Date.now() + 30000) return a.token;
    return token();
  }
  function moeReady(c) { return c.mode === 'proxy' ? !!c.proxy : !!(c.workspace && moeKey()); }
  async function moeGet(c, path, fresh) {
    let url, headers = { Accept: 'application/json' };
    if (c.mode === 'proxy') {
      const t = googleTok();
      if (!t) throw new Error('Google sign-in is needed: press Load dashboards again and finish the Google pop-up with your unstop.com account. The proxy only answers people who can open Unstop’s Search Console or GA4.');
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
    if (ld) ld.addEventListener('click', () => { const s = settings(D.site), c = moeCfg(s); const d = $('un-moe-dash'); c.dashboard = d ? d.value.trim() : c.dashboard; s.moe = c; save(D.site, s);
      // no Google token in this tab yet: sign in from this click (keeps the pop-up allowed), then load
      if (c.mode === 'proxy' && !googleTok()) { signIn().then(() => moeLoad(D, { list: !c.dashboard }), e => { MSG.moe = e.message; rerender(); }); return; }
      moeLoad(D, { list: !c.dashboard }); });
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
    if (!CRM.has(D.site)) { const rows = sampleCrm(); CRM.set(D.site, { rows, res: U.crmModel(rows), name: 'Sample leads', at: Date.now(), sample: true }); }
  }

  // ════════════════════════════ USER ACQUISITION ════════════════════════════
  // Organic signups split student vs employer, conversion rate from organic landing pages, cost per signup
  // for each business, and signup quality against other channels (MoEngage). Shared by Full funnel.
  function acqModel(D) {
    const s = settings(D.site), g = GA.get(D.site), ga = gaModel(D);
    const out = { ga, g };
    if (ga) {
      const empT = ga.types.find(t => t.id === 'emp') || { sessions: 0, ySessions: 0 };
      const stuSes = ga.total.sessions - empT.sessions, yStuSes = ga.yoy ? ga.yoy.sessions - empT.ySessions : null;
      out.stu = ga.ev.stu; out.emp = ga.ev.emp; out.yStu = ga.ev.yStu; out.yEmp = ga.ev.yEmp;
      out.stuSes = stuSes; out.empSes = empT.sessions;
      out.cvrStu = stuSes ? ga.ev.stu / stuSes * 100 : null; out.yCvrStu = yStuSes ? ga.ev.yStu / yStuSes * 100 : null;
      out.cvrEmp = empT.sessions ? ga.ev.emp / empT.sessions * 100 : null; out.yCvrEmp = empT.ySessions ? ga.ev.yEmp / empT.ySessions * 100 : null;
      out.days = Math.round((new Date(g.end) - new Date(g.start)) / 864e5) + 1;
    }
    const sample = D.sampleOf === 'unstop';
    out.costSample = sample && !String(s.monthlyCost || '').trim();
    out.cost = out.costSample ? 450000 : parseFloat(String(s.monthlyCost || '').replace(/[^0-9.]/g, '')) || null;
    const sh = String(s.empCostShare == null ? '' : s.empCostShare).trim();
    out.shareSample = sample && !sh;
    out.empShare = out.shareSample ? 30 : sh !== '' && isFinite(+sh) ? Math.max(0, Math.min(100, +sh)) : null;
    if (ga && out.cost) {
      const per30 = n => n * 30 / out.days;
      if (out.empShare != null) {
        out.cpsStu = out.stu ? out.cost * (1 - out.empShare / 100) / per30(out.stu) : null;
        out.cpsEmp = out.emp ? out.cost * (out.empShare / 100) / per30(out.emp) : null;
      } else out.cpsAll = (out.stu + out.emp) ? out.cost / per30(out.stu + out.emp) : null;
    }
    // quality: MoEngage live mappings first (with their comparison rows), else the user export
    const ml = moeLive(D), m = MOE.get(D.site), res = m && m.res && m.res.ok ? m.res : null, pairs = {};
    let qsrc = null;
    ['profile', 'act7', 'ret30'].forEach(k => {
      const x = ml && ml.m[k];
      if (x && x.value != null && x.compare != null) { pairs[k] = { organic: x.value, other: x.compare }; qsrc = qsrc || ((MOELIVE.get(D.site) || {}).demo ? 'sample' : 'live'); }
      else if (res && res.seg.organic[k] && res.seg.other[k]) { pairs[k] = { organic: res.seg.organic[k].rate, other: res.seg.other[k].rate }; qsrc = qsrc || (m.sample ? 'sample' : 'file'); }
    });
    out.pairs = pairs; out.verdict = U.qualityVerdict(pairs); out.qsrc = qsrc; out.moe = res; out.moeName = m && m.name;
    out.moeSignups = ml && ml.m.moeSignups && ml.m.moeSignups.value != null ? ml.m.moeSignups.value : null;
    return out;
  }
  const QLABEL = { profile: 'Profile completion', act7: 'First registration or application within 7 days', ret30: '30-day retention' };

  V.acquisition = (A, D) => {
    demoFill(D);
    window.CW_LAST_A = A;
    Object.keys(TABLES).filter(k => k.startsWith('t-un-aq')).forEach(k => delete TABLES[k]);
    const s = settings(D.site), X = acqModel(D), ga = X.ga;
    const intro = head('User acquisition', 'Organic signups, signup conversion rate from organic landing pages and cost per organic signup, always split into students and employers / recruiters, plus signup quality against other channels. If organic users retain worse than other sources, volume alone does not count as a win.');
    const kp = (l, v, d, sub) => `<div class="un-kpi"><span>${esc(l)}</span><b>${v}</b><small>${d || ''} ${sub || ''}</small></div>`;
    const pts = (a, b) => a == null || b == null ? '' : `<span class="un-d ${a - b > 0 ? 'up' : a - b < 0 ? 'down' : 'flat'}">${a - b > 0 ? '+' : ''}${(a - b).toFixed(2)} pts</span>`;
    const rs = v => v == null ? '—' : '₹' + fmtN(Math.round(v));
    const costNote = !X.cost ? '<a href="#funnelsetup">Add the monthly SEO cost</a>' : X.empShare == null ? '<a href="#funnelsetup">Set the employer share of cost</a>' : `₹${fmtN(X.cost)} / month · ${X.empShare}% employer${X.costSample || X.shareSample ? ' (sample cost)' : ''}`;
    let html = intro + scopePicker(A, D);
    if (!ga) html += '<div class="note"><a href="#ga4">Connect GA4</a> for signups, conversion rates and cost per signup. Signup quality below works from MoEngage on its own.</div>';
    else html += (X.g.sample ? '<div class="note"><b>Sample numbers.</b> Connect GA4 and MoEngage for real data.</div>' : '') +
      `<h2 class="un-sub">Students</h2><div class="un-kpis">
        ${kp('Organic student signups', fmtN(Math.round(X.stu)), dchip(U.chg(X.stu, X.yStu)), 'vs last year')}
        ${kp('Student signup CVR', pct1(X.cvrStu), pts(X.cvrStu, X.yCvrStu), `of ${fmtN(Math.round(X.stuSes))} sessions on student-facing pages`)}
        ${kp('Cost per student signup', X.cpsStu != null ? rs(X.cpsStu) : X.cpsAll != null ? rs(X.cpsAll) + '*' : '—', '', X.cpsAll != null ? '* all signups; ' + costNote : costNote)}
        ${kp('Organic signups in MoEngage', X.moeSignups != null ? fmtN(Math.round(X.moeSignups)) : '—', '', X.moeSignups != null ? 'second source, not deduplicated with GA4' : '<a href="#quality">Map a MoEngage chart</a>')}
      </div>
      <h2 class="un-sub">Employers &amp; recruiters</h2><div class="un-kpis">
        ${kp('Organic employer signups', fmtN(Math.round(X.emp)), dchip(U.chg(X.emp, X.yEmp)), 'vs last year')}
        ${kp('Employer signup CVR', pct1(X.cvrEmp), pts(X.cvrEmp, X.yCvrEmp), `of ${fmtN(Math.round(X.empSes))} sessions on employer-facing pages`)}
        ${kp('Cost per employer signup', X.cpsEmp != null ? rs(X.cpsEmp) : '—', '', costNote)}
        ${kp('Demo + contact (organic)', fmtN(Math.round(ga.ev.demo + ga.ev.contact)), dchip(U.chg(ga.ev.demo + ga.ev.contact, ga.ev.yDemo + ga.ev.yContact)), 'leads, see Full funnel')}
      </div>`;
    // quality verdict
    const V0 = X.verdict;
    html += `<section class="panel un-verdict ${V0 ? (V0.ok ? 'ok' : 'bad') : ''}"><div class="panel-h"><h2>Signup quality: organic vs other channels ${X.qsrc ? chip(X.qsrc) : chip('none')}</h2><p>${V0 ? (V0.ok ? '<b>Organic signups are at least as good as other channels on every quality measure, so volume growth counts.</b>' : `<b>Organic is worse on ${V0.worse} of ${V0.rows.length} quality measure${V0.rows.length === 1 ? '' : 's'}. Signup volume alone does not count as a win until this closes.</b>`) : 'Connect MoEngage (live dashboard or user export) on <a href="#quality">Signup quality</a> to compare organic signups with other channels.'}</p></div>
      ${V0 ? `<div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Measure</th><th class="r">Organic</th><th class="r">Other channels</th><th class="r">Gap</th><th>Verdict</th></tr></thead><tbody>${V0.rows.map(r => `<tr><td><b>${esc(QLABEL[r.k])}</b></td><td class="r">${pct1(r.organic)}</td><td class="r">${pct1(r.other)}</td><td class="r">${pts(r.organic, r.other)}</td><td>${r.state === 'worse' ? '<span class="un-st bad">Worse</span>' : r.state === 'better' ? '<span class="un-st live">Better</span>' : '<span class="un-st none">Level</span>'}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      ${X.moe ? `<div class="panel-b"><h3 class="un-sub">Students vs employers (${esc(X.moeName || 'MoEngage export')})</h3><div class="tw"><table class="un-mini"><thead><tr><th>Segment</th><th class="r">Signups</th><th class="r">Profile complete</th><th class="r">7-day activation</th><th class="r">30-day retention</th></tr></thead><tbody>${[['Organic students', 'orgStudent'], ['Other channels: students', 'othStudent'], ['Organic employers / recruiters', 'orgEmployer'], ['Other channels: employers / recruiters', 'othEmployer']].map(([l, k]) => { const x = X.moe.seg[k]; const r = v => v ? pct1(v.rate) : '—'; return `<tr><td><b>${esc(l)}</b></td><td class="r">${fmtN(x.users)}</td><td class="r">${r(x.profile)}</td><td class="r">${r(x.act7)}</td><td class="r">${r(x.ret30)}</td></tr>`; }).join('')}</tbody></table></div>
        ${ga && X.moe.seg.organic.ret30 ? `<p class="hint">Retained organic signups (signups × organic 30-day retention): about <b>${fmtN(Math.round(X.stu * X.moe.seg.orgStudent.ret30.rate / 100 || 0))}</b> students and <b>${fmtN(Math.round(X.emp * ((X.moe.seg.orgEmployer.ret30 || {}).rate || 0) / 100))}</b> employers still active after 30 days. Track this next to raw volume.</p>` : ''}
        <p class="hint">Monthly cohorts and acquisition sources: <a href="#quality">Signup quality</a>.</p></div>` : ''}
    </section>`;
    if (ga) {
      // by page type / cluster / folder, students and employers separately
      const so = sectioner(D);
      const grp = keyFn => { const m = new Map(); ga.pages.forEach(p => { const k = keyFn(p); const o = m.get(k.id) || { ...k, sessions: 0, ySessions: 0, stu: 0, emp: 0 }; o.sessions += p.sessions; o.ySessions += p.ySessions; o.stu += p.stu; o.emp += p.emp; m.set(k.id, o); }); return [...m.values()].map(o => ({ ...o, signups: o.stu + o.emp, cvr: o.sessions ? (o.stu + o.emp) / o.sessions * 100 : null, cvrStu: o.sessions ? o.stu / o.sessions * 100 : null, cvrEmp: o.sessions ? o.emp / o.sessions * 100 : null, dSessions: U.chg(o.sessions, o.ySessions) })).filter(o => o.sessions > 0 || o.signups > 0); };
      const cols = first => first.concat([
        { k: 'sessions', l: 'Organic sessions', r: 1, f: r => fmtN(Math.round(r.sessions)) + ' ' + dchip(r.dSessions) },
        { k: 'stu', l: 'Student signups', r: 1, f: r => fmtN(Math.round(r.stu)) }, { k: 'cvrStu', l: 'Student CVR', r: 1, f: r => pct1(r.cvrStu) },
        { k: 'emp', l: 'Employer signups', r: 1, f: r => fmtN(Math.round(r.emp)) }, { k: 'cvrEmp', l: 'Employer CVR', r: 1, f: r => pct1(r.cvrEmp) },
        { k: 'cvr', l: 'All signups CVR', r: 1, f: r => pct1(r.cvr) }]);
      const tabs = [['cluster', 'By cluster'], ['folder', 'By folder'], ['type', 'By page type'], ['page', 'By landing page']];
      const tab = fParams().get('by') || 'cluster';
      let tbl;
      if (tab === 'type') tbl = table('t-un-aqt', cols([{ k: 'name', l: 'Page type', f: r => `<b>${esc(r.name)}</b>` }]), grp(p => ({ id: p.type, name: p.typeName })), { search: false, sort: 'signups', file: 'unstop-signups-by-page-type', pageSize: 30 });
      else if (tab === 'folder') tbl = table('t-un-aqt', cols([{ k: 'cluster', l: 'Cluster', f: r => `<b>${esc(r.cluster)}</b>` }, { k: 'folder', l: 'Folder', f: r => `<code>${esc(r.folder)}</code>`, csv: r => r.folder }]), grp(p => { const id = so(p.path), f = so.folderOf(p.path); return { id: id + '|' + f, cluster: so.label(id), folder: f }; }), { sort: 'signups', file: 'unstop-signups-by-folder', pageSize: 40, searchKeys: ['cluster', 'folder'], placeholder: 'Filter clusters or folders', filters: [clusterFilter(D)] });
      else if (tab === 'page') tbl = table('t-un-aqt', cols([{ k: 'path', l: 'Landing page', cls: 'u', f: r => `<a href="${esc(focusHref({ u: r.path }))}">${esc(r.path)}</a>`, csv: r => r.path }, { k: 'cluster', l: 'Cluster' }]), withCluster(D, grp(p => ({ id: p.path, path: p.path })), r => r.path), { sort: 'signups', file: 'unstop-signups-by-landing-page', pageSize: 25, searchKeys: ['path', 'cluster'], placeholder: 'Filter URLs', filters: [clusterFilter(D)] });
      else tbl = table('t-un-aqt', cols([{ k: 'name', l: 'Cluster', f: r => `<a href="${esc(focusHref({ c: r.id }))}"><b>${esc(r.name)}</b></a>`, csv: r => r.name }]), grp(p => { const id = so(p.path); return { id, name: so.label(id) }; }), { search: false, sort: 'signups', file: 'unstop-signups-by-cluster', pageSize: 30 });
      html += `<section class="panel"><div class="panel-h"><h2>Signups and conversion rate from organic landing pages</h2><p>Events counted in organic sessions, credited to the page the session landed on.</p></div>
        <div class="panel-b"><div class="un-tabs" role="tablist">${tabs.map(([k, l]) => `<a role="tab" class="${k === tab ? 'on' : ''}" href="#acquisition?by=${k}">${l}</a>`).join('')}</div></div>${tbl}</section>`;
      html += `<section class="panel"><div class="panel-h"><h2>Organic vs other channels</h2><p>Same dates and event lists across every GA4 channel.</p></div>
        ${table('t-un-aqc', [{ k: 'channel', l: 'Channel', f: r => r.channel === 'Organic Search' ? `<b>${esc(r.channel)}</b>` : esc(r.channel) }, { k: 'sessions', l: 'Sessions', r: 1, f: r => fmtN(Math.round(r.sessions)) },
          { k: 'stu', l: 'Student signups', r: 1, f: r => fmtN(Math.round(r.stu)) }, { k: 'emp', l: 'Employer signups', r: 1, f: r => fmtN(Math.round(r.emp)) },
          { k: 'cvr', l: 'Signup CVR', r: 1, f: r => pct1(r.cvr) }, { k: 'engRate', l: 'Engagement rate', r: 1, f: r => pct1(r.engRate) }], ga.channels, { search: false, file: 'unstop-signups-by-channel', pageSize: 20 })}</section>`;
    }
    const mount = () => { scopeMount(D); ['t-un-aqt', 't-un-aqc'].forEach(drawTable); moeAuto(D); };
    return { html, mount };
  };

  // ════════════════════════════ ENGAGEMENT ════════════════════════════
  function engModel(D) {
    const g = GA.get(D.site), M = gaModel(D); if (!g || !M) return null;
    const s = settings(D.site), sig = JSON.stringify([s.events, s.sections, s.keyPages, g.at]);
    if (!g.eng || g.engSig !== sig) { g.eng = U.engagementModel(g.raw, M, sectioner(D), s.events, { keyPages: s.keyPages || [] }); g.engSig = sig; }
    return g.eng;
  }
  V.engagement = (A, D) => {
    demoFill(D);
    window.CW_LAST_A = A;
    Object.keys(TABLES).filter(k => k.startsWith('t-un-en')).forEach(k => delete TABLES[k]);
    const g = GA.get(D.site), M = gaModel(D), E = engModel(D), s = settings(D.site);
    const intro = head('Engagement', 'Engaged sessions, scroll depth on key pages, pages per session, return visits within 30 days and the share of organic visitors who click into an opportunity, register or apply. For blog and guide pages, the clicks from the content into product pages.');
    if (!g || !M || !E) return { html: intro + scopePicker(A, D) + '<div class="note"><a href="#ga4">Connect GA4</a> to see engagement.</div>', mount: () => scopeMount(D) };
    const kp = (l, v, d, sub) => `<div class="un-kpi"><span>${esc(l)}</span><b>${v}</b><small>${d || ''} ${sub || ''}</small></div>`;
    const pts = (a, b) => a == null || b == null ? '' : `<span class="un-d ${a - b > 0 ? 'up' : a - b < 0 ? 'down' : 'flat'}">${a - b > 0 ? '+' : ''}${(a - b).toFixed(1)} pts</span>`;
    const keyScroll = E.key.length ? E.key.reduce((a, p) => a + p.scroll, 0) / Math.max(1, E.key.reduce((a, p) => a + p.views, 0)) * 100 : null;
    const w4 = E.ret ? E.ret.weeks[3].rate : null, yw4 = E.yRet ? E.yRet.weeks[3].rate : null;
    const A1 = E.actions;
    const evs = k => (s.events[k] || []).join(', ') || 'none set';
    let html = intro + scopePicker(A, D) + (g.sample ? '<div class="note"><b>Sample numbers.</b> Connect GA4 for real data.</div>' : '') +
      `<div class="un-kpis">
        ${kp('Engaged sessions', fmtN(Math.round(E.engaged)), dchip(E.dEngaged), 'vs last year')}
        ${kp('Engagement rate', pct1(E.engRate), pts(E.engRate, E.yEngRate), 'vs last year')}
        ${kp('Pages per session', E.pps ? E.pps.toFixed(2) : '—', E.pps && E.yPps ? dchip(U.chg(E.pps, E.yPps)) : '', 'vs last year')}
        ${kp('Scroll depth on key pages', pct1(keyScroll), '', `of views reach 90% (scroll events) · ${E.key.length} key pages`)}
        ${kp('Return within 30 days', pct1(w4), pts(w4, yw4), E.ret ? `active in week 4 · week 1: ${pct1(E.ret.weeks[0].rate)}` : 'needs GA4 cohort data')}
        ${kp('Click into an opportunity', A1.oppClick && A1.oppClick.share != null ? pct1(A1.oppClick.share) : '—', A1.oppClick && A1.yOppClick && A1.yOppClick.share != null ? pts(A1.oppClick.share, A1.yOppClick.share) : '', 'of organic users')}
        ${kp('Register or apply', A1.opp && A1.opp.share != null ? pct1(A1.opp.share) : '—', A1.opp && A1.yOpp && A1.yOpp.share != null ? pts(A1.opp.share, A1.yOpp.share) : '', 'of organic users')}
        ${kp('Blog → product click-through', pct1(E.blog.rate), pts(E.blog.rate, E.blog.yRate), `${fmtN(Math.round(E.blog.toProduct))} product page views from blog`)}
      </div>`;
    // by cluster / folder / page type / landing page
    const so = sectioner(D);
    const grp = keyFn => { const m = new Map(); M.pages.forEach(p => { const k = keyFn(p); const o = m.get(k.id) || { ...k, sessions: 0, ySessions: 0, engaged: 0, views: 0, opp: 0, prodClick: 0, scroll: 0 }; ['sessions', 'ySessions', 'engaged', 'views', 'opp', 'prodClick', 'scroll'].forEach(x => { o[x] += p[x] || 0; }); m.set(k.id, o); }); return [...m.values()].filter(o => o.sessions > 0).map(o => ({ ...o, engRate: o.engaged / o.sessions * 100, pps: o.views / o.sessions, oppRate: o.opp / o.sessions * 100, prodRate: o.prodClick / o.sessions * 100, dSessions: U.chg(o.sessions, o.ySessions) })); };
    const cols = first => first.concat([
      { k: 'sessions', l: 'Organic sessions', r: 1, f: r => fmtN(Math.round(r.sessions)) + ' ' + dchip(r.dSessions) },
      { k: 'engaged', l: 'Engaged sessions', r: 1, f: r => fmtN(Math.round(r.engaged)) }, { k: 'engRate', l: 'Eng. rate', r: 1, f: r => pct1(r.engRate) },
      { k: 'pps', l: 'Pages / session', r: 1, f: r => r.pps.toFixed(2) },
      { k: 'oppRate', l: 'Register / apply per 100 sessions', r: 1, f: r => r.oppRate.toFixed(1) }, { k: 'prodRate', l: 'Product clicks per 100 sessions', r: 1, f: r => r.prodRate.toFixed(1) }]);
    const tabs = [['cluster', 'By cluster'], ['folder', 'By folder'], ['type', 'By page type'], ['page', 'By landing page']];
    const tab = fParams().get('by') || 'cluster';
    let tbl;
    if (tab === 'type') tbl = table('t-un-ent', cols([{ k: 'name', l: 'Page type', f: r => `<b>${esc(r.name)}</b>` }]), grp(p => ({ id: p.type, name: p.typeName })), { search: false, sort: 'sessions', file: 'unstop-engagement-by-page-type', pageSize: 30 });
    else if (tab === 'folder') tbl = table('t-un-ent', cols([{ k: 'cluster', l: 'Cluster', f: r => `<b>${esc(r.cluster)}</b>` }, { k: 'folder', l: 'Folder', f: r => `<code>${esc(r.folder)}</code>`, csv: r => r.folder }]), grp(p => { const id = so(p.path), f = so.folderOf(p.path); return { id: id + '|' + f, cluster: so.label(id), folder: f }; }), { sort: 'sessions', file: 'unstop-engagement-by-folder', pageSize: 40, searchKeys: ['cluster', 'folder'], placeholder: 'Filter clusters or folders', filters: [clusterFilter(D)] });
    else if (tab === 'page') tbl = table('t-un-ent', cols([{ k: 'path', l: 'Landing page', cls: 'u', f: r => `<a href="${esc(focusHref({ u: r.path }))}">${esc(r.path)}</a>`, csv: r => r.path }, { k: 'cluster', l: 'Cluster' }]), withCluster(D, grp(p => ({ id: p.path, path: p.path })), r => r.path), { sort: 'sessions', file: 'unstop-engagement-by-landing-page', pageSize: 25, searchKeys: ['path', 'cluster'], placeholder: 'Filter URLs', filters: [clusterFilter(D)] });
    else tbl = table('t-un-ent', cols([{ k: 'name', l: 'Cluster', f: r => `<a href="${esc(focusHref({ c: r.id }))}"><b>${esc(r.name)}</b></a>`, csv: r => r.name }]), grp(p => { const id = so(p.path); return { id, name: so.label(id) }; }), { search: false, sort: 'sessions', file: 'unstop-engagement-by-cluster', pageSize: 30 });
    html += `<section class="panel"><div class="panel-h"><h2>Engagement by section</h2><p>Organic sessions credited to the page they landed on.</p></div><div class="panel-b"><div class="un-tabs" role="tablist">${tabs.map(([k, l]) => `<a role="tab" class="${k === tab ? 'on' : ''}" href="#engagement?by=${k}">${l}</a>`).join('')}</div></div>${tbl}</section>`;
    // scroll depth on key pages
    const dcols = E.depths.length ? E.depths.map(d => ({ k: 'd' + d, l: `Reached ${d}%`, r: 1, f: r => pct1(r.depthPct[d]), csv: r => r.depthPct[d] })) : [];
    html += `<section class="panel"><div class="panel-h"><h2>Scroll depth on key pages</h2><p>${(s.keyPages || []).length ? 'Key pages from Funnel setup.' : 'The 25 most viewed organic pages (choose your own in Funnel setup).'} GA4 enhanced measurement sends one scroll event at 90%, so “Reached 90%” = scroll events ÷ views. ${E.depths.length ? 'Depth thresholds come from the percent_scrolled custom dimension.' : 'For 25 / 50 / 75% thresholds, send scroll events with a percent_scrolled parameter from GTM and register it as an event-scoped custom dimension; the columns appear by themselves.'} Scroll events counted: ${esc(evs('scroll'))}.</p></div>
      ${table('t-un-ens', [{ k: 'path', l: 'Page', cls: 'u', f: r => `<a href="${esc(focusHref({ u: r.path }))}">${esc(r.path)}</a>`, csv: r => r.path }, { k: 'cluster', l: 'Cluster' }, { k: 'views', l: 'Views', r: 1, f: r => fmtN(Math.round(r.views)) + ' ' + dchip(r.dViews) }].concat(dcols).concat(E.depths.includes(90) ? [] : [{ k: 'scrollRate', l: 'Reached 90%', r: 1, f: r => pct1(r.scrollRate) }]), E.key, { search: false, sort: 'views', file: 'unstop-scroll-depth-key-pages', pageSize: 25 })}</section>`;
    // return visits
    const rr = (x, w) => x ? pct1(x.weeks[w - 1].rate) : '—';
    html += `<div class="grid-2 even"><section class="panel"><div class="panel-h"><h2>Return visits within 30 days</h2><p>New organic users grouped by the week of their first visit (the 4 complete weeks ending 28 days before the period end), and the share active again in each of the next 4 weeks. GA4 cohorts count users per week, so week 4 is the closest standard figure to “still returning after 30 days”.</p></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th></th><th class="r">New organic users</th><th class="r">Week 1</th><th class="r">Week 2</th><th class="r">Week 3</th><th class="r">Week 4</th></tr></thead><tbody>
        <tr><td><b>This year</b></td><td class="r">${E.ret ? fmtN(E.ret.users) : '—'}</td>${[1, 2, 3, 4].map(w => `<td class="r">${rr(E.ret, w)}</td>`).join('')}</tr>
        <tr><td>Same weeks last year</td><td class="r">${E.yRet ? fmtN(E.yRet.users) : '—'}</td>${[1, 2, 3, 4].map(w => `<td class="r">${rr(E.yRet, w)}</td>`).join('')}</tr>
      </tbody></table></div></div></section>
      <section class="panel"><div class="panel-h"><h2>Click into an opportunity, register or apply</h2><p>Organic users who fired the event ÷ all organic users. Events are set in Funnel setup.</p></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Action</th><th>Events counted</th><th class="r">Users</th><th class="r">Share of organic users</th><th class="r">Last year</th></tr></thead><tbody>
        <tr><td><b>Click into an opportunity</b></td><td><small>${esc(evs('oppClick'))}</small></td><td class="r">${A1.oppClick ? fmtN(A1.oppClick.users) : '—'}</td><td class="r">${A1.oppClick && A1.oppClick.share != null ? pct1(A1.oppClick.share) : '—'}</td><td class="r">${A1.yOppClick && A1.yOppClick.share != null ? pct1(A1.yOppClick.share) : '—'}</td></tr>
        <tr><td><b>Register or apply</b></td><td><small>${esc(evs('opportunityAction'))}</small></td><td class="r">${A1.opp ? fmtN(A1.opp.users) : '—'}</td><td class="r">${A1.opp && A1.opp.share != null ? pct1(A1.opp.share) : '—'}</td><td class="r">${A1.yOpp && A1.yOpp.share != null ? pct1(A1.yOpp.share) : '—'}</td></tr>
      </tbody></table></div><p class="hint" style="padding:0 16px 12px">${E.users ? fmtN(E.users) + ' organic users in the period. ' : ''}When several event names count for one action, the one with the most users is used (GA4 cannot de-duplicate users across events in this report).</p></div></section></div>`;
    // blog → product
    const B = E.blog;
    html += `<section class="panel"><div class="panel-h"><h2>Blog &amp; guides → product pages</h2><p>Page views of product pages (opportunities, employer pages, practice…) whose referrer is a blog or guide page, in organic sessions. This is the job of the content: send readers into the product.</p></div>
      <div class="panel-b"><div class="un-big"><b>${pct1(B.rate)}</b><span>blog → product click-through · ${fmtN(Math.round(B.toProduct))} product page views from ${fmtN(Math.round(B.blogViews))} blog and guide views${B.yRate != null ? ` · ${pct1(B.yRate)} last year` : ''} · ${fmtN(Math.round(B.events))} product-click events (${esc(evs('productClick'))})</span></div></div>
      <div class="grid-2 even"><div>${table('t-un-enbd', [{ k: 'cluster', l: 'Product destination', f: r => `<b>${esc(r.cluster)}</b>` }, { k: 'views', l: 'Views from blog', r: 1, f: r => fmtN(Math.round(r.views)) }], B.dest, { search: false, file: 'unstop-blog-to-product-destinations', pageSize: 15 })}</div>
      <div>${table('t-un-enbs', [{ k: 'path', l: 'Blog / guide page', cls: 'u', f: r => `<a href="${esc(focusHref({ u: r.path }))}">${esc(r.path)}</a>`, csv: r => r.path }, { k: 'views', l: 'Product views sent', r: 1, f: r => fmtN(Math.round(r.views)) }, { k: 'rate', l: 'Click-through', r: 1, f: r => pct1(r.rate) }], B.src, { file: 'unstop-blog-to-product-sources', pageSize: 15, placeholder: 'Filter blog URLs' })}</div></div></section>`;
    const mount = () => { scopeMount(D); ['t-un-ent', 't-un-ens', 't-un-enbd', 't-un-enbs'].forEach(drawTable); };
    return { html, mount };
  };

  // ════════════════════════════ LEADS & REVENUE ════════════════════════════
  // GA4: employer demo / contact / pricing and assisted conversions. CRM export (tab memory only):
  // MQLs, pipeline and revenue with organic first touch and organic in the journey, rates vs other channels.
  const CRM = new Map(); // site → { rows, res, name, at, sample }
  const inr = v => v == null || !isFinite(v) ? '—' : v >= 1e7 ? '₹' + (v / 1e7).toFixed(2) + ' Cr' : v >= 1e5 ? '₹' + (v / 1e5).toFixed(1) + ' L' : '₹' + fmtN(Math.round(v));
  function assistedOf(D) { const g = GA.get(D.site); if (!g || !g.raw || !g.raw.assisted) return null; const s = settings(D.site); const sig = JSON.stringify(s.events) + g.at; if (!g.asst || g.asstSig !== sig) { g.asst = U.assistedModel(g.raw, s.events); g.asstSig = sig; } return g.asst.ok ? g.asst : null; }
  function sampleCrm() {
    let seed = 23; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const rows = [['Record ID', 'Create Date', 'Original Source', 'All touches', 'First page seen', 'Lifecycle Stage', 'Deal amount', 'Deal stage']];
    const src = [['Organic Search', .3], ['Paid Search', .24], ['Direct Traffic', .14], ['Email Marketing', .1], ['Referrals', .08], ['Social Media', .06], ['Offline Sources', .08]];
    const pages = ['/employers', '/employers/ats-software', '/employers/online-assessment-platform', '/employers/hackathon-hiring', '/employers/campus-hiring', '/saas-pricing', '/employers/hire-interns', '/employers/ai-interview'];
    const end = Date.now() - 3 * 864e5;
    for (let i = 0; i < 900; i++) {
      let x = R(), k = 0; while (k < src.length - 1 && x > src[k][1]) { x -= src[k][1]; k++; }
      const s = src[k][0], org = s === 'Organic Search';
      const touches = [s]; if (R() < .45) touches.push(['Email Marketing', 'Direct Traffic', 'Organic Search', 'Paid Search'][Math.floor(R() * 4)]); if (!org && R() < .18) touches.splice(1, 0, 'Organic Search');
      const mql = R() < (org ? .46 : s === 'Paid Search' ? .32 : .38), opp = mql && R() < (org ? .34 : .27), won = opp && R() < (org ? .45 : .36);
      const amt = opp ? Math.round((150000 + R() * 900000) / 1000) * 1000 : '';
      const d = new Date(end - Math.floor(R() * 180) * 864e5).toISOString().slice(0, 10);
      rows.push(['L' + (10000 + i), d, s, touches.join(' > '), org || R() < .4 ? 'https://unstop.com' + pages[Math.floor(R() * pages.length)] : '', won ? 'Customer' : opp ? 'Opportunity' : mql ? 'Marketing Qualified Lead' : 'Lead', amt, won ? 'Closed Won' : opp ? (R() < .4 ? 'Closed Lost' : 'Proposal') : '']);
    }
    return rows;
  }
  function crmOf(D) { const c = CRM.get(D.site); return c && c.res && c.res.ok ? c : null; }
  V.leads = (A, D) => {
    demoFill(D);
    window.CW_LAST_A = A;
    Object.keys(TABLES).filter(k => k.startsWith('t-un-ld')).forEach(k => delete TABLES[k]);
    const g = GA.get(D.site), M = gaModel(D), AS = assistedOf(D), c = CRM.get(D.site), C = c && c.res && c.res.ok ? c.res : null, s = settings(D.site);
    const intro = head('Leads & revenue', 'Employer side: organic demo requests, contact submissions, pricing-page visits and MQLs, then pipeline and revenue with organic as first touch and as part of the journey, lead → opportunity and lead → close against other channels, and assisted conversions where SEO started a journey that closed through email or direct.');
    const kp = (l, v, d, sub) => `<div class="un-kpi"><span>${esc(l)}</span><b>${v}</b><small>${d || ''} ${sub || ''}</small></div>`;
    const pts = (a, b) => a == null || b == null ? '' : `<span class="un-d ${a - b > 0 ? 'up' : a - b < 0 ? 'down' : 'flat'}">${a - b > 0 ? '+' : ''}${(a - b).toFixed(1)} pts</span>`;
    let html = intro + scopePicker(A, D);
    // ── GA4 ──
    if (!M) html += '<div class="note"><a href="#ga4">Connect GA4</a> for demo requests, contact submissions, pricing visits and assisted conversions.</div>';
    else {
      const so = sectioner(D);
      html += `<h2 class="un-sub">Employer actions from organic (GA4)${g.sample ? ' <span class="un-st sample">Sample</span>' : ''}</h2><div class="un-kpis">
        ${kp('Demo requests', fmtN(Math.round(M.ev.demo)), dchip(U.chg(M.ev.demo, M.ev.yDemo)), 'vs last year')}
        ${kp('Contact submissions', fmtN(Math.round(M.ev.contact)), dchip(U.chg(M.ev.contact, M.ev.yContact)), 'vs last year')}
        ${kp('Pricing-page sessions', fmtN(Math.round(M.pricing.sessions)), dchip(U.chg(M.pricing.sessions, M.pricing.ySessions)), 'vs last year')}
        ${kp('Employer signups', fmtN(Math.round(M.ev.emp)), dchip(U.chg(M.ev.emp, M.ev.yEmp)), 'vs last year')}
      </div>`;
      // assisted
      if (AS) {
        const a = AS.cur, y = AS.yoy;
        html += `<section class="panel"><div class="panel-h"><h2>Assisted conversions: SEO starts, another channel closes</h2><p>Demo requests, contact submissions and employer signups split by the channel that first brought the user (GA4 first user channel) and the channel of the session where they converted.</p></div><div class="panel-b"><div class="un-kpis">
          ${kp('Converted in an organic session', fmtN(Math.round(a.lastOrganic.total)), dchip(U.chg(a.lastOrganic.total, y.lastOrganic.total)), 'last touch organic')}
          ${kp('Started by organic, closed elsewhere', fmtN(Math.round(a.assisted.total)), dchip(U.chg(a.assisted.total, y.assisted.total)), 'assisted by SEO')}
          ${kp('All conversions first brought by organic', fmtN(Math.round(a.organicAll.total)), dchip(U.chg(a.organicAll.total, y.organicAll.total)), a.all.total ? pct1(a.organicAll.total / a.all.total * 100) + ' of all employer conversions' : '')}
          ${kp('Organic-started, credited elsewhere', a.organicAll.total ? pct1(a.assisted.total / a.organicAll.total * 100) : '—', '', 'what last-click reporting hides from SEO')}
        </div></div>
        <div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Closing channel (first visit was organic)</th><th class="r">Demo requests</th><th class="r">Contact</th><th class="r">Employer signups</th><th class="r">Total</th></tr></thead><tbody>${a.byCloser.map(r => `<tr><td><b>${esc(r.channel)}</b></td><td class="r">${fmtN(Math.round(r.demo))}</td><td class="r">${fmtN(Math.round(r.contact))}</td><td class="r">${fmtN(Math.round(r.empSignup))}</td><td class="r">${fmtN(Math.round(r.total))}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">None in this period.</td></tr>'}</tbody></table></div></div></section>`;
      } else html += '<div class="note">Assisted conversions need the GA4 “assisted” report. Reload GA4 on the GA4 screen.</div>';
      // employer actions by cluster / folder / landing page
      const grp = keyFn => { const m = new Map(); M.pages.forEach(p => { if (!(p.demo + p.contact + p.emp) && p.type !== 'emp') return; const k = keyFn(p); const o = m.get(k.id) || { ...k, sessions: 0, ySessions: 0, demo: 0, contact: 0, emp: 0 }; o.sessions += p.sessions; o.ySessions += p.ySessions; o.demo += p.demo; o.contact += p.contact; o.emp += p.emp; m.set(k.id, o); }); return [...m.values()].map(o => ({ ...o, leads: o.demo + o.contact, rate: o.sessions ? (o.demo + o.contact) / o.sessions * 100 : null, dSessions: U.chg(o.sessions, o.ySessions) })).filter(o => o.sessions > 0 || o.leads > 0); };
      const cols = first => first.concat([{ k: 'sessions', l: 'Organic sessions', r: 1, f: r => fmtN(Math.round(r.sessions)) + ' ' + dchip(r.dSessions) }, { k: 'demo', l: 'Demo requests', r: 1, f: r => fmtN(Math.round(r.demo)) }, { k: 'contact', l: 'Contact', r: 1, f: r => fmtN(Math.round(r.contact)) }, { k: 'emp', l: 'Employer signups', r: 1, f: r => fmtN(Math.round(r.emp)) }, { k: 'rate', l: 'Leads per 100 sessions', r: 1, f: r => r.rate == null ? '—' : r.rate.toFixed(2) }]);
      const tab = fParams().get('by') || 'cluster';
      const tbl = tab === 'page' ? table('t-un-ldp', cols([{ k: 'path', l: 'Landing page', cls: 'u', f: r => `<a href="${esc(focusHref({ u: r.path }))}">${esc(r.path)}</a>`, csv: r => r.path }, { k: 'cluster', l: 'Cluster' }]), withCluster(D, grp(p => ({ id: p.path, path: p.path })), r => r.path), { sort: 'leads', file: 'unstop-employer-leads-by-page', pageSize: 20, searchKeys: ['path'], placeholder: 'Filter URLs' })
        : tab === 'folder' ? table('t-un-ldp', cols([{ k: 'cluster', l: 'Cluster', f: r => `<b>${esc(r.cluster)}</b>` }, { k: 'folder', l: 'Folder', f: r => `<code>${esc(r.folder)}</code>`, csv: r => r.folder }]), grp(p => { const id = so(p.path), f = so.folderOf(p.path); return { id: id + '|' + f, cluster: so.label(id), folder: f }; }), { search: false, sort: 'leads', file: 'unstop-employer-leads-by-folder', pageSize: 30 })
          : table('t-un-ldp', cols([{ k: 'name', l: 'Cluster', f: r => `<b>${esc(r.name)}</b>` }]), grp(p => { const id = so(p.path); return { id, name: so.label(id) }; }), { search: false, sort: 'leads', file: 'unstop-employer-leads-by-cluster', pageSize: 30 });
      html += `<section class="panel"><div class="panel-h"><h2>Where organic employer leads land</h2><p>Organic sessions on employer pages and any page that produced a demo, contact or employer signup. Pricing pages: ${esc(s.pricingPaths.join(', '))}.</p></div><div class="panel-b"><div class="un-tabs" role="tablist">${[['cluster', 'By cluster'], ['folder', 'By folder'], ['page', 'By landing page']].map(([k, l]) => `<a role="tab" class="${k === tab ? 'on' : ''}" href="#leads?by=${k}">${l}</a>`).join('')}</div></div>${tbl}</section>`;
    }
    // ── CRM ──
    html += `<h2 class="un-sub">MQLs, pipeline and revenue (CRM)${c ? ' ' + chip(c.sample ? 'sample' : 'file') : ''}</h2>
      <section class="panel"><div class="panel-b"><div class="un-row">
        <label class="btn-primary sm un-file">Upload CRM export<input type="file" id="un-crm-file" accept=".csv,.xlsx,.xls" hidden></label>
        <button class="btn-quiet" type="button" id="un-crm-tpl">Download column template</button>
        <button class="btn-quiet" type="button" id="un-crm-sample">Preview with sample leads</button>
        ${c ? '<button class="btn-quiet" type="button" id="un-crm-clear">Remove file</button>' : ''}
      </div>${MSG.crm ? `<p class="start-error" role="alert">${esc(MSG.crm)}</p>` : ''}
      <p class="hint">Export employer leads (or contacts with their deals) from the CRM with: lead ID, create date, original source (first touch), all touches or latest source (the journey), first page seen, lifecycle stage or MQL flag, deal amount and deal stage. HubSpot, Salesforce, Zoho and LeadSquared column names are recognised. The file stays in this tab.</p></div></section>`;
    if (c && !C) html += `<div class="note"><b>Could not read the file.</b> ${esc(c.res.error)}${c.res.header ? `<br>Columns found: ${esc(c.res.header.slice(0, 30).join(', '))}` : ''}</div>`;
    if (C) {
      const cov = C.coverage, low = cov.source < 80 || !cov.amount || !cov.stage;
      const ft = C.ft, as = C.assisted, ot = C.other;
      html += `<div class="note ${low ? 'un-warn' : ''}"><b>Attribution coverage.</b> ${pct1(cov.source)} of ${fmtN(C.total)} leads have an original source${C.hasJourney ? ', the journey (all touches / latest source) is present' : ', <b>no journey column</b> (organic-in-the-journey cannot be measured)'}${cov.landing ? `, ${pct1(cov.landing)} have a first page` : ''}${cov.amount ? '' : ', <b>no deal amount</b>'}${cov.stage ? '' : ', <b>no deal stage</b>'}. ${low ? '<b>Do not report pipeline or revenue as SEO impact until coverage is fixed.</b>' : 'Coverage is good enough to report, with first touch and assisted kept apart.'}</div>
      <div class="un-kpis">
        ${kp('Organic first-touch leads', fmtN(ft.leads), '', `${pct1(ft.leads / C.total * 100)} of all leads`)}
        ${kp('MQLs (organic first touch)', ft.mqls == null ? '—' : fmtN(ft.mqls), '', ft.toMql == null ? 'no MQL column' : `lead → MQL ${pct1(ft.toMql)} · others ${pct1(ot.toMql)}`)}
        ${kp('Pipeline: organic first touch', inr(ft.pipeline), '', `${fmtN(ft.opps)} opportunities`)}
        ${kp('Revenue: organic first touch', inr(ft.revenue), '', `${fmtN(ft.won)} won`)}
        ${kp('Pipeline: organic in the journey', C.hasJourney ? inr(as.pipeline) : '—', '', C.hasJourney ? `${fmtN(as.leads)} leads came first from another channel` : 'needs a journey column')}
        ${kp('Revenue: organic in the journey', C.hasJourney ? inr(as.revenue) : '—', '', C.hasJourney ? `${fmtN(as.won)} won` : '')}
        ${kp('Lead → opportunity', pct1(ft.toOpp), pts(ft.toOpp, ot.toOpp), 'organic vs other channels')}
        ${kp('Lead → close', pct1(ft.toClose), pts(ft.toClose, ot.toClose), 'organic vs other channels')}
      </div>
      <section class="panel"><div class="panel-h"><h2>Channels compared (first touch)</h2><p>Every lead counted once, under its original source.</p></div>
        ${table('t-un-ldc', [{ k: 'channel', l: 'First-touch channel', f: r => r.channel === 'Organic search' ? `<b>${esc(r.channel)}</b>` : esc(r.channel) }, { k: 'leads', l: 'Leads', r: 1, f: r => fmtN(r.leads) }, { k: 'mqls', l: 'MQLs', r: 1, f: r => r.mqls == null ? '—' : fmtN(r.mqls) }, { k: 'opps', l: 'Opportunities', r: 1, f: r => fmtN(r.opps) }, { k: 'pipeline', l: 'Pipeline', r: 1, f: r => inr(r.pipeline) }, { k: 'won', l: 'Won', r: 1, f: r => fmtN(r.won) }, { k: 'revenue', l: 'Revenue', r: 1, f: r => inr(r.revenue) }, { k: 'toMql', l: 'Lead → MQL', r: 1, f: r => pct1(r.toMql) }, { k: 'toOpp', l: 'Lead → opp.', r: 1, f: r => pct1(r.toOpp) }, { k: 'toClose', l: 'Lead → close', r: 1, f: r => pct1(r.toClose) }, { k: 'winRate', l: 'Win rate', r: 1, f: r => pct1(r.winRate) }], C.channels, { search: false, sort: 'pipeline', file: 'unstop-crm-channels', pageSize: 20 })}</section>
      <section class="panel"><div class="panel-h"><h2>Organic first touch vs organic in the journey, by month</h2><p>Lead created month. “In the journey” = touched organic search but came first from another channel; reported apart from first touch, never added to it.</p></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Month</th><th class="r">Organic FT leads</th><th class="r">FT MQLs</th><th class="r">FT pipeline</th><th class="r">FT revenue</th><th class="r">Assisted leads</th><th class="r">Assisted pipeline</th><th class="r">Assisted revenue</th><th class="r">All leads</th></tr></thead><tbody>${C.monthly.map(m => `<tr><td>${esc(m.month)}</td><td class="r">${fmtN(m.ft.leads)}</td><td class="r">${m.ft.mqls == null ? '—' : fmtN(m.ft.mqls)}</td><td class="r">${inr(m.ft.pipeline)}</td><td class="r">${inr(m.ft.revenue)}</td><td class="r">${C.hasJourney ? fmtN(m.assisted.leads) : '—'}</td><td class="r">${C.hasJourney ? inr(m.assisted.pipeline) : '—'}</td><td class="r">${C.hasJourney ? inr(m.assisted.revenue) : '—'}</td><td class="r">${fmtN(m.all.leads)}</td></tr>`).join('')}</tbody></table></div></div></section>` +
      (C.landing.length ? `<section class="panel"><div class="panel-h"><h2>Organic first-touch pipeline by first page seen</h2></div>${table('t-un-ldl', [{ k: 'path', l: 'First page seen', cls: 'u', f: r => `<a href="${esc(focusHref({ u: r.path }))}">${esc(r.path)}</a>`, csv: r => r.path }, { k: 'cluster', l: 'Cluster' }, { k: 'leads', l: 'Leads', r: 1, f: r => fmtN(r.leads) }, { k: 'mqls', l: 'MQLs', r: 1, f: r => r.mqls == null ? '—' : fmtN(r.mqls) }, { k: 'pipeline', l: 'Pipeline', r: 1, f: r => inr(r.pipeline) }, { k: 'revenue', l: 'Revenue', r: 1, f: r => inr(r.revenue) }, { k: 'toOpp', l: 'Lead → opp.', r: 1, f: r => pct1(r.toOpp) }], withCluster(D, C.landing, r => r.path), { sort: 'pipeline', file: 'unstop-crm-organic-by-page', pageSize: 15, searchKeys: ['path', 'cluster'], placeholder: 'Filter pages' })}</section>` : '');
    }
    const mount = () => {
      scopeMount(D); ['t-un-ldp', 't-un-ldc', 't-un-ldl'].forEach(drawTable);
      const $ = id => document.getElementById(id);
      const f = $('un-crm-file');
      if (f) f.addEventListener('change', async () => { const file = f.files[0]; if (!file) return; MSG.crm = ''; try { const rows = await readSheet(file); CRM.set(D.site, { rows, res: U.crmModel(rows), name: file.name, at: Date.now() }); } catch (e) { MSG.crm = e.message; } rerender(); });
      const t = $('un-crm-tpl'); if (t) t.addEventListener('click', () => download('crm-export-template.csv', 'Record ID,Create Date,Original Source,All touches,First page seen,Lifecycle Stage,Deal amount,Deal stage\nL1001,2026-09-02,Organic Search,Organic Search > Email Marketing,https://unstop.com/employers/ats-software,Marketing Qualified Lead,450000,Closed Won\nL1002,2026-09-04,Paid Search,Paid Search > Organic Search > Direct Traffic,,Opportunity,300000,Proposal\nL1003,2026-09-05,Direct Traffic,Direct Traffic,,Lead,,\n'));
      const sm = $('un-crm-sample'); if (sm) sm.addEventListener('click', () => { const rows = sampleCrm(); CRM.set(D.site, { rows, res: U.crmModel(rows), name: 'Sample leads', at: Date.now(), sample: true }); MSG.crm = ''; rerender(); });
      const cl = $('un-crm-clear'); if (cl) cl.addEventListener('click', () => { CRM.delete(D.site); rerender(); });
    };
    return { html, mount };
  };

  // ════════════════════════════ WORKSTREAM SCORECARDS ════════════════════════════
  // Technical SEO, content & programmatic pages, link building, content refreshes, visibility in AI answers.
  // Uploads stay in this tab; PageSpeed and URL Inspection runs are kept in this browser so weeks can be compared.
  const SC = window.UN_SC;
  const SCD = new Map(); // site → { crawl, pub, links, ai, psi, insp, refresh } (tab memory)
  const scd = site => { if (!SCD.has(site)) SCD.set(site, {}); return SCD.get(site); };
  const TKEY = site => 'un:tech:' + site;
  const techHist = site => { try { const v = JSON.parse(localStorage.getItem(TKEY(site))); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const techSave = (site, entry) => { try { const h = techHist(site).concat([entry]).slice(-26); localStorage.setItem(TKEY(site), JSON.stringify(h)); } catch (e) { } };
  // one representative page per cluster (most clicks) plus the key pages from Funnel setup
  function techUrls(A, D) {
    const so = sectioner(D), s = settings(D.site), best = new Map();
    (A.P || []).forEach(r => { const id = so(r.p); if (['util', 'other'].includes(id)) return; const b = best.get(id); if (!b || r.clicks > b.clicks) best.set(id, r); });
    const host = (A.P && A.P[0] && (A.P[0].p.match(/^https?:\/\/[^/]+/) || [])[0]) || 'https://unstop.com';
    const urls = [...best.values()].sort((a, b) => b.clicks - a.clicks).map(r => r.p);
    (s.keyPages || []).forEach(p => { const u = /^https?:/.test(p) ? p : host + U.pathOnly(p); if (!urls.includes(u)) urls.push(u); });
    return urls.slice(0, 30);
  }
  async function runPsi(A, D) {
    const X = scd(D.site), s = settings(D.site), urls = techUrls(A, D);
    X.psi = { status: 'loading', done: 0, total: urls.length, results: [] }; rerender();
    let i = 0;
    const worker = async () => { while (i < urls.length) { const u = urls[i++]; try { const r = await fetch(SC.psiUrl(u, s.psiKey)); const j = await r.json(); if (!r.ok) throw new Error((j.error && j.error.message) || r.statusText); X.psi.results.push(SC.psiParse(u, j)); } catch (e) { X.psi.results.push({ url: u, error: /quota|429/i.test(e.message) ? 'PageSpeed quota reached: add a free API key in Funnel setup' : e.message }); } X.psi.done++; const p = document.getElementById('un-psi-prog'); if (p) p.textContent = `Testing pages with PageSpeed Insights… ${X.psi.done} of ${X.psi.total}`; } };
    await Promise.all([worker(), worker()]);
    X.psi.status = 'done'; X.psi.at = Date.now(); X.psi.sum = SC.cwvSummary(X.psi.results);
    techSave(D.site, { at: X.psi.at, kind: 'psi', passRate: X.psi.sum.passRate, perf: X.psi.sum.medianPerf, lcp: X.psi.sum.medianLcp, tested: X.psi.sum.tested });
    rerender();
  }
  async function runInspect(A, D, perCluster) {
    const X = scd(D.site), src = window.CW_SOURCE, so = sectioner(D), SURF = window.CW_SURF;
    if (!src || !src.gsc || !src.gsc.inspect) return;
    const by = new Map(); (A.P || []).slice().sort((a, b) => b.impr - a.impr).forEach(r => { const id = so(r.p); if (['util', 'other'].includes(id)) return; const l = by.get(id) || []; if (l.length < perCluster) l.push(r.p); by.set(id, l); });
    // spread the sample: most-seen pages first, then the weakest ones in each cluster
    const urls = [...by.entries()].flatMap(([id, l]) => l.map(u => ({ id, u })));
    X.insp = { status: 'loading', done: 0, total: urls.length, rows: [] }; rerender();
    let i = 0;
    const worker = async () => { while (i < urls.length) { const x = urls[i++]; try { const d = await src.gsc.inspect(x.u); const r = SURF.inspection(x.u, d.inspectionResult); X.insp.rows.push({ ...r, id: x.id, cluster: so.label(x.id) }); } catch (e) { X.insp.rows.push({ url: x.u, id: x.id, cluster: so.label(x.id), error: e.message }); } X.insp.done++; const p = document.getElementById('un-insp-prog'); if (p) p.textContent = `Inspecting URLs… ${X.insp.done} of ${X.insp.total}`; } };
    await Promise.all([worker(), worker(), worker()]);
    X.insp.status = 'done'; X.insp.at = Date.now();
    const ok = X.insp.rows.filter(r => !r.error);
    techSave(D.site, { at: X.insp.at, kind: 'inspect', indexedPct: ok.length ? ok.filter(r => r.indexed).length / ok.length * 100 : null, n: ok.length });
    rerender();
  }
  // ── sample data for the sample site ──
  function scSamples(A, D) {
    const X = scd(D.site); if (D.sampleOf !== 'unstop' || X.sampled) return; X.sampled = true;
    let seed = 41; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const so = sectioner(D), urls = techUrls(A, D);
    X.psi = { status: 'done', sample: true, at: Date.now(), results: urls.map(u => { const id = so(u), slow = /hackathons|competitions/.test(id) && R() < .5; const lcp = Math.round((slow ? 2600 : 1700) + R() * 1400), cls = +(R() * (slow ? .18 : .09)).toFixed(2), inp = Math.round(100 + R() * 140); return { url: u, perf: Math.round(45 + R() * 45), field: { lcp, inp, cls }, lab: { lcp: lcp + 400, cls }, hasField: true, pass: lcp <= 2500 && cls <= .1 && inp <= 200 }; }) };
    X.psi.sum = SC.cwvSummary(X.psi.results);
    const ins = []; (A.P || []).slice(0, 400).forEach((r, i) => { if (i % 3) return; const id = so(r.p); if (['util', 'other'].includes(id)) return; const bad = R() < (/orgpages|jobs/.test(id) ? .32 : .1); ins.push({ url: r.p, id, cluster: so.label(id), indexed: !bad, key: bad ? (R() < .6 ? 'crawled' : 'discovered') : 'ok', label: bad ? (R() < .6 ? 'Crawled – currently not indexed' : 'Discovered – currently not indexed') : 'Indexed' }); });
    X.insp = { status: 'done', sample: true, at: Date.now(), rows: ins };
    const crawl = [['Address', 'Content Type', 'Status Code', 'Indexability', 'Indexability Status', 'Response Time']];
    (A.P || []).forEach(r => { const x = R(); crawl.push([r.p, 'text/html; charset=utf-8', x < .025 ? 404 : x < .03 ? 500 : x < .07 ? 301 : 200, x > .07 && R() < .04 ? 'Non-Indexable' : 'Indexable', '', +(0.2 + R() * 1.4).toFixed(2)]); });
    X.crawl = { name: 'Sample crawl', sample: true, at: Date.now(), res: SC.crawlModel(crawl, so) };
    const end = new Date(D.end + 'T00:00:00Z'), pub = [['URL', 'Publish date', 'Template']];
    (A.P || []).forEach(r => { const id = so(r.p); if (!['blog', 'resources', 'internships', 'jobs', 'orgpages', 'empjobboard', 'hackathons', 'competitions'].includes(id)) return; const d = new Date(end); d.setUTCDate(d.getUTCDate() - Math.floor(R() * 270)); pub.push([r.p, d.toISOString().slice(0, 10), /internship\/|job\/|hire-/.test(r.p) ? 'Programmatic: ' + so.label(id).split(' › ').pop() : so.label(id)]); });
    for (let i = 0; i < 160; i++) { const d = new Date(end); d.setUTCDate(d.getUTCDate() - Math.floor(R() * 270)); pub.push([`https://unstop.com/internship/new-role-${i}-internship`, d.toISOString().slice(0, 10), 'Programmatic: Internships']); }
    X.pub = { name: 'Sample publishing log', sample: true, at: Date.now(), rows: pub };
    const tg = (A.P || []).filter(r => /employers|blog|internship$|hackathons$/.test(r.p)).slice(0, 25).map(r => r.p), doms = ['careers360', 'shiksha', 'indiatoday', 'thehindu', 'yourstory', 'inc42', 'economictimes', 'medium', 'dev.to', 'collegedunia', 'jagranjosh', 'livemint', 'naukri', 'iimjobs', 'linkedin', 'quora', 'reddit', 'hashnode', 'analyticsvidhya', 'geeksforgeeks'];
    const ln = [['Referring domain', 'Domain rating', 'First seen', 'Target URL', 'Link type']];
    for (let i = 0; i < 140; i++) { const dom = doms[i % doms.length] + (i >= doms.length ? '-' + i + '.in' : '.com'); const d = new Date(end); d.setUTCDate(d.getUTCDate() - Math.floor(R() * 180)); ln.push([dom, Math.round(i < 20 ? 55 + R() * 35 : R() * 60), d.toISOString().slice(0, 10), tg[i % tg.length], R() < .25 ? 'nofollow' : 'dofollow']); }
    X.links = { name: 'Sample backlinks', sample: true, at: Date.now(), rows: ln };
    const qs = ['best platform for hackathons in india', 'where to find internships for college students', 'case competitions for mba students', 'how to prepare for tcs nqt', 'campus hiring platform for companies', 'best ats for campus recruitment', 'online assessment tools for hiring freshers', 'free coding practice platform', 'how to host a hackathon for hiring', 'internship websites for engineering students', 'college fests in india 2026', 'scholarships for engineering students', 'quiz competitions for students', 'fresher jobs off campus drive', 'resume tips for freshers', 'top companies hiring freshers'];
    const engines = ['ChatGPT', 'Perplexity', 'Google AI Overviews', 'Gemini'], ai = [['Query', 'Engine', 'Mentioned', 'Cited', 'Cited URL', 'Date', 'Cluster']];
    ['2026-08-15', '2026-09-15', '2026-10-15'].forEach((dt, k) => qs.forEach((q, i) => engines.forEach((e, j) => { const p = .35 + (i % 4) * .1 + k * .05 + (e === 'Perplexity' ? .12 : e === 'Gemini' ? -.08 : 0); const m = R() < p, c = m && R() < (e === 'ChatGPT' ? .45 : .7); ai.push([q, e, m ? 'yes' : 'no', c ? 'yes' : 'no', c ? 'https://unstop.com' + (/hackathon/.test(q) ? '/hackathons' : /intern/.test(q) ? '/internship' : /ats|assessment|hiring platform|campus hiring/.test(q) ? '/employers/ats-software' : '/blog/' + q.replace(/\s+/g, '-')) : '', dt, /ats|assessment|campus hiring|host/.test(q) ? 'Employer' : 'Student']); })));
    X.ai = { name: 'Sample prompt tracker', sample: true, at: Date.now(), rows: ai };
  }
  // demo refreshes: blog pages "refreshed" 40–100 days ago (tab only)
  function refreshList(A, D) {
    const FXV = window.CW_FIXVIEW; const saved = FXV ? FXV.load(D.site).list : [];
    if (saved.length || D.sampleOf !== 'unstop') return { list: saved, sample: false };
    const blog = (A.P || []).filter(r => /\/blog\//.test(r.p)).slice(0, 6);
    return { sample: true, list: blog.map((r, i) => { const d = new Date(D.end + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - (40 + i * 11)); return { id: 's' + i, url: r.p, date: d.toISOString().slice(0, 10), what: 'Content refresh (sample)', scope: 'page' }; }) };
  }
  async function measureRefreshes(A, D) {
    const X = scd(D.site), S = window.CW_SOURCE, FX = window.CW_FIXES; if (!S || !FX) return;
    const { list, sample } = refreshList(A, D);
    X.refresh = { status: 'loading', rows: [], sample }; rerender();
    for (const f of list.slice(0, 30)) {
      try {
        const start = FX.add(f.date, -90), end = S.latest && S.latest < FX.add(f.date, 90) ? S.latest : FX.add(f.date, 90);
        const rows = f.scope === 'site' ? await S.siteDaily(start, end) : await S.pageDaily(f.url, start, end);
        const w = [28, 56, 90].map(n => FX.measure(f, rows, null, S.latest, S.earliest, { window: n }));
        X.refresh.rows.push({ f, w });
      } catch (e) { X.refresh.rows.push({ f, error: e.message }); }
    }
    X.refresh.status = 'done'; X.refresh.at = Date.now(); rerender();
  }

  const SC_TABS = [['overview', 'Overview'], ['tech', 'Technical SEO'], ['content', 'Content & programmatic'], ['links', 'Link building'], ['refresh', 'Content refreshes'], ['ai', 'AI answers']];
  V.scorecards = (A, D) => {
    demoFill(D); scSamples(A, D);
    window.CW_LAST_A = A;
    Object.keys(TABLES).filter(k => k.startsWith('t-un-sc')).forEach(k => delete TABLES[k]);
    const X = scd(D.site), so = sectioner(D), s = settings(D.site), tab = fParams().get('w') || 'overview';
    const live = window.CW_SOURCE && window.CW_SOURCE.kind === 'api' && window.CW_SOURCE.gsc;
    const kp = (l, v, d, sub) => `<div class="un-kpi"><span>${esc(l)}</span><b>${v}</b><small>${d || ''} ${sub || ''}</small></div>`;
    const upl = (id, label, tpl) => `<div class="un-row"><label class="btn-primary sm un-file">${esc(label)}<input type="file" id="un-sc-${id}" accept=".csv,.xlsx,.xls" hidden></label>${tpl ? `<button class="btn-quiet" type="button" id="un-sc-${id}-tpl">Download column template</button>` : ''}${X[id] ? `<button class="btn-quiet" type="button" id="un-sc-${id}-clear">Remove file</button> <span class="hint">${esc(X[id].name)}${X[id].sample ? ' (sample)' : ''}</span>` : ''}</div>`;
    const crawl = X.crawl && X.crawl.res && X.crawl.res.ok ? X.crawl.res : null;
    const pub = X.pub ? SC.publishingModel(X.pub.rows, A.P, so, D.end) : null;
    const links = X.links ? SC.linksModel(X.links.rows, A, D, so) : null;
    const ai = X.ai ? SC.aiModel(X.ai.rows) : null;
    const M = gaModel(D);
    const aiS = M ? M.ai.reduce((a, r) => a + r.sessions, 0) : null, aiY = M ? M.ai.reduce((a, r) => a + r.ySessions, 0) : null;
    const insOk = X.insp ? X.insp.rows.filter(r => !r.error) : [];
    const idxPct = insOk.length ? insOk.filter(r => r.indexed).length / insOk.length * 100 : null;
    const hist = techHist(D.site);
    const intro = head('Workstream scorecards', 'Each workstream gets its own scorecard: technical SEO, content & programmatic pages, link building, content refreshes and visibility in AI answers.');
    let html = intro + `<div class="un-tabs" role="tablist">${SC_TABS.map(([k, l]) => `<a role="tab" class="${k === tab ? 'on' : ''}" href="#scorecards?w=${k}">${l}</a>`).join('')}</div>`;
    const sampleNote = D.sampleOf === 'unstop' ? '<div class="note"><b>Sample data.</b> Generated for the sample site. Upload your own exports or run the checks on real data.</div>' : '';
    if (tab === 'overview') {
      const R2 = X.refresh && X.refresh.rows ? X.refresh.rows.filter(r => r.w && r.w[0].status === 'measured' && r.w[0].window.L >= 28) : [];
      const card = (title, href, owner, cadence, items) => `<section class="un-sc"><h3><a href="${href}">${esc(title)}</a></h3>${items.map(([l, v, sub]) => `<div class="un-sc-r"><span>${esc(l)}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`).join('')}<div class="un-m-foot"><span>${esc(owner)}</span><span>${esc(cadence)}</span></div></section>`;
      html += sampleNote + `<div class="un-scs">
        ${card('Technical SEO', '#scorecards?w=tech', 'Technical SEO + Engineering', 'Weekly', [['Crawl errors (4xx / 5xx)', crawl ? fmtN(crawl.errors4 + crawl.errors5) : '—', crawl ? pct1((crawl.errors4 + crawl.errors5) / crawl.urls * 100) + ' of crawled pages' : 'upload a crawl'], ['Core Web Vitals pass rate', X.psi && X.psi.sum ? pct1(X.psi.sum.passRate) : '—', X.psi && X.psi.sum ? `${X.psi.sum.withField} pages with field data` : 'run PageSpeed'], ['Indexed (URL Inspection sample)', pct1(idxPct), insOk.length ? fmtN(insOk.length) + ' URLs inspected' : 'run on live data'], ['Median performance score', X.psi && X.psi.sum && X.psi.sum.medianPerf != null ? X.psi.sum.medianPerf : '—', 'mobile, lab']])}
        ${card('Content & programmatic', '#scorecards?w=content', 'Programmatic SEO + Content + Engineering', 'Monthly cohort', [['Pages published', pub && pub.ok ? fmtN(pub.total.published) : '—', pub && pub.ok ? '' : 'upload a publishing log'], ['Pages indexed (getting impressions)', pub && pub.ok ? pct1(pub.total.visibleRate) : '—', pub && pub.ok ? fmtN(pub.total.visible) + ' pages' : ''], ['With traffic after 90 days', pub && pub.ok ? pct1(pub.total.traffic90Rate) : '—', pub && pub.ok ? `of ${fmtN(pub.total.old)} pages 90+ days old` : ''], ['Clicks per page', pub && pub.ok && pub.total.perPage != null ? pub.total.perPage.toFixed(1) : '—', 'in the analysed period']])}
        ${card('Link building', '#scorecards?w=links', 'SEO + Digital PR / Outreach', 'Monthly', [['Referring domains gained', links && links.ok ? fmtN(links.domains) : '—', links && links.ok ? fmtN(links.follow) + ' followed' : 'upload a backlink export'], ['Quality: DR 50+', links && links.ok ? fmtN(links.tiers[0].domains) : '—', links && links.ok && links.avgDr != null ? 'average DR ' + links.avgDr.toFixed(0) : ''], ['Target pages that moved up', links && links.ok ? `${fmtN(links.improved)} of ${fmtN(links.measured)}` : '—', links && links.ok ? fmtN(links.declined) + ' moved down' : '']])}
        ${card('Content refreshes', '#scorecards?w=refresh', 'Content SEO', 'Monthly; 28 / 56 / 90-day checks', [['Refreshes tracked', fmtN(refreshList(A, D).list.length), refreshList(A, D).sample ? 'sample' : '<a href="#fixes">add in Fix tracker</a>'], ['Measured at 28 days', R2.length ? fmtN(R2.length) : '—', R2.length ? `${R2.filter(r => /improved/.test(r.w[0].verdict)).length} improved · ${R2.filter(r => /declined/.test(r.w[0].verdict)).length} declined` : 'open the tab to measure']])}
        ${card('AI answers', '#scorecards?w=ai', 'SEO + Analytics', 'Monthly', [['Mentioned in AI answers', ai && ai.ok ? pct1(ai.total.mention) : '—', ai && ai.ok ? `${fmtN(ai.total.queries)} core queries · ${ai.engines.length} engines` : 'upload the prompt tracker'], ['Cited (linked)', ai && ai.ok ? pct1(ai.total.cite) : '—', ''], ['AI referral sessions', aiS != null ? fmtN(Math.round(aiS)) : '—', aiS != null ? dchip(U.chg(aiS, aiY)) + ' vs last year' : 'connect GA4']])}
      </div>`;
    }
    if (tab === 'tech') {
      const P = X.psi, sum = P && P.sum;
      html += sampleNote + `<div class="un-kpis">
        ${kp('Crawl errors', crawl ? fmtN(crawl.errors4 + crawl.errors5) : '—', '', crawl ? `${fmtN(crawl.errors4)} 4xx · ${fmtN(crawl.errors5)} 5xx · ${fmtN(crawl.redirects)} redirects` : 'upload a crawl below')}
        ${kp('Core Web Vitals pass rate', sum ? pct1(sum.passRate) : '—', '', sum ? `${sum.withField} of ${sum.tested} pages have field data` : 'run PageSpeed below')}
        ${kp('Indexed (inspection sample)', pct1(idxPct), '', insOk.length ? fmtN(insOk.length) + ' URLs' : live ? 'run URL Inspection below' : 'needs Search Console')}
        ${kp('Page speed', sum && sum.medianLcp != null ? (sum.medianLcp / 1000).toFixed(1) + ' s' : '—', '', sum && sum.medianPerf != null ? 'median LCP · performance ' + sum.medianPerf : '')}
      </div>`;
      // CWV
      html += `<section class="panel"><div class="panel-h"><h2>Core Web Vitals and page speed</h2><p>PageSpeed Insights (mobile) on the top page of each cluster plus the key pages from Funnel setup. Pass = field data (real Chrome users, 75th percentile) with LCP ≤ 2.5 s, INP ≤ 200 ms and CLS ≤ 0.1. Pages without enough traffic have lab data only and are left out of the pass rate.</p></div>
        <div class="panel-b"><div class="un-row"><button class="btn-primary sm" type="button" id="un-psi-go">${P ? 'Run again' : 'Test ' + techUrls(A, D).length + ' pages'}</button><span class="progress" id="un-psi-prog">${P && P.status === 'loading' ? `Testing… ${P.done} of ${P.total}` : P && P.at ? 'Tested ' + when(P.at) + (P.sample ? ' (sample)' : '') : ''}</span>${s.psiKey ? '' : '<span class="hint">Without an API key Google allows only a few tests a minute; add a free key in Funnel setup.</span>'}</div></div>
        ${P && P.results.length ? table('t-un-scp', [{ k: 'url', l: 'Page', cls: 'u', f: r => `<a href="${esc(focusHref({ u: U.pathOnly(r.url) }))}">${esc(U.pathOnly(r.url))}</a>`, csv: r => r.url }, { k: 'cluster', l: 'Cluster' }, { k: 'pass', l: 'CWV', f: r => r.error ? `<span class="un-st bad">Error</span> <small>${esc(r.error)}</small>` : r.pass == null ? '<span class="un-st none">No field data</span>' : r.pass ? '<span class="un-st live">Pass</span>' : '<span class="un-st bad">Fail</span>', csv: r => r.error ? 'error' : r.pass == null ? 'no field data' : r.pass ? 'pass' : 'fail' }, { k: 'lcp', l: 'LCP', r: 1, f: r => r.field && r.field.lcp != null ? (r.field.lcp / 1000).toFixed(1) + ' s' : r.lab && r.lab.lcp != null ? (r.lab.lcp / 1000).toFixed(1) + ' s (lab)' : '—' }, { k: 'inp', l: 'INP', r: 1, f: r => r.field && r.field.inp != null ? r.field.inp + ' ms' : '—' }, { k: 'cls', l: 'CLS', r: 1, f: r => r.field && r.field.cls != null ? r.field.cls.toFixed(2) : '—' }, { k: 'perf', l: 'Performance', r: 1, f: r => r.perf == null ? '—' : r.perf }],
          withCluster(D, P.results, r => r.url).map(r => ({ ...r, lcp: r.field ? r.field.lcp : null, inp: r.field ? r.field.inp : null, cls: r.field ? r.field.cls : null })), { search: false, file: 'unstop-core-web-vitals', pageSize: 30 }) : ''}</section>`;
      // indexation
      const ib = new Map(); insOk.forEach(r => { const o = ib.get(r.cluster) || { cluster: r.cluster, n: 0, idx: 0, issues: new Map() }; o.n++; if (r.indexed) o.idx++; else o.issues.set(r.label, (o.issues.get(r.label) || 0) + 1); ib.set(r.cluster, o); });
      html += `<section class="panel"><div class="panel-h"><h2>Indexation</h2><p>URL Inspection on a sample of pages per cluster (Search Console allows 2,000 inspections a day). For sitemap totals see <a href="#visibility">Visibility › Indexation by page type</a>; for programmatic cohorts see Content & programmatic.</p></div>
        <div class="panel-b"><div class="un-row">${live ? `<button class="btn-primary sm" type="button" id="un-insp-go">Inspect 10 URLs per cluster</button>` : '<span class="hint">Needs a Search Console connection.</span>'}<span class="progress" id="un-insp-prog">${X.insp && X.insp.status === 'loading' ? `Inspecting… ${X.insp.done} of ${X.insp.total}` : X.insp && X.insp.at ? 'Inspected ' + when(X.insp.at) + (X.insp.sample ? ' (sample)' : '') : ''}</span></div></div>
        ${ib.size ? `<div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Cluster</th><th class="r">Inspected</th><th class="r">Indexed</th><th>Not indexed because</th></tr></thead><tbody>${[...ib.values()].sort((a, b) => a.idx / a.n - b.idx / b.n).map(o => `<tr><td><b>${esc(o.cluster)}</b></td><td class="r">${o.n}</td><td class="r">${pct1(o.idx / o.n * 100)}</td><td><small>${[...o.issues.entries()].map(([k, v]) => `${esc(k)} (${v})`).join(' · ') || '—'}</small></td></tr>`).join('')}</tbody></table></div></div>` : ''}</section>`;
      // crawl
      html += `<section class="panel"><div class="panel-h"><h2>Crawl errors</h2><p>Upload the Internal (HTML) export of a site crawl from Screaming Frog, Sitebulb or similar: URL, status code, indexability, response time.</p></div><div class="panel-b">${upl('crawl', 'Upload crawl export')}${X.crawl && !crawl ? `<p class="start-error">${esc(X.crawl.res.error)}</p>` : ''}</div>
        ${crawl ? table('t-un-scc', [{ k: 'cluster', l: 'Cluster', f: r => `<b>${esc(r.cluster)}</b>` }, { k: 'urls', l: 'Pages crawled', r: 1, f: r => fmtN(r.urls) }, { k: 'c4', l: '4xx', r: 1, f: r => fmtN(r.c4) }, { k: 'c5', l: '5xx', r: 1, f: r => fmtN(r.c5) }, { k: 'errorRate', l: 'Error rate', r: 1, f: r => pct1(r.errorRate) }, { k: 'redirect', l: 'Redirects', r: 1, f: r => fmtN(r.redirect) }, { k: 'nonIndexable', l: 'Non-indexable 200s', r: 1, f: r => fmtN(r.nonIndexable) }, { k: 'medianTime', l: 'Median response', r: 1, f: r => r.medianTime == null ? '—' : r.medianTime.toFixed(2) + ' s' }], crawl.clusters, { search: false, sort: 'c4', file: 'unstop-crawl-by-cluster', pageSize: 30 }) + (crawl.errorList.length ? `<details class="un-det"><summary>${fmtN(crawl.errorList.length)} error URLs</summary>${table('t-un-sce', [{ k: 'url', l: 'URL', cls: 'u' }, { k: 'status', l: 'Status' }, { k: 'cluster', l: 'Cluster' }], crawl.errorList, { file: 'unstop-crawl-errors', pageSize: 20, placeholder: 'Filter URLs' })}</details>` : '') : ''}</section>`;
      if (hist.length) html += `<section class="panel"><div class="panel-h"><h2>History in this browser</h2><p>Each PageSpeed and URL Inspection run is kept here so weekly reviews can compare.</p></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Run</th><th>Check</th><th class="r">Result</th></tr></thead><tbody>${hist.slice().reverse().map(h => `<tr><td>${when(h.at)}</td><td>${h.kind === 'psi' ? 'PageSpeed' : 'URL Inspection'}</td><td class="r">${h.kind === 'psi' ? `CWV pass ${pct1(h.passRate)} · perf ${h.perf == null ? '—' : h.perf} · ${h.tested} pages` : `indexed ${pct1(h.indexedPct)} of ${h.n}`}</td></tr>`).join('')}</tbody></table></div></div></section>`;
    }
    if (tab === 'content') {
      html += sampleNote + `<section class="panel"><div class="panel-h"><h2>Publishing log</h2><p>One row per page: URL, publish (go-live) date and, optionally, the template. Joined with Search Console for the analysed period: “indexed” = the page got impressions (Search Console only reports pages it shows); “traffic after 90 days” counts pages published 90+ days ago that got clicks.</p></div><div class="panel-b">${upl('pub', 'Upload publishing log', true)}${pub && !pub.ok ? `<p class="start-error">${esc(pub.error)}</p>` : ''}</div></section>`;
      if (pub && pub.ok) {
        const t = pub.total;
        html += `<div class="un-kpis">${kp('Pages published', fmtN(t.published), '', '')}${kp('Pages indexed', pct1(t.visibleRate), '', fmtN(t.visible) + ' getting impressions')}${kp('Traffic after 90 days', pct1(t.traffic90Rate), '', `${fmtN(t.traffic90)} of ${fmtN(t.old)} pages 90+ days old`)}${kp('Clicks per page', t.perPage != null ? t.perPage.toFixed(1) : '—', '', 'analysed period')}</div>`;
        const cols = first => [first, { k: 'published', l: 'Published', r: 1, f: r => fmtN(r.published) }, { k: 'visible', l: 'Indexed (impressions)', r: 1, f: r => fmtN(r.visible) }, { k: 'visibleRate', l: 'Indexed %', r: 1, f: r => pct1(r.visibleRate) }, { k: 'old', l: '90+ days old', r: 1, f: r => fmtN(r.old) }, { k: 'traffic90Rate', l: 'With traffic after 90 days', r: 1, f: r => pct1(r.traffic90Rate) }, { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) }, { k: 'perPage', l: 'Clicks per page', r: 1, f: r => r.perPage == null ? '—' : r.perPage.toFixed(1) }];
        html += `<section class="panel"><div class="panel-h"><h2>By template</h2><p>Programmatic templates and content types are judged on outcomes, not on page count.</p></div>${table('t-un-sct', cols({ k: 'key', l: 'Template', f: r => `<b>${esc(r.key)}</b>` }), pub.byTemplate, { search: false, sort: 'published', file: 'unstop-content-by-template', pageSize: 30 })}</section>
          <section class="panel"><div class="panel-h"><h2>By publication month (cohorts)</h2></div>${table('t-un-scm', cols({ k: 'key', l: 'Published in' }), pub.byMonth, { search: false, sort: 'key', dir: 1, file: 'unstop-content-cohorts', pageSize: 24 })}</section>`;
      } else if (!pub) html += '<div class="note">Without a publishing log, see pages with impressions and clicks per page by cluster on <a href="#urlclusters">Clusters</a> and <a href="#visibility">Visibility</a>.</div>';
    }
    if (tab === 'links') {
      html += sampleNote + `<section class="panel"><div class="panel-h"><h2>Referring domains</h2><p>Upload the “new referring domains” or backlinks export from Ahrefs, Semrush or Moz: referring domain, domain rating (DR / Authority Score / DA), first seen, target URL and link type. Ranking movement compares each target page’s Search Console position now with the previous period.</p></div><div class="panel-b">${upl('links', 'Upload backlink export', true)}${links && !links.ok ? `<p class="start-error">${esc(links.error)}</p>` : ''}</div></section>`;
      if (links && links.ok) {
        html += `<div class="un-kpis">${kp('Referring domains', fmtN(links.domains), '', fmtN(links.follow) + ' followed')}${kp('Average rating', links.avgDr != null ? links.avgDr.toFixed(0) : '—', '', 'DR / AS / DA as exported')}${links.tiers.slice(0, 2).map(t => kp('Quality: ' + t.tier, fmtN(t.domains), '', '')).join('')}${kp('Target pages up in position', `${fmtN(links.improved)} of ${fmtN(links.measured)}`, '', fmtN(links.declined) + ' down · vs previous period')}</div>
          <div class="grid-2 even"><section class="panel"><div class="panel-h"><h2>Gained per month</h2></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Month</th><th class="r">Domains</th><th class="r">Followed</th><th class="r">DR 50+</th></tr></thead><tbody>${links.months.map(m => `<tr><td>${esc(m.month)}</td><td class="r">${m.domains}</td><td class="r">${m.follow}</td><td class="r">${m.high}</td></tr>`).join('')}</tbody></table></div></div></section>
          <section class="panel"><div class="panel-h"><h2>Quality</h2></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Rating</th><th class="r">Domains</th><th class="r">Share</th></tr></thead><tbody>${links.tiers.map(t => `<tr><td>${esc(t.tier)}</td><td class="r">${t.domains}</td><td class="r">${pct1(links.domains ? t.domains / links.domains * 100 : null)}</td></tr>`).join('')}</tbody></table></div></div></section></div>
          <section class="panel"><div class="panel-h"><h2>Target pages: links gained and ranking movement</h2></div>${table('t-un-scl', [{ k: 'path', l: 'Target page', cls: 'u', f: r => `<a href="${esc(focusHref({ u: r.path }))}">${esc(r.path)}</a>`, csv: r => r.path }, { k: 'cluster', l: 'Cluster' }, { k: 'domains', l: 'Domains', r: 1 }, { k: 'high', l: 'DR 50+', r: 1 }, { k: 'pos', l: 'Position now', r: 1, f: r => r.pos ? posTag(r.pos) : '—' }, { k: 'posChange', l: 'Moved', r: 1, f: r => r.posChange == null ? '—' : `<span class="un-d ${r.posChange > 0 ? 'up' : r.posChange < 0 ? 'down' : 'flat'}">${r.posChange > 0 ? '▲ ' : r.posChange < 0 ? '▼ ' : ''}${Math.abs(r.posChange).toFixed(1)}</span>`, csv: r => r.posChange }, { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) + ' ' + dchip(r.dClicks) }], links.targets, { sort: 'domains', file: 'unstop-link-targets', pageSize: 20, placeholder: 'Filter pages' })}</section>
          <section class="panel"><div class="panel-h"><h2>Domains</h2></div>${table('t-un-scd', [{ k: 'domain', l: 'Referring domain' }, { k: 'dr', l: 'Rating', r: 1, f: r => r.dr == null ? '—' : r.dr }, { k: 'tier', l: 'Quality' }, { k: 'date', l: 'First seen' }, { k: 'nofollow', l: 'Link', f: r => r.nofollow ? 'nofollow' : 'followed', csv: r => r.nofollow ? 'nofollow' : 'followed' }, { k: 'targets', l: 'Targets', cls: 'u' }], links.list, { sort: 'date', file: 'unstop-referring-domains', pageSize: 20, placeholder: 'Filter domains' })}</section>`;
      }
    }
    if (tab === 'refresh') {
      const RL = refreshList(A, D), RF = X.refresh;
      html += `<section class="panel"><div class="panel-h"><h2>Content refreshes: before vs after</h2><p>Each refresh is a dated change in the <a href="#fixes">Fix tracker</a> (record the URL and the day it went live). Clicks per day and average position are compared over the same number of days before and after, at 28, 56 and 90 days, against daily noise. ${RL.sample ? '<b>Sample refreshes</b> on the sample site.' : ''}</p></div>
        <div class="panel-b"><div class="un-row"><button class="btn-primary sm" type="button" id="un-rf-go" ${RL.list.length ? '' : 'disabled'}>${RF ? 'Measure again' : 'Measure ' + RL.list.length + ' refresh' + (RL.list.length === 1 ? '' : 'es')}</button><a class="btn-quiet" href="#fixes">Add a refresh</a><span class="progress">${RF && RF.status === 'loading' ? 'Measuring…' : RF && RF.at ? 'Measured ' + when(RF.at) : ''}</span></div></div>
        ${RF && RF.rows.length ? `<div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Page</th><th>Refreshed</th>${[28, 56, 90].map(n => `<th class="r">${n} days: clicks / day</th><th class="r">${n} days: position</th>`).join('')}<th>Verdict (longest window)</th></tr></thead><tbody>${RF.rows.map(r => { if (r.error) return `<tr><td class="u">${esc(U.pathOnly(r.f.url || ''))}</td><td>${esc(r.f.date)}</td><td colspan="7" class="start-error">${esc(r.error)}</td></tr>`; const last = r.w.slice().reverse().find((x, k) => x.status === 'measured' && x.window.L >= [90, 56, 28][k]); return `<tr><td class="u" style="min-width:220px"><a href="${esc(focusHref({ u: U.pathOnly(r.f.url) }))}">${esc(U.pathOnly(r.f.url))}</a></td><td style="white-space:nowrap">${esc(r.f.date)}</td>${r.w.map((x, wi) => x.status === 'measured' && x.window.L >= [28, 56, 90][wi] ? `<td class="r">${x.before.perDay.toFixed(1)} → ${x.after.perDay.toFixed(1)} ${dchip(x.change.clicks)}</td><td class="r">${x.before.pos != null ? x.before.pos.toFixed(1) : '—'} → ${x.after.pos != null ? x.after.pos.toFixed(1) : '—'}</td>` : `<td class="r" colspan="2"><small>${x.status === 'too-little' ? 'too few clicks' : x.status === 'no-before' ? 'not enough data before' : `needs ${[28, 56, 90][wi]} days each side`}</small></td>`).join('')}<td>${last ? esc(window.CW_FIXES.VERDICT[last.verdict] || last.verdict) : esc(window.CW_FIXES.label(r.w[0]))}</td></tr>`; }).join('')}</tbody></table></div><p class="hint" style="padding:0 16px 12px">A window shows only once that many days exist on both sides of the refresh. Before vs after cannot rule out seasons or Google updates; the Fix tracker also compares with the whole site.</p></div>` : ''}</section>`;
    }
    if (tab === 'ai') {
      html += sampleNote + `<section class="panel"><div class="panel-h"><h2>Visibility in AI answers</h2><p>Upload the results of a fixed set of core queries run through ChatGPT, Perplexity, Google AI Overviews and Gemini (for example the team’s prompt tracker): query, engine, mentioned (yes / no), cited (yes / no), cited URL, run date and an optional cluster. Keep the query set and method the same every month.</p></div><div class="panel-b">${upl('ai', 'Upload AI answer results', true)}${ai && !ai.ok ? `<p class="start-error">${esc(ai.error)}</p>` : ''}<p class="hint">Google’s own numbers for AI Overviews and AI Mode appearances: <a href="#genai">Generative AI report</a>.</p></div></section>`;
      if (ai && ai.ok) {
        const engs = ai.engines.map(e => e.engine);
        html += `<div class="un-kpis">${kp('Mentioned', pct1(ai.total.mention), '', `${fmtN(ai.total.runs)} answers checked · ${fmtN(ai.total.queries)} queries`)}${kp('Cited (linked to unstop.com)', pct1(ai.total.cite), '', '')}${ai.engines.slice(0, 4).map(e => kp(e.engine, pct1(e.mention), '', 'mentioned · cited ' + pct1(e.cite))).join('')}</div>
          <section class="panel"><div class="panel-h"><h2>Trend by month</h2><p>Mention rate per engine.</p></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Month</th><th class="r">Answers</th><th class="r">Mentioned</th><th class="r">Cited</th>${engs.map(e => `<th class="r">${esc(e)}</th>`).join('')}</tr></thead><tbody>${ai.trend.map(t => `<tr><td>${esc(t.month)}</td><td class="r">${fmtN(t.runs)}</td><td class="r">${pct1(t.mention)}</td><td class="r">${pct1(t.cite)}</td>${engs.map(e => `<td class="r">${pct1(t.byEngine[e])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div></section>
          ${ai.clusters.length ? `<section class="panel"><div class="panel-h"><h2>By cluster</h2></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Cluster</th><th class="r">Queries</th><th class="r">Mentioned</th><th class="r">Cited</th></tr></thead><tbody>${ai.clusters.map(c => `<tr><td><b>${esc(c.cluster)}</b></td><td class="r">${c.queries}</td><td class="r">${pct1(c.mention)}</td><td class="r">${pct1(c.cite)}</td></tr>`).join('')}</tbody></table></div></div></section>` : ''}
          <section class="panel"><div class="panel-h"><h2>Core queries</h2><p>Lowest mention rate first: these are the gaps.</p></div>${table('t-un-scq', [{ k: 'q', l: 'Query', cls: 'q' }, { k: 'cluster', l: 'Cluster' }, { k: 'mention', l: 'Mentioned', r: 1, f: r => pct1(r.mention) }, { k: 'cite', l: 'Cited', r: 1, f: r => pct1(r.cite) }, { k: 'engines', l: 'Mentioned by' }, { k: 'citedBy', l: 'Cited by' }], ai.queries, { sort: 'mention', dir: 1, file: 'unstop-ai-queries', pageSize: 20, placeholder: 'Filter queries' })}</section>
          ${ai.urls.length ? `<section class="panel"><div class="panel-h"><h2>Unstop pages cited</h2></div>${table('t-un-scu', [{ k: 'path', l: 'Page', cls: 'u', f: r => `<a href="${esc(focusHref({ u: r.path }))}">${esc(r.path)}</a>`, csv: r => r.path }, { k: 'n', l: 'Citations', r: 1 }], ai.urls, { search: false, file: 'unstop-ai-cited-pages', pageSize: 15 })}</section>` : ''}`;
      }
      html += M ? `<section class="panel"><div class="panel-h"><h2>Referral traffic from AI assistants (GA4)</h2><p>All channels, vs the same dates last year. Sources matched: ${esc(s.aiSources.slice(0, 8).join(', '))}…</p></div>${table('t-un-scr', [{ k: 'source', l: 'Assistant', f: r => `<b>${esc(r.source)}</b>` }, { k: 'sessions', l: 'Sessions', r: 1, f: r => fmtN(Math.round(r.sessions)) + ' ' + dchip(r.dSessions) }, { k: 'engRate', l: 'Engagement rate', r: 1, f: r => pct1(r.engRate) }, { k: 'keyEvents', l: 'Key events', r: 1, f: r => fmtN(Math.round(r.keyEvents)) }, { k: 'newUsers', l: 'New users', r: 1, f: r => fmtN(Math.round(r.newUsers)) }], M.ai, { search: false, file: 'unstop-ai-referrals', pageSize: 15 })}</section>` : '<div class="note"><a href="#ga4">Connect GA4</a> for referral traffic from AI assistants.</div>';
    }
    const mount = () => {
      ['t-un-scp', 't-un-scc', 't-un-sce', 't-un-sct', 't-un-scm', 't-un-scl', 't-un-scd', 't-un-scq', 't-un-scu', 't-un-scr'].forEach(drawTable);
      const $ = id => document.getElementById(id);
      const bind = (id, model) => {
        const f = $('un-sc-' + id); if (f) f.addEventListener('change', async () => { const file = f.files[0]; if (!file) return; try { const rows = await readSheet(file); X[id] = { rows, name: file.name, at: Date.now(), res: model ? model(rows) : null }; } catch (e) { X[id] = { rows: [], name: file.name, res: { ok: false, error: e.message } }; } rerender(); });
        const c = $('un-sc-' + id + '-clear'); if (c) c.addEventListener('click', () => { delete X[id]; rerender(); });
      };
      bind('crawl', rows => SC.crawlModel(rows, sectioner(D))); bind('pub'); bind('links'); bind('ai');
      const T = { pub: 'URL,Publish date,Template\nhttps://unstop.com/internship/data-analyst-internship,2026-06-12,Programmatic: Internships\nhttps://unstop.com/blog/tcs-nqt-exam-pattern,2026-07-01,Blog\n', links: 'Referring domain,Domain rating,First seen,Target URL,Link type\nexample-news.com,62,2026-09-14,https://unstop.com/employers/ats-software,dofollow\n', ai: 'Query,Engine,Mentioned,Cited,Cited URL,Date,Cluster\nbest platform for hackathons in india,ChatGPT,yes,no,,2026-10-15,Student\nbest platform for hackathons in india,Perplexity,yes,yes,https://unstop.com/hackathons,2026-10-15,Student\n' };
      Object.keys(T).forEach(k => { const b = $('un-sc-' + k + '-tpl'); if (b) b.addEventListener('click', () => download(k + '-template.csv', T[k])); });
      const pg = $('un-psi-go'); if (pg) pg.addEventListener('click', () => runPsi(A, D));
      const ig = $('un-insp-go'); if (ig) ig.addEventListener('click', () => runInspect(A, D, 10));
      const rg = $('un-rf-go'); if (rg) rg.addEventListener('click', () => measureRefreshes(A, D));
      if (tab === 'refresh' && !X.refresh && refreshList(A, D).list.length) measureRefreshes(A, D);
    };
    return { html, mount };
  };

  // ════════════════════════════ REVIEWS (cadence) ════════════════════════════
  // Weekly leading indicators, monthly full chain by page type, quarterly revenue / cost / stop-or-scale,
  // the first-review pack (three questions) and attribution health between GA4, MoEngage and the CRM.
  const DKEY = site => 'un:decisions:' + site;
  const decisions = site => { try { const v = JSON.parse(localStorage.getItem(DKEY(site))); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const saveDecisions = (site, list) => { try { localStorage.setItem(DKEY(site), JSON.stringify(list.slice(-500))); } catch (e) { } };
  let REVMSG = '';
  function healthOf(D) {
    const AQ = acqModel(D), ga = AQ.ga, g = GA.get(D.site), m = MOE.get(D.site), ml = moeLive(D), C = crmOf(D);
    const notSet = ga ? (() => { const t = ga.pages.reduce((a, p) => a + p.sessions, 0), n = ga.pages.filter(p => /not set/i.test(p.path)).reduce((a, p) => a + p.sessions, 0); return t ? n / t * 100 : null; })() : null;
    const res = m && m.res && m.res.ok ? m.res : null;
    return U.attributionHealth({
      ga: ga ? { signups: ga.ev.stu + ga.ev.emp, leads: ga.ev.demo + ga.ev.contact, notSetShare: notSet } : null,
      moe: res || ml ? { hasSource: res ? res.has.source : true, notSetShare: res ? (res.sources.filter(x => /not set/i.test(x.source)).reduce((a, x) => a + x.users, 0) / Math.max(1, res.total) * 100) : null, organicSignups: AQ.moeSignups } : null,
      crm: C ? { source: C.res.coverage.source, journey: C.res.hasJourney, landing: C.res.coverage.landing, amount: C.res.coverage.amount, stage: C.res.coverage.stage, organicLeads: g ? C.res.ftBetween(g.start, g.end) : null } : null
    });
  }
  function healthTable(H) {
    const st = { ok: '<span class="un-st live">OK</span>', warn: '<span class="un-st sample">Check</span>', fail: '<span class="un-st bad">Fix</span>', none: '<span class="un-st none">Not connected</span>' };
    return `<div class="tw"><table class="un-mini"><thead><tr><th>Source</th><th>Check</th><th>Status</th><th class="r">Value</th><th>What to fix</th></tr></thead><tbody>${H.checks.map(c => `<tr><td>${esc(c.area)}</td><td><b>${esc(c.label)}</b></td><td>${st[c.state]}</td><td class="r">${esc(String(c.value))}</td><td><small>${c.state === 'ok' ? '—' : esc(c.fix)}</small></td></tr>`).join('')}</tbody></table></div>`;
  }
  function decisionBlock(D, cadence) {
    const list = decisions(D.site).filter(d => d.cadence === cadence).slice().reverse();
    return `<section class="panel"><div class="panel-h"><h2>Decisions and owners (${esc(cadence)})</h2><p>Log what the review decided, who owns it and by when. Kept in this browser; export to share.</p></div><div class="panel-b">
      <form class="un-row" id="un-dec-form" data-cadence="${esc(cadence)}"><label class="field un-grow"><span>Decision / action</span><input type="text" id="un-dec-what" required maxlength="300"></label><label class="field"><span>Owner</span><input type="text" id="un-dec-owner" required maxlength="80"></label><label class="field"><span>Due</span><input type="date" id="un-dec-due"></label><button class="btn-primary sm" type="submit">Add</button><button class="btn-quiet" type="button" id="un-dec-export">Export CSV</button></form></div>
      ${list.length ? `<div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Logged</th><th>Decision / action</th><th>Owner</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>${list.map(d => `<tr><td>${esc(d.date)}</td><td>${esc(d.what)}</td><td>${esc(d.owner)}</td><td>${esc(d.due || '—')}</td><td><select data-dec-st="${esc(d.id)}">${['Open', 'Done', 'Dropped'].map(x => `<option ${d.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></td><td><button class="btn-quiet sm" type="button" data-dec-del="${esc(d.id)}">Remove</button></td></tr>`).join('')}</tbody></table></div></div>` : ''}</section>`;
  }
  function decisionMount(D) {
    const f = document.getElementById('un-dec-form'); if (!f) return;
    f.addEventListener('submit', e => { e.preventDefault(); const l = decisions(D.site); l.push({ id: 'd' + Date.now().toString(36), cadence: f.dataset.cadence, date: new Date().toISOString().slice(0, 10), what: document.getElementById('un-dec-what').value.trim(), owner: document.getElementById('un-dec-owner').value.trim(), due: document.getElementById('un-dec-due').value, status: 'Open' }); saveDecisions(D.site, l); rerender(); });
    document.getElementById('un-dec-export').addEventListener('click', () => { const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; download('unstop-seo-decisions.csv', ['Cadence,Logged,Decision,Owner,Due,Status'].concat(decisions(D.site).map(d => [d.cadence, d.date, d.what, d.owner, d.due, d.status].map(cell).join(','))).join('\n')); });
    document.querySelectorAll('[data-dec-st]').forEach(s => s.addEventListener('change', () => { const l = decisions(D.site); const d = l.find(x => x.id === s.dataset.decSt); if (d) d.status = s.value; saveDecisions(D.site, l); }));
    document.querySelectorAll('[data-dec-del]').forEach(b => b.addEventListener('click', () => { saveDecisions(D.site, decisions(D.site).filter(x => x.id !== b.dataset.decDel)); rerender(); }));
  }
  function periodBar(D, p, what) {
    const P = window.UN_PERIOD, g = GA.get(D.site);
    const gscOk = U.periodMatch(D, p), gaOk = g && g.start === p.start && g.end === p.end;
    const live = P && P.live();
    return `<div class="note un-period ${gscOk && (gaOk || !g) ? '' : 'un-warn'}"><b>${esc(what)}: ${esc(p.label)}</b> (${fmtD(p.start)} – ${fmtD(p.end)}). Loaded: Search Console ${fmtD(D.start)} – ${fmtD(D.end)}${gscOk ? ' ✓' : ''}${g ? ` · GA4 ${fmtD(g.start)} – ${fmtD(g.end)}${gaOk ? ' ✓' : ''}` : ''}.
      ${gscOk && (gaOk || !g) ? '' : live ? ` <button class="btn-primary sm" type="button" id="un-rev-load" data-s="${p.start}" data-e="${p.end}">Load ${esc(p.label)}</button> <span class="progress" id="un-rev-prog"></span>` : ' Sample data and uploads keep their own dates; with Search Console connected this button loads the review period.'}
      ${REVMSG ? `<br><span class="start-error">${esc(REVMSG)}</span>` : ''}</div>`;
  }
  function periodMount(D) {
    const b = document.getElementById('un-rev-load'); if (!b) return;
    b.addEventListener('click', async () => {
      const s = b.dataset.s, e = b.dataset.e, site = D.site, p = document.getElementById('un-rev-prog');
      b.disabled = true; REVMSG = ''; if (p) p.textContent = 'Loading Search Console…';
      const err = await window.UN_PERIOD.load(s, e);
      if (err) { REVMSG = err; rerender(); return; }
      const g = GA.get(site), prop = (g && !g.sample && g.property) || settings(site).ga4Property;
      if (prop && token()) { try { await loadGa4({ site }, { property: prop, propertyName: g && g.propertyName, start: s, end: e }); } catch (x) { REVMSG = 'GA4: ' + x.message; } }
      rerender();
    });
  }
  const REV_TABS = [['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['first', 'First review'], ['attribution', 'Attribution health']];
  V.reviews = (A, D) => {
    demoFill(D); scSamples(A, D);
    window.CW_LAST_A = A;
    Object.keys(TABLES).filter(k => k.startsWith('t-un-rv')).forEach(k => delete TABLES[k]);
    const tab = fParams().get('r') || 'weekly', s = settings(D.site);
    const latest = window.UN_PERIOD && window.UN_PERIOD.live() ? window.UN_PERIOD.latest() : D.end;
    const PR = U.reviewPeriods(latest);
    const kp = (l, v, d, sub) => `<div class="un-kpi"><span>${esc(l)}</span><b>${v}</b><small>${d || ''} ${sub || ''}</small></div>`;
    const pts = (a, b) => a == null || b == null ? '' : `<span class="un-d ${a - b > 0 ? 'up' : a - b < 0 ? 'down' : 'flat'}">${a - b > 0 ? '+' : ''}${(a - b).toFixed(1)} pts</span>`;
    const G = gscModel(A, D), AQ = acqModel(D), ga = AQ.ga, { typeOf } = tools(D), so = sectioner(D), H = healthOf(D);
    let html = head('Reviews', 'Weekly review of leading indicators, monthly review of the full chain by page type, quarterly review of revenue, cost and what to stop, the first-review pack and attribution health.') +
      `<div class="un-tabs" role="tablist">${REV_TABS.map(([k, l]) => `<a role="tab" class="${k === tab ? 'on' : ''}" href="#reviews?r=${k}">${l}${k === 'attribution' ? ` <small>${H.ok}/${H.total}</small>` : ''}</a>`).join('')}</div>`;
    let tables = [];
    if (tab === 'weekly') {
      const site = A.site, ps = A.prevSite, tr = G.ranks.total;
      html += periodBar(D, PR.week, 'Weekly review') + `<h2 class="un-sub">Leading indicators vs the previous period</h2><div class="un-kpis">
        ${kp('Impressions', fmtN(site.impr), ps ? dchip(U.chg(site.impr, ps.impr)) : '', '')}${kp('Clicks', fmtN(site.clicks), ps ? dchip(U.chg(site.clicks, ps.clicks)) : '', '')}
        ${kp('Non-branded clicks', fmtN(A.totNB.clicks), A.prev ? dchip(U.chg(A.totNB.clicks, A.prev.nb.clicks)) : '', '')}${kp('Average position', site.pos ? site.pos.toFixed(1) : '—', ps && ps.pos ? dchip(site.pos - ps.pos, true, 'pos') : '', '')}
        ${kp('NB keywords in top 10', fmtN(tr.n.top10), G.ranks.hasPrev ? cnt(tr.n.top10, tr.pn.top10, true).replace(/^[^<]*/, '') : '', 'top 3: ' + fmtN(tr.n.top3))}${kp('NB keywords 11–20', fmtN(tr.n.p11), G.ranks.hasPrev ? cnt(tr.n.p11, tr.pn.p11, true).replace(/^[^<]*/, '') : '', 'quick wins')}
        ${kp('Pages getting impressions', fmtN(G.vis.rows.reduce((a, r) => a + r.urls, 0)), '', 'indexed and visible')}${kp('Indexed (latest inspection)', (() => { const h = techHist(D.site).filter(x => x.kind === 'inspect').pop(); return h ? pct1(h.indexedPct) : scd(D.site).insp ? pct1(scd(D.site).insp.rows.filter(r => r.indexed).length / Math.max(1, scd(D.site).insp.rows.length) * 100) : '—'; })(), '', '<a href="#scorecards?w=tech">run on Technical SEO</a>')}
      </div>
      <section class="panel"><div class="panel-h"><h2>By page type</h2><p>Branded and non-branded apart.</p></div>${table('t-un-rvw', [{ k: 'name', l: 'Page type', f: r => `<b>${esc(r.name)}</b>` }, { k: 'impr', l: 'Impressions', r: 1, f: r => fmtN(r.impr) + ' ' + dchip(r.dImpr) }, { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) + ' ' + dchip(r.dClicks) }, { k: 'nb', l: 'Non-branded clicks (est.)', r: 1, f: r => r.estNB ? fmtN(r.estNB.clicks) : '—', csv: r => r.estNB ? Math.round(r.estNB.clicks) : '' }, { k: 'pos', l: 'Position', r: 1, f: r => posTag(r.pos) + ' ' + dchip(r.dPos, true, 'pos'), csv: r => r.pos }, { k: 'urls', l: 'Pages with impressions', r: 1, f: r => fmtN(r.urls) }], G.vis.rows, { search: false, file: 'unstop-weekly-by-page-type', pageSize: 20 })}</section>
      <section class="panel"><div class="panel-h"><h2>Rankings by page type</h2></div>${table('t-un-rvr', [{ k: 'name', l: 'Page type', f: r => `<b>${esc(r.name)}</b>` }, { k: 'n3', l: 'NB top 3', r: 1, f: r => cnt(r.n.top3, r.pn.top3, G.ranks.hasPrev) }, { k: 'n10', l: 'NB top 10', r: 1, f: r => cnt(r.n.top10, r.pn.top10, G.ranks.hasPrev) }, { k: 'n11', l: 'NB 11–20', r: 1, f: r => cnt(r.n.p11, r.pn.p11, G.ranks.hasPrev) }, { k: 'b10', l: 'Branded top 10', r: 1, f: r => cnt(r.b.top10, r.pb.top10, G.ranks.hasPrev) }], G.ranks.byType.map(bucketRow), { search: false, file: 'unstop-weekly-rankings', pageSize: 20 })}</section>
      <p class="hint">Cluster detail: <a href="#urlclusters">Clusters</a> · indexation and crawl: <a href="#scorecards?w=tech">Technical SEO</a> · sitemaps: <a href="#visibility">Visibility</a>.</p>` + decisionBlock(D, 'Weekly');
      tables = ['t-un-rvw', 't-un-rvr'];
    }
    if (tab === 'monthly') {
      const chain = U.joinChain(G.vis, ga, typeOf).filter(r => (r.gsc && r.gsc.impr) || (r.ga && r.ga.sessions));
      const V0 = AQ.verdict, AS = ga ? assistedOf(D) : null;
      html += periodBar(D, PR.month, 'Monthly review') + (ga ? `<h2 class="un-sub">The chain</h2><div class="un-kpis">
        ${kp('Organic sessions', fmtN(ga.total.sessions), dchip(ga.dSessions), 'vs last year')}${kp('Student signups', fmtN(Math.round(AQ.stu)), dchip(U.chg(AQ.stu, AQ.yStu)), 'CVR ' + pct1(AQ.cvrStu))}${kp('Employer signups', fmtN(Math.round(AQ.emp)), dchip(U.chg(AQ.emp, AQ.yEmp)), 'CVR ' + pct1(AQ.cvrEmp))}${kp('Signup quality', V0 ? (V0.ok ? 'Volume counts' : 'Volume is not a win') : '—', '', V0 ? `${V0.better} better · ${V0.worse} worse vs other channels` : '<a href="#quality">connect MoEngage</a>')}
        ${kp('Engagement rate', pct1(ga.total.engRate), '', '')}${kp('Demo + contact', fmtN(Math.round(ga.ev.demo + ga.ev.contact)), dchip(U.chg(ga.ev.demo + ga.ev.contact, ga.ev.yDemo + ga.ev.yContact)), 'vs last year')}${kp('Assisted employer conversions', AS ? fmtN(Math.round(AS.cur.assisted.total)) : '—', '', 'organic first, closed elsewhere')}${kp('Pricing-page sessions', fmtN(Math.round(ga.pricing.sessions)), dchip(U.chg(ga.pricing.sessions, ga.pricing.ySessions)), '')}
      </div>` : '<div class="note"><a href="#ga4">Connect GA4</a> for traffic, signups and leads.</div>') +
      `<section class="panel"><div class="panel-h"><h2>Traffic → signups → leads by page type</h2><p>Search Console vs the previous period; GA4 vs the same dates last year (traffic is seasonal).</p></div>${table('t-un-rvm', [
        { k: 'name', l: 'Page type', f: r => `<b>${esc(r.name)}</b>` }, { k: 'clicks', l: 'Clicks', r: 1, f: r => r.gsc ? fmtN(r.gsc.clicks) + ' ' + dchip(r.gsc.dClicks) : '—', csv: r => r.gsc ? r.gsc.clicks : '' }, { k: 'nb', l: 'NB clicks (est.)', r: 1, f: r => r.gsc && r.gsc.estNB ? fmtN(r.gsc.estNB.clicks) : '—', csv: r => r.gsc && r.gsc.estNB ? Math.round(r.gsc.estNB.clicks) : '' },
        { k: 'sessions', l: 'Organic sessions', r: 1, f: r => r.ga ? fmtN(r.ga.sessions) + ' ' + dchip(r.ga.dSessions) : '—', csv: r => r.ga ? r.ga.sessions : '' }, { k: 'stu', l: 'Student signups', r: 1, f: r => r.ga ? fmtN(r.ga.stu) : '—', csv: r => r.ga ? r.ga.stu : '' }, { k: 'emp', l: 'Employer signups', r: 1, f: r => r.ga ? fmtN(r.ga.emp) : '—', csv: r => r.ga ? r.ga.emp : '' }, { k: 'cvr', l: 'Signup CVR', r: 1, f: r => r.ga ? pct1(r.ga.cvr) : '—', csv: r => r.ga ? r.ga.cvr : '' }, { k: 'opp', l: 'Register / apply', r: 1, f: r => r.ga ? fmtN(r.ga.opp) : '—', csv: r => r.ga ? r.ga.opp : '' }, { k: 'leads', l: 'Demo + contact', r: 1, f: r => r.ga ? fmtN(r.ga.demo + r.ga.contact) : '—', csv: r => r.ga ? r.ga.demo + r.ga.contact : '' }
      ], chain.map(r => ({ ...r, clicks: r.gsc ? r.gsc.clicks : -1, sessions: r.ga ? r.ga.sessions : -1 })), { search: false, file: 'unstop-monthly-chain-by-page-type', pageSize: 20 })}</section>
      <p class="hint">Deeper: <a href="#acquisition">User acquisition</a> · <a href="#engagement">Engagement</a> · <a href="#leads">Leads & revenue</a> · <a href="#scorecards">Workstream scorecards</a>.</p>` + decisionBlock(D, 'Monthly');
      tables = ['t-un-rvm'];
    }
    if (tab === 'quarterly') {
      const C = crmOf(D), X = scd(D.site), pub = X.pub ? SC.publishingModel(X.pub.rows, A.P, so, D.end) : null, links = X.links ? SC.linksModel(X.links.rows, A, D, so) : null, ai = X.ai ? SC.aiModel(X.ai.rows) : null;
      const qKey = PR.quarter.start.slice(0, 4) + '-Q' + (Math.floor((+PR.quarter.start.slice(5, 7) - 1) / 3) + 1);
      const Q = C ? C.res.quarterly : [], q = Q.find(x => x.quarter === qKey);
      const qCost = AQ.cost ? AQ.cost * 3 : null, roi = q && qCost ? q.ft.revenue / qCost : null;
      const clusters = ga ? (() => { const m = new Map(); ga.pages.forEach(p => { const id = so(p.path); const o = m.get(id) || { name: so.label(id), sessions: 0, ySessions: 0, signups: 0 }; o.sessions += p.sessions; o.ySessions += p.ySessions; o.signups += p.signups; m.set(id, o); }); return [...m.values()].map(o => ({ ...o, cvr: o.sessions ? o.signups / o.sessions * 100 : null, dSessions: U.chg(o.sessions, o.ySessions) })); })() : [];
      const rf = X.refresh && X.refresh.rows ? X.refresh.rows.filter(r => r.w && r.w[0].status === 'measured' && r.w[0].window.L >= 28) : [];
      const calls = U.stopContinueScale({ templates: pub && pub.ok ? pub.byTemplate : [], clusters, links: links && links.ok ? links : null, refresh: rf.length ? { measured: rf.length, improved: rf.filter(r => /improved/.test(r.w[0].verdict)).length } : null, ai: ai && ai.ok ? ai : null, quality: AQ.verdict, roi });
      html += periodBar(D, PR.quarter, 'Quarterly review') + `<h2 class="un-sub">Revenue and cost</h2><div class="un-kpis">
        ${kp('Revenue: organic first touch', q ? inr(q.ft.revenue) : '—', '', q ? `${fmtN(q.ft.won)} won · ${esc(qKey)}` : C ? 'no leads in ' + esc(qKey) : '<a href="#leads">upload CRM export</a>')}
        ${kp('Revenue: organic in the journey', q && C.res.hasJourney ? inr(q.assisted.revenue) : '—', '', 'reported apart')}
        ${kp('Pipeline: organic first touch', q ? inr(q.ft.pipeline) : '—', '', q ? fmtN(q.ft.opps) + ' opportunities' : '')}
        ${kp('SEO cost in the quarter', qCost ? inr(qCost) : '—', '', qCost ? `₹${fmtN(AQ.cost)} × 3 months${AQ.costSample ? ' (sample)' : ''}` : '<a href="#funnelsetup">add monthly cost</a>')}
        ${kp('Revenue ÷ cost (first touch)', roi != null ? roi.toFixed(1) + '×' : '—', '', '')}
        ${kp('Cost per student signup', AQ.cpsStu != null ? inr(AQ.cpsStu) : '—', '', 'loaded period')}${kp('Cost per employer signup', AQ.cpsEmp != null ? inr(AQ.cpsEmp) : '—', '', 'loaded period')}
      </div>` +
      (Q.length ? `<section class="panel"><div class="panel-h"><h2>By quarter (CRM)</h2></div><div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Quarter</th><th class="r">Organic FT leads</th><th class="r">FT pipeline</th><th class="r">FT revenue</th><th class="r">Assisted pipeline</th><th class="r">Assisted revenue</th><th class="r">All leads</th><th class="r">Organic share of revenue</th></tr></thead><tbody>${Q.slice(-6).map(x => `<tr${x.quarter === qKey ? ' class="on"' : ''}><td><b>${esc(x.quarter)}</b></td><td class="r">${fmtN(x.ft.leads)}</td><td class="r">${inr(x.ft.pipeline)}</td><td class="r">${inr(x.ft.revenue)}</td><td class="r">${C.res.hasJourney ? inr(x.assisted.pipeline) : '—'}</td><td class="r">${C.res.hasJourney ? inr(x.assisted.revenue) : '—'}</td><td class="r">${fmtN(x.all.leads)}</td><td class="r">${x.all.revenue ? pct1(x.ft.revenue / x.all.revenue * 100) : '—'}</td></tr>`).join('')}</tbody></table></div></div></section>` : '') +
      `<section class="panel"><div class="panel-h"><h2>What to stop, fix, continue or scale</h2><p>Suggestions from the evidence on the other screens (programmatic templates, clusters, link building, refreshes, AI answers, signup quality, revenue ÷ cost). The review decides; log the decision below.</p></div>${calls.length ? `<div class="panel-b flush"><div class="tw"><table class="un-mini"><thead><tr><th>Call</th><th>Workstream</th><th>Item</th><th>Why</th></tr></thead><tbody>${calls.map(c => `<tr><td><span class="un-st ${c.call === 'Stop' ? 'bad' : c.call === 'Fix' ? 'sample' : c.call === 'Scale' ? 'live' : 'none'}">${esc(c.call)}</span></td><td>${esc(c.area)}</td><td><b>${esc(c.item)}</b></td><td><small>${esc(c.why)}</small></td></tr>`).join('')}</tbody></table></div></div>` : '<div class="panel-b"><p class="empty">Not enough evidence loaded yet: add the publishing log, backlinks, refreshes and CRM export.</p></div>'}</section>` + decisionBlock(D, 'Quarterly');
    }
    if (tab === 'first') {
      const q1 = U.topSignupPages(ga, 15), q2 = U.nonBrandedSignupShare(ga, D, brandOf(A)), C = crmOf(D);
      html += periodBar(D, PR.month, 'First review (last month)') + `<div class="note">Attribution health: <b>${H.ok} of ${H.total}</b> checks pass${H.missing ? `, ${H.missing} source${H.missing === 1 ? '' : 's'} not connected` : ''}. ${H.ready ? 'Numbers below can be shared.' : '<b>Fix attribution before presenting pipeline or revenue as SEO impact.</b>'} <a href="#reviews?r=attribution">Details</a></div>
      <section class="panel"><div class="panel-h"><h2>1. Which pages drove the most signups last month (not the most traffic)?</h2></div>${ga && q1.length ? table('t-un-rv1', [{ k: 'path', l: 'Landing page', cls: 'u', f: r => `<a href="${esc(focusHref({ u: r.path }))}">${esc(r.path)}</a>`, csv: r => r.path }, { k: 'cluster', l: 'Cluster' }, { k: 'folder', l: 'Folder', f: r => `<code>${esc(r.folder)}</code>`, csv: r => r.folder }, { k: 'signups', l: 'Signups', r: 1, f: r => fmtN(r.signups) }, { k: 'stu', l: 'Student', r: 1, f: r => fmtN(r.stu) }, { k: 'emp', l: 'Employer', r: 1, f: r => fmtN(r.emp) }, { k: 'sessions', l: 'Sessions', r: 1, f: r => fmtN(r.sessions) }, { k: 'cvr', l: 'CVR', r: 1, f: r => pct1(r.cvr) }, { k: 'trank', l: 'Traffic rank', r: 1 }], withCluster(D, q1, r => r.path).map(r => ({ ...r, trank: ga.pages.slice().sort((a, b) => b.sessions - a.sessions).findIndex(p => p.path === r.path) + 1 })), { search: false, sort: 'signups', file: 'unstop-q1-signup-pages', pageSize: 15 }) + '<p class="hint" style="padding:0 16px 12px">“Traffic rank” shows where the page sits by organic sessions, to see signups and traffic apart.</p>' : '<div class="panel-b"><p class="empty"><a href="#ga4">Connect GA4</a> and set the signup events.</p></div>'}</section>
      <section class="panel"><div class="panel-h"><h2>2. What share of organic signups comes from non-branded queries?</h2></div><div class="panel-b">${q2 ? `<div class="un-big"><b>${pct1(q2.share)}</b><span>estimated non-branded share of organic signups (labelled estimate)</span></div><p class="hint">Each landing page’s signups × the non-branded share of that page’s Search Console clicks. Covers ${pct1(q2.coverage)} of organic signups; Search Console never ties a query to a signup.</p>` : '<p class="empty">Needs GA4 signups and Search Console query × page rows.</p>'}</div></section>
      <section class="panel"><div class="panel-h"><h2>3. How much pipeline can we trace to organic?</h2></div><div class="panel-b">${C ? (() => { const mr = C.res.monthly.find(m => m.month === PR.month.start.slice(0, 7)); return mr ? `<p class="un-meta">Leads created in ${esc(PR.month.label)}:</p><div class="un-kpis">${kp('Organic first touch', inr(mr.ft.pipeline), '', `${fmtN(mr.ft.opps)} opportunities · ${inr(mr.ft.revenue)} won`)}${kp('Organic in the journey', C.res.hasJourney ? inr(mr.assisted.pipeline) : '—', '', C.res.hasJourney ? `${fmtN(mr.assisted.opps)} opportunities` : 'needs a journey column')}${kp('Organic first-touch leads', fmtN(mr.ft.leads), '', `of ${fmtN(mr.all.leads)} leads`)}</div><p class="un-meta">Whole CRM file:</p>` : ''; })() + `<div class="un-kpis">${kp('Organic first touch', inr(C.res.ft.pipeline), '', `${fmtN(C.res.ft.opps)} opportunities · ${inr(C.res.ft.revenue)} won`)}${kp('Organic in the journey', C.res.hasJourney ? inr(C.res.assisted.pipeline) : '—', '', C.res.hasJourney ? `${fmtN(C.res.assisted.opps)} opportunities · ${inr(C.res.assisted.revenue)} won` : 'needs a journey column')}${kp('Lead → opportunity', pct1(C.res.ft.toOpp), pts(C.res.ft.toOpp, C.res.other.toOpp), 'vs other channels')}${kp('Lead source coverage', pct1(C.res.coverage.source), '', 'of CRM leads')}</div>` : '<p class="empty"><a href="#leads">Upload the CRM export</a>.</p>'}</div></section>`;
      tables = ['t-un-rv1'];
    }
    if (tab === 'attribution') {
      html += `<section class="panel"><div class="panel-h"><h2>Attribution health: GA4 × product database × CRM</h2><p>${H.ok} of ${H.total} checks pass${H.missing ? ` · ${H.missing} source${H.missing === 1 ? '' : 's'} not connected` : ''}. Fix these first: until they pass, organic pipeline and revenue cannot be reported with confidence.</p></div><div class="panel-b flush">${healthTable(H)}</div></section>
      <section class="panel"><div class="panel-h"><h2>How the three systems join</h2></div><div class="panel-b"><ol class="un-steps">
        <li><b>GA4 → product database:</b> on signup, store the session’s source / medium and landing page (or the GA4 client ID) on the user record, and pass them to MoEngage as user attributes. Then organic signups in GA4 and MoEngage can be reconciled and signup quality split by channel.</li>
        <li><b>GA4 → CRM:</b> every employer form (demo, contact, signup) sends hidden fields: original source, medium, first page seen and GA4 client ID. That is the join key between the website session and the lead.</li>
        <li><b>CRM → revenue:</b> deals are associated with the lead, with amount and stage, and the lead keeps both the original source (first touch) and the list of touches (journey).</li>
        <li><b>Reconcile monthly:</b> the checks above compare GA4 with MoEngage and with the CRM over the same dates; a gap over ~20% means a source field is being lost.</li>
      </ol></div></section>`;
    }
    const mount = () => { tables.forEach(drawTable); decisionMount(D); periodMount(D); };
    return { html, mount };
  };

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
    const AQ = acqModel(D);
    const pathCov = ga && ga.pathCov ? ga.pathCov.share : null;
    const EN = ga ? engModel(D) : null;
    const ASt = ga ? assistedOf(D) : null, CR = crmOf(D), crmSt = CR ? (CR.sample ? 'sample' : 'file') : 'none';
    const aiS = ga ? ga.ai.reduce((a, r) => a + r.sessions, 0) : null, aiY = ga ? ga.ai.reduce((a, r) => a + r.ySessions, 0) : null;
    const V2 = {
      impr: [fmtN(site.impr), ps ? U.chg(site.impr, ps.impr) : null, gscSt, gscAt],
      clicks: [fmtN(site.clicks), ps ? U.chg(site.clicks, ps.clicks) : null, gscSt, gscAt],
      ctr: [pct1(site.ctr), ps ? U.chg(site.ctr, ps.ctr) : null, gscSt, gscAt],
      pos: [site.pos ? site.pos.toFixed(1) : '—', ps && ps.pos && site.pos ? site.pos - ps.pos : null, gscSt, gscAt, 'pos'],
      nbClicks: [fmtN(nbTot.clicks), A.prev ? U.chg(nbTot.clicks, A.prev.nb.clicks) : null, gscSt, gscAt, null, `${pct1(nbTot.clicks / Math.max(1, nbTot.clicks + bTot.clicks) * 100)} of query clicks`],
      sov: (() => { const M2 = sovOf(D); const me = M2 && M2.ok ? M2.cur.per.find(x => x.own) : null; return me ? [pct1(me.sov), me.dSov, scd(D.site).sov.sample ? 'sample' : 'file', null, 'pp', `vs ${compOf(s).length} competitors · ${M2.cur.keywords} keywords`] : null; })(),
      top10: [fmtN(tr.n.top10), G.ranks.hasPrev ? U.chg(tr.n.top10, tr.pn.top10) : null, gscSt, gscAt, null, `top 3: ${fmtN(tr.n.top3)}`],
      p11: [fmtN(tr.n.p11), G.ranks.hasPrev ? U.chg(tr.n.p11, tr.pn.p11) : null, gscSt, gscAt],
      indexed: [fmtN(visUrls), prevUrls ? U.chg(visUrls, prevUrls) : null, gscSt, gscAt, null, A.coverage && A.coverage.rowLimit ? 'capped by row limit' : ''],
      sessions: ga ? [fmtN(ga.total.sessions), ga.dSessions, gaSt, g.at, null, 'vs last year'] : null,
      newUsers: ga ? [fmtN(ga.total.newUsers), ga.dNewUsers, gaSt, g.at, null, 'vs last year'] : null,
      pathCov: ga ? [pct1(pathCov), ga.pathCov && ga.pathCov.yShare != null && pathCov != null ? pathCov - ga.pathCov.yShare : null, gaSt, g.at, 'pp', 'vs last year'] : null,
      stu: ga ? [fmtN(ga.ev.stu), U.chg(ga.ev.stu, ga.ev.yStu), gaSt, g.at, null, 'vs last year'] : null,
      emp: ga ? [fmtN(ga.ev.emp), U.chg(ga.ev.emp, ga.ev.yEmp), gaSt, g.at, null, 'vs last year'] : null,
      cvrStu: ga ? [pct1(AQ.cvrStu), AQ.cvrStu != null && AQ.yCvrStu != null ? AQ.cvrStu - AQ.yCvrStu : null, gaSt, g.at, 'pp', 'vs last year'] : null,
      cvrEmp: ga ? [pct1(AQ.cvrEmp), AQ.cvrEmp != null && AQ.yCvrEmp != null ? AQ.cvrEmp - AQ.yCvrEmp : null, gaSt, g.at, 'pp', 'vs last year'] : null,
      cpsStu: ga && AQ.cpsStu != null ? ['₹' + fmtN(Math.round(AQ.cpsStu)), null, 'input', g.at, null, `${100 - AQ.empShare}% of ₹${fmtN(AQ.cost)} / month${AQ.costSample ? ' (sample)' : ''}`] : ga && AQ.cpsAll != null ? ['₹' + fmtN(Math.round(AQ.cpsAll)), null, 'input', g.at, null, 'all signups: set the employer cost share'] : null,
      cpsEmp: ga && AQ.cpsEmp != null ? ['₹' + fmtN(Math.round(AQ.cpsEmp)), null, 'input', g.at, null, `${AQ.empShare}% of ₹${fmtN(AQ.cost)} / month${AQ.costSample ? ' (sample)' : ''}`] : null,
      qcheck: AQ.verdict ? [AQ.verdict.ok ? 'Volume counts' : 'Volume is not a win', null, AQ.qsrc, (ml && ml.at) || (m && m.at), null, AQ.verdict.rows.map(r => `${{ profile: 'profile', act7: '7-day', ret30: '30-day' }[r.k]} ${r.gap > 0 ? '+' : ''}${r.gap.toFixed(1)} pts`).join(' · ')] : null,
      profile: moe && moe.seg.organic.profile ? [pct1(moe.seg.organic.profile.rate), moe.seg.other.profile ? moe.seg.organic.profile.rate - moe.seg.other.profile.rate : null, moeSt, m.at, 'pp', 'vs other channels'] : null,
      act7: moe && moe.seg.organic.act7 ? [pct1(moe.seg.organic.act7.rate), moe.seg.other.act7 ? moe.seg.organic.act7.rate - moe.seg.other.act7.rate : null, moeSt, m.at, 'pp', 'vs other channels'] : null,
      ret30: moe && moe.seg.organic.ret30 ? [pct1(moe.seg.organic.ret30.rate), moe.seg.other.ret30 ? moe.seg.organic.ret30.rate - moe.seg.other.ret30.rate : null, moeSt, m.at, 'pp', 'vs other channels'] : null,
      ...Object.fromEntries(['moeSignups', 'profile', 'act7', 'ret30'].filter(k => mlv[k] && mlv[k].value != null).map(k => { const x = mlv[k]; return [k, x.rate ? [pct1(x.value), x.compare != null ? x.value - x.compare : null, mlSt, ml.at, 'pp', x.compare != null ? 'vs compared rows' : 'MoEngage live'] : [fmtN(Math.round(x.value)), null, mlSt, ml.at, null, x.compare != null ? 'vs ' + fmtN(Math.round(x.compare)) + ' compared' : 'MoEngage live']]; })),
      engaged: EN ? [fmtN(Math.round(EN.engaged)), EN.dEngaged, gaSt, g.at, null, 'vs last year'] : null,
      engRate: EN ? [pct1(EN.engRate), EN.engRate != null && EN.yEngRate != null ? EN.engRate - EN.yEngRate : null, gaSt, g.at, 'pp', 'vs last year'] : null,
      scrollKey: EN && EN.key.length ? [pct1(EN.key.reduce((a, p) => a + p.scroll, 0) / Math.max(1, EN.key.reduce((a, p) => a + p.views, 0)) * 100), null, gaSt, g.at, null, `reach 90% · ${EN.key.length} key pages`] : null,
      pps: EN ? [EN.pps ? EN.pps.toFixed(2) : '—', EN.pps && EN.yPps ? U.chg(EN.pps, EN.yPps) : null, gaSt, g.at, null, 'vs last year'] : null,
      return4w: EN && EN.ret ? [pct1(EN.ret.weeks[3].rate), EN.yRet ? EN.ret.weeks[3].rate - EN.yRet.weeks[3].rate : null, gaSt, g.at, 'pp', 'week 4, vs last year'] : null,
      oppClickShare: EN && EN.actions.oppClick && EN.actions.oppClick.share != null ? [pct1(EN.actions.oppClick.share), EN.actions.yOppClick && EN.actions.yOppClick.share != null ? EN.actions.oppClick.share - EN.actions.yOppClick.share : null, gaSt, g.at, 'pp', 'of organic users'] : null,
      oppShare: EN && EN.actions.opp && EN.actions.opp.share != null ? [pct1(EN.actions.opp.share), EN.actions.yOpp && EN.actions.yOpp.share != null ? EN.actions.opp.share - EN.actions.yOpp.share : null, gaSt, g.at, 'pp', 'of organic users'] : null,
      blogRate: EN && EN.blog.blogViews ? [pct1(EN.blog.rate), EN.blog.yRate != null ? EN.blog.rate - EN.blog.yRate : null, gaSt, g.at, 'pp', 'vs last year'] : null,
      demo: ga ? [fmtN(ga.ev.demo), U.chg(ga.ev.demo, ga.ev.yDemo), gaSt, g.at, null, 'vs last year'] : null,
      contact: ga ? [fmtN(ga.ev.contact), U.chg(ga.ev.contact, ga.ev.yContact), gaSt, g.at, null, 'vs last year'] : null,
      pricing: ga ? [fmtN(ga.pricing.sessions), U.chg(ga.pricing.sessions, ga.pricing.ySessions), gaSt, g.at, null, 'vs last year'] : null,
      aiSessions: ga ? [fmtN(aiS), U.chg(aiS, aiY), gaSt, g.at, null, 'vs last year'] : null,
      assistedGa: ASt ? [fmtN(Math.round(ASt.cur.assisted.total)), U.chg(ASt.cur.assisted.total, ASt.yoy.assisted.total), gaSt, g.at, null, ASt.cur.organicAll.total ? pct1(ASt.cur.assisted.total / ASt.cur.organicAll.total * 100) + ' of organic-started' : ''] : null,
      mqls: CR && CR.res.ft.mqls != null ? [fmtN(CR.res.ft.mqls), null, crmSt, CR.at, null, `lead → MQL ${pct1(CR.res.ft.toMql)} vs ${pct1(CR.res.other.toMql)} others`] : null,
      pipeFT: CR ? [inr(CR.res.ft.pipeline), null, crmSt, CR.at, null, `${fmtN(CR.res.ft.opps)} opportunities`] : null,
      pipeAssist: CR && CR.res.hasJourney ? [inr(CR.res.assisted.pipeline), null, crmSt, CR.at, null, 'reported apart from first touch'] : null,
      revFT: CR ? [inr(CR.res.ft.revenue), null, crmSt, CR.at, null, `${fmtN(CR.res.ft.won)} won`] : null,
      revAssist: CR && CR.res.hasJourney ? [inr(CR.res.assisted.revenue), null, crmSt, CR.at, null, ''] : null,
      l2o: CR ? [pct1(CR.res.ft.toOpp), CR.res.ft.toOpp != null && CR.res.other.toOpp != null ? CR.res.ft.toOpp - CR.res.other.toOpp : null, crmSt, CR.at, 'pp', 'vs other channels'] : null,
      l2c: CR ? [pct1(CR.res.ft.toClose), CR.res.ft.toClose != null && CR.res.other.toClose != null ? CR.res.ft.toClose - CR.res.other.toClose : null, crmSt, CR.at, 'pp', 'vs other channels'] : null
    };
    const owners = s.owners || {};
    const stages = ['Visibility', 'Traffic', 'Signups', 'Engagement', 'Leads', 'Pipeline & revenue'];
    const link = { Visibility: '#visibility', Traffic: '#ga4', Signups: '#acquisition', Engagement: '#engagement', Leads: '#leads', 'Pipeline & revenue': '#leads' };
    const card = mt => {
      const v = V2[mt.id];
      const st = mt.later ? 'later' : v ? v[2] : mt.src === 'MoEngage' ? 'none' : mt.src === 'Cost input' ? 'input' : 'none';
      const need = mt.later ? 'CRM export (next phase)' : mt.src === 'CRM' ? '<a href="#leads">Upload CRM export</a>' : mt.src === 'Rank tracker' ? '<a href="#visibility">Upload rank tracking</a>' : mt.src === 'GA4' ? '<a href="#ga4">Connect GA4</a>' : mt.src === 'MoEngage' ? '<a href="#quality">Connect MoEngage or upload an export</a>' : mt.src === 'Cost input' ? '<a href="#funnelsetup">Add monthly SEO cost</a>' : '';
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
        <div><span>CRM</span>${chip(crmSt)}<small>${CR ? esc(CR.name) + ' · ' + fmtN(CR.res.total) + ' leads' : '<a href="#leads">Upload CRM export</a>'}</small></div>
      </div>` +
      (() => { const H = healthOf(D); return `<div class="note ${H.ready ? '' : 'un-warn'}"><b>Attribution health: ${H.ok} of ${H.total} checks pass</b>${H.missing ? ` · ${H.missing} source${H.missing === 1 ? '' : 's'} not connected` : ''}. ${H.ready ? 'GA4, MoEngage and the CRM agree well enough to report organic pipeline and revenue.' : 'Fix attribution first: until it passes, organic pipeline and revenue are not reliable.'} <a href="#reviews?r=attribution">See the checks</a> · Reviews: <a href="#reviews?r=weekly">weekly</a>, <a href="#reviews?r=monthly">monthly</a>, <a href="#reviews?r=quarterly">quarterly</a>, <a href="#reviews?r=first">first review</a>.</div>`; })() +
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
      `<section class="panel"><div class="panel-h"><h2>3. How much pipeline can we trace to organic?</h2><p>First touch and organic-in-the-journey are reported separately, never added.</p></div><div class="panel-b">${CR ? `<div class="un-kpis"><div class="un-kpi"><span>Organic first touch</span><b>${inr(CR.res.ft.pipeline)}</b><small>${fmtN(CR.res.ft.opps)} opportunities · ${inr(CR.res.ft.revenue)} closed won</small></div><div class="un-kpi"><span>Organic in the journey (assisted)</span><b>${CR.res.hasJourney ? inr(CR.res.assisted.pipeline) : '—'}</b><small>${CR.res.hasJourney ? fmtN(CR.res.assisted.opps) + ' opportunities · ' + inr(CR.res.assisted.revenue) + ' closed won' : 'needs a journey column in the export'}</small></div><div class="un-kpi"><span>Attribution coverage</span><b>${pct1(CR.res.coverage.source)}</b><small>of leads have an original source${CR.res.coverage.source < 80 ? ' · too low to report yet' : ''}</small></div></div><p class="hint"><a href="#leads">Leads & revenue</a> has channels, months and first pages.</p>` : '<p class="empty"><a href="#leads">Upload the CRM export</a> (lead ID, original source, journey, lifecycle stage, deal amount and stage) to answer this. Validate attribution coverage before sharing.</p>'}</div></section>` +
      `<section class="panel"><div class="panel-h"><h2>Activity scorecards</h2><p>Every activity should connect to a number on the chain above. Each workstream has its own scorecard.</p></div><div class="panel-b"><div class="un-tabs">${SC_TABS.slice(1).map(([k, l]) => `<a href="#scorecards?w=${k}">${l}</a>`).join('')}</div></div></section>` +
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
      <section class="panel"><div class="panel-h"><h2>Share of voice</h2><p>The named competitors and the fixed keyword set (one per line; empty = every keyword in the rank tracking file).</p></div><div class="panel-b un-grid2">
        <label class="field"><span>Competitor domains (comma-separated, up to 8)</span><input type="text" id="un-comp" value="${esc(compOf(s).join(', '))}"></label>
        <label class="field"><span>Fixed keyword set</span><textarea id="un-sovkw" rows="5" spellcheck="false" placeholder="internship&#10;hackathons&#10;jobs for freshers">${esc((s.sovKeywords || []).join('\n'))}</textarea></label>
      </div></section>
      <section class="panel"><div class="panel-h"><h2>Query clusters</h2><p>One cluster per line: <code>Name: word, phrase, word</code>. First match wins.</p></div><div class="panel-b"><textarea id="un-clusters" rows="9" spellcheck="false">${esc(U.clustersText(s.clusters || U.DEFAULT_CLUSTERS))}</textarea></div></section>
      <section class="panel"><div class="panel-h"><h2>GA4 event names</h2><p>Comma-separated, exact GA4 event names. The GA4 screen lists every event recorded in organic sessions.</p></div><div class="panel-b un-grid2">
        ${evRow('studentSignup', 'Student signup')}${evRow('employerSignup', 'Employer / recruiter signup')}${evRow('demoRequest', 'Demo request')}${evRow('contactSubmit', 'Contact form submission')}${evRow('opportunityAction', 'Opportunity register / apply')}${evRow('productClick', 'Product click (blog → product)')}${evRow('oppClick', 'Click into an opportunity')}${evRow('scroll', 'Scroll')}
        <label class="field"><span>Pricing page paths</span><input type="text" id="un-pricing" value="${esc(s.pricingPaths.join(', '))}"></label>
        <label class="field"><span>AI assistant sources (GA4 session source contains)</span><input type="text" id="un-ai" value="${esc(s.aiSources.join(', '))}"></label>
        <label class="field"><span>GA4 property ID</span><input type="text" id="un-prop" inputmode="numeric" value="${esc(s.ga4Property)}"></label>
        <label class="field"><span>Sales-form leads Google Sheet (link or ID), used as the B2E lead list</span><input type="text" id="un-sales-sheet" value="${esc(s.salesSheet || CFG.salesSheet || '')}" spellcheck="false"></label>
      </div></section>
      <section class="panel"><div class="panel-h"><h2>Conversion paths, cost and MoEngage</h2></div><div class="panel-b un-grid2">
        <fieldset class="field"><span>URL clusters with a clear conversion path (register, apply, post a job, book a demo)</span>${(() => { const ps = s.pathSections || U.DEFAULT_PATH_SECTIONS; return U.makeSectioner(s.sections).sections.filter(x => x.id !== 'other').map(x => `<label class="check"><input type="checkbox" data-path="${esc(x.id)}" ${ps.includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join(''); })()}</fieldset>
        <div>
          <label class="field"><span>Monthly SEO cost in ₹ (content, agency, tools, team share)</span><input type="text" id="un-cost" inputmode="decimal" value="${esc(s.monthlyCost)}" placeholder="e.g. 450000"></label>
          <label class="field"><span>Employer / recruiter share of that cost (%), for cost per employer signup</span><input type="number" id="un-cost-emp" min="0" max="100" value="${esc(s.empCostShare == null ? '' : s.empCostShare)}" placeholder="e.g. 30"></label>
          <label class="field"><span>Profile counts as complete at (%)</span><input type="number" id="un-moe-th" min="1" max="100" value="${esc(s.moeThreshold)}"></label>
          <label class="field"><span>PageSpeed Insights API key (optional, free from Google Cloud; kept in this browser)</span><input type="text" id="un-psi-key" value="${esc(s.psiKey || '')}" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span>Key pages for scroll depth (one path per line; empty = 25 most viewed)</span><textarea id="un-keypages" rows="4" spellcheck="false" placeholder="/internship&#10;/hackathons&#10;/blog/tcs-nqt-exam-pattern">${esc((s.keyPages || []).join('\n'))}</textarea></label>
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
        const prevSheet = n.salesSheet || CFG.salesSheet || ''; n.salesSheet = document.getElementById('un-sales-sheet').value.trim(); if (n.salesSheet !== prevSheet) { SALES.delete(D.site); SALESAUTO.delete(D.site); }
        n.pathSections = [...f.querySelectorAll('[data-path]')].filter(i => i.checked).map(i => i.dataset.path);
        n.monthlyCost = document.getElementById('un-cost').value.trim(); n.empCostShare = document.getElementById('un-cost-emp').value.trim();
        n.moeThreshold = +document.getElementById('un-moe-th').value || 80;
        n.organicSources = document.getElementById('un-orgsrc').value.trim();
        n.competitors = document.getElementById('un-comp').value.split(',').map(x => x.trim()).filter(Boolean).slice(0, 8); n.sovKeywords = document.getElementById('un-sovkw').value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 2000); n.psiKey = document.getElementById('un-psi-key').value.trim();
        n.keyPages = document.getElementById('un-keypages').value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 200);
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


  // ════════════════════════════ B2E DASHBOARD ════════════════════════════
  // The employer side on one page, laid out like the One-Page Dashboard sheet: B2E, B2E (J&I) and both
  // together, from Search Console (exact per cluster), GA4 and PageSpeed. "Copy for Google Sheets" puts the
  // whole table on the clipboard, ready to paste.
  // ── B2E: products, search topics, weekly trend and drop alerts ──
  const B2E_PRODUCTS = { 'ai-sourcing-agent': 'AI Sourcing Agent', 'ai-assessment-agent': 'AI Assessment Agent', 'ai-interview-agent': 'AI Interview Agent', 'ai-screening-agent': 'AI Screening Agent', 'ai-proctoring-agent': 'AI Proctoring Agent', 'ai-calling-agent': 'AI Calling Agent', 'ai-scheduling-agent': 'AI Scheduling Agent', 'ats-software': 'ATS Software', 'employer-branding': 'Employer Branding', 'brand-and-advertise': 'Brand & Advertise', 'campus-hiring': 'Campus Hiring', 'lateral-hiring': 'Lateral Hiring', 'virtual-hiring': 'Virtual Hiring', 'hiring-talent-platform': 'Hiring Talent Platform', 'hackathon-hiring': 'Hackathon Hiring', 'online-assessment-platform': 'AI Assessment Agent', 'ai-interview': 'AI Interview Agent',
    // older employer URLs roll up into today's products
    'virtual-interview-platform': 'AI Interview Agent', 'hiring-automation-platform-applicant-tracking-system-ats': 'ATS Software', 'screen-candidates-powered-by-ai': 'AI Screening Agent', 'contact-us': 'Contact us (employers)', 'clients': 'Clients & testimonials', 'testimonials': 'Clients & testimonials' };
  const titleCase = x => String(x || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  // the product a B2E URL belongs to: the folder after /employers (hire-* and free job posting pages grouped)
  function b2eProduct(url) {
    const p = U.pathOnly(url).toLowerCase().replace(/\/+$/, '') || '/';
    if (p === '/employers') return 'Employers home';
    if (/^\/(saas-pricing|employers\/pricing|pricing)(\/|$)/.test(p)) return 'Pricing';
    if (/^\/employers\/hire-/.test(p)) return 'Hire pages (hire-*)';
    if (/free-job-posting/.test(p)) return 'Free job posting';
    const seg = p.split('/').filter(Boolean);
    const k = seg[0] === 'employers' ? seg[1] : seg[0];
    return B2E_PRODUCTS[k] || titleCase(k) || 'Other';
  }
  // the employer topic a search belongs to (first match wins)
  const B2E_TOPICS = [
    ['ATS / applicant tracking', /\bats\b|applicant tracking|tracking system/],
    ['Proctoring', /proctor/],
    ['AI interview', /interview/],
    ['AI screening', /screening|resume screen|shortlist/],
    ['AI calling', /calling|voice (ai|agent|bot)|phone screen/],
    ['Scheduling', /schedul/],
    ['Assessments & tests', /assessment|aptitude|coding test|online test|skill test|psychometric|personality test|sql (test|assessment)|mcq|pre[- ]?employment|test platform|gamified/],
    ['Hackathons, quizzes & challenges', /hackathon|ideathon|quiz|simulation|challenge|case comp/],
    ['Job & internship posting', /post (a |free )?(job|internship)|job posting|internship posting|free job|job board|job portal for (employers|recruiters)|post jobs?/],
    ['Hire roles & freshers', /^hire |\bhire (a |an )?\w+|hiring (freshers|interns|developers)|fresher hiring/],
    ['Sourcing', /sourcing|talent pool|candidate search|talent community/],
    ['Campus hiring', /campus|college (hiring|recruit)|placement drive|university recruit/],
    ['Lateral & virtual hiring', /lateral|virtual (hiring|recruit)/],
    ['Employer branding & advertising', /employer brand|branding|brand presence|advertis/],
    ['Pricing', /pricing|price|cost|plans?\b/],
    ['Recruitment platform & software', /recruit|hiring (platform|software|tool|solution)|talent (platform|acquisition)|hr software/]
  ];
  const TOPIC_CACHE = new Map();
  const b2eTopic = q => { let t = TOPIC_CACHE.get(q); if (t) return t; const s = String(q || '').toLowerCase(); const m = B2E_TOPICS.find(([, rx]) => rx.test(s)); t = m ? m[0] : 'Other employer searches'; if (TOPIC_CACHE.size > 200000) TOPIC_CACHE.clear(); TOPIC_CACHE.set(q, t); return t; };
  // results that only change when their inputs change (same objects) are kept between renders
  const B2E_MEMO = new Map();
  const memo = (name, deps, fn) => { const c = B2E_MEMO.get(name); if (c && c.deps.length === deps.length && c.deps.every((d, i) => d === deps[i])) return c.v; const v = fn(); B2E_MEMO.set(name, { deps, v }); return v; };
  const B2EX = new Map(); // site|end → { status, weekly, cur, prev, W, at, sample }
  const b2eKey = D => D.site + '|' + D.end;
  function b2eWindows(D) {
    const e = new Date(D.end + 'T00:00:00Z'), iso = d => d.toISOString().slice(0, 10), add = n => { const x = new Date(e); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
    return { wStart: add(-7 * 16 + 1), end: D.end, curS: add(-6), prevS: add(-13), prevE: add(-7) };
  }
  // live: 6 Search Console calls per cluster (daily NB / brand for the trend, pages and queries for this week and last)
  async function loadB2EX(D, A, ids, ov, xkey) {
    const src = window.CW_SOURCE, key = xkey || b2eKey(D); if (!src || !src.gsc) return;
    B2EX.set(key, { status: 'loading' }); rerender();
    try {
      const so = (ov && ov.so) || sectioner(D), s = settings(D.site), W = b2eWindows(D), brandRx = A.brandRx, secList = (ov && ov.sections) || s.sections;
      const filt = id => { const sec = so.sections.find(x => x.id === id); const f = [{ dimension: 'page', operator: 'includingRegex', expression: U.sectionRegex(sec, null) }]; const ex = U.sectionExclude(sec, secList); if (ex) f.push({ dimension: 'page', operator: 'excludingRegex', expression: ex }); return f; };
      const q = body => src.gsc.query({ type: 'web', ...body }).then(d => d.rows || []);
      const out = { weekly: {}, cur: {}, prev: {} };
      await Promise.all(ids.map(async id => {
        const f = filt(id);
        const byDate = brand => q({ startDate: W.wStart, endDate: W.end, dimensions: ['date'], rowLimit: 1000, dimensionFilterGroups: [{ groupType: 'and', filters: f.concat(brandRx ? [{ dimension: 'query', operator: brand ? 'includingRegex' : 'excludingRegex', expression: brandRx }] : []) }] }).then(rows => rows.map(r => ({ d: r.keys[0], clicks: r.clicks, impr: r.impressions, pos: r.position })));
        const by = (st, en, dim) => q({ startDate: st, endDate: en, dimensions: [dim], rowLimit: 5000, dimensionFilterGroups: [{ groupType: 'and', filters: f }] }).then(rows => rows.map(r => ({ k: r.keys[0], clicks: r.clicks, impr: r.impressions, pos: r.position })));
        const [nb, b, pc, pp, qc, qp] = await Promise.all([byDate(false), brandRx ? byDate(true) : Promise.resolve([]), by(W.curS, W.end, 'page'), by(W.prevS, W.prevE, 'page'), by(W.curS, W.end, 'query'), by(W.prevS, W.prevE, 'query')]);
        out.weekly[id] = { nb: U.weekly(nb), b: U.weekly(b) }; out.cur[id] = { pages: pc, queries: qc }; out.prev[id] = { pages: pp, queries: qp };
      }));
      B2EX.set(key, { status: 'done', ...out, W, at: Date.now() });
    } catch (e) { B2EX.set(key, { status: 'error', error: e.message }); }
    rerender();
  }
  // uploads and sample data: alerts compare the loaded period with the previous one; sample data also gets a
  // generated weekly series so the screen can be previewed
  function b2eFromRows(A, D, ids, soOv) {
    const so = soOv || sectioner(D), isB = brandOf(A);
    const out = { status: 'done', weekly: {}, cur: {}, prev: {}, W: null, sample: D.source === 'demo', periodBased: true };
    let seed = 11; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const days = Math.max(1, Math.round((new Date(D.end) - new Date(D.start)) / 864e5) + 1);
    ids.forEach(id => {
      const P = (A.P || []).filter(r => so(r.p) === id), PP = (D.prevP || []).filter(r => so(r.p) === id);
      const QP = (D.QP || []).filter(r => so(r.p) === id);
      const qa = new Map(); QP.forEach(r => { const o = qa.get(r.q) || { k: r.q, clicks: 0, impr: 0, posW: 0 }; o.clicks += +r.clicks || 0; o.impr += +r.impr || 0; o.posW += (+r.pos || 0) * (+r.impr || 0); qa.set(r.q, o); });
      const qcur = [...qa.values()].map(o => ({ k: o.k, clicks: o.clicks, impr: o.impr, pos: o.impr ? o.posW / o.impr : 0 }));
      const prevQ = new Map((D.prevQ || []).map(r => [r.q, r]));
      out.cur[id] = { pages: P.map(r => ({ k: r.p, clicks: +r.clicks || 0, impr: +r.impr || 0, pos: +r.pos || 0 })), queries: qcur };
      out.prev[id] = { pages: PP.map(r => ({ k: r.p, clicks: +r.clicks || 0, impr: +r.impr || 0, pos: +r.pos || 0 })), queries: qcur.map(x => prevQ.get(x.k)).filter(Boolean).map(r => ({ k: r.q, clicks: +r.clicks || 0, impr: +r.impr || 0, pos: +r.pos || 0 })) };
      if (out.sample) {
        const tc = P.reduce((a, r) => a + (+r.clicks || 0), 0), ti = P.reduce((a, r) => a + (+r.impr || 0), 0);
        const bc = QP.filter(r => isB(r.q)).reduce((a, r) => a + (+r.clicks || 0), 0), all = QP.reduce((a, r) => a + (+r.clicks || 0), 0) || 1;
        const bs = bc / all, pos = P.length ? P.reduce((a, r) => a + (+r.pos || 0) * (+r.impr || 0), 0) / (ti || 1) : 15;
        const e = new Date(D.end + 'T00:00:00Z'); const rowsNb = [], rowsB = [];
        for (let i = 16 * 7 - 1; i >= 0; i--) { const d = new Date(e); d.setUTCDate(d.getUTCDate() - i); const f = (0.82 + 0.3 * (1 - i / 112)) * (0.85 + R() * 0.3) * (d.getUTCDay() % 6 === 0 ? 0.6 : 1.08); const c = tc / days * f, im = ti / days * f; rowsNb.push({ d: d.toISOString().slice(0, 10), clicks: Math.round(c * (1 - bs)), impr: Math.round(im * 0.94), pos: pos * (1.05 - 0.1 * (1 - i / 112)) }); rowsB.push({ d: d.toISOString().slice(0, 10), clicks: Math.round(c * bs), impr: Math.round(im * 0.06), pos: 1.4 }); }
        out.weekly[id] = { nb: U.weekly(rowsNb), b: U.weekly(rowsB) };
      }
    });
    return out;
  }
  // pages or keywords whose clicks fell (or ranking slipped) against the previous window, with the likely reason
  function b2eDrops(cur, prev, minPrev) {
    const cm = new Map(cur.map(r => [r.k, r]));
    return prev.filter(p => p.clicks >= minPrev || p.impr >= 200).map(p => {
      const c = cm.get(p.k) || { clicks: 0, impr: 0, pos: null };
      const dc = U.chg(c.clicks, p.clicks), dpos = c.pos && p.pos ? c.pos - p.pos : null, di = U.chg(c.impr, p.impr);
      const flag = (p.clicks >= minPrev && dc != null && dc <= -30) || (dpos != null && dpos >= 3 && p.impr >= 100);
      if (!flag) return null;
      const why = !c.impr ? 'Dropped out of results (no impressions this week)' : dpos != null && dpos >= 1.5 ? `Ranking dropped: position ${p.pos.toFixed(1)} → ${c.pos.toFixed(1)}` : di != null && di <= -25 ? 'Fewer impressions at a similar position: lower demand or seasonality' : 'Lower CTR at a similar position: check the title, snippet or new SERP features';
      return { k: p.k, prevClicks: p.clicks, clicks: c.clicks, dc, prevPos: p.pos, pos: c.pos, dpos, prevImpr: p.impr, impr: c.impr, di, lost: p.clicks - c.clicks, why };
    }).filter(Boolean).sort((a, b) => b.lost - a.lost || (b.dpos || 0) - (a.dpos || 0));
  }
  const B2E_STATE = new Map(); // site → { product, topicCol, trend }
  const b2eState = site => { if (!B2E_STATE.has(site)) B2E_STATE.set(site, { product: '', topicCol: 2, trend: 'nb' }); return B2E_STATE.get(site); };
  // ── B2B sales-form leads (Google Sheet "B2B Form Leads", used as the CRM for B2E) ──
  const SALES = new Map(); // site → { res, name, at, source: 'sheet' | 'file' | 'sample', error }
  const SALESAUTO = new Map();
  const SL = window.UN_SALES;
  const sheetIdOf = v => { const s = String(v || '').trim(); const m = s.match(/\/d\/([A-Za-z0-9_-]{20,})/); return m ? m[1] : /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : ''; };
  const salesSheetOf = D => settings(D.site).salesSheet || CFG.salesSheet || '';
  async function loadSalesSheet(D) {
    const id = sheetIdOf(salesSheetOf(D)), t = googleTok();
    if (!id) throw new Error('Add the Google Sheet link in Funnel setup › Sales-form leads.');
    if (!t) throw new Error('Sign in with Google first (Connect Search Console + GA4).');
    const get = async url => { const r = await fetch(url, { headers: { Authorization: 'Bearer ' + t } }); const j = await r.json().catch(() => ({})); if (!r.ok) { const msg = (j.error && j.error.message) || r.statusText; if (r.status === 403 && /scope|insufficient/i.test(msg)) throw new Error('This sign-in did not allow Google Sheets. Sign out, then Connect Search Console + GA4 again and keep the Google Sheets box ticked.'); if (r.status === 403 && /has not been used|disabled/i.test(msg)) throw new Error('The Google Sheets API is not enabled in the Google Cloud project yet.'); if (r.status === 403 || r.status === 404) throw new Error('This Google account cannot open the leads sheet. Ask the owner to share it (view access is enough).'); throw new Error(msg); } return j; };
    const meta = await get(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title,sheets.properties.title`);
    const titles = (meta.sheets || []).map(s => s.properties.title);
    const vr = await get(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?valueRenderOption=FORMATTED_VALUE&${titles.map(x => 'ranges=' + encodeURIComponent(`'${x.replace(/'/g, "''")}'`)).join('&')}`);
    const res = SL.salesModel((vr.valueRanges || []).map((v, i) => ({ name: titles[i], rows: v.values || [] })));
    if (!res.ok) throw new Error(res.error);
    SALES.set(D.site, { res, name: (meta.properties && meta.properties.title) || 'Leads sheet', at: Date.now(), source: 'sheet' });
  }
  async function readAllSheets(file) {
    if (!window.XLSX) throw new Error('The spreadsheet reader is still loading. Try again in a moment.');
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', raw: false, cellDates: false });
    return wb.SheetNames.map(n => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false }) }));
  }
  function salesAuto(D) {
    if (!(window.CW_SOURCE && window.CW_SOURCE.kind === 'api') || SALES.has(D.site) || SALESAUTO.has(D.site) || !googleTok() || !sheetIdOf(salesSheetOf(D))) return;
    SALESAUTO.set(D.site, 'loading'); rerender();
    loadSalesSheet(D).then(() => SALESAUTO.set(D.site, 'done'), e => { SALESAUTO.set(D.site, 'error'); SALES.set(D.site, { error: e.message }); }).finally(rerender);
  }
  // sample leads for the preview: the same shape as the sheet, spread over the employer pages
  function sampleSales(D, A) {
    let seed = 21; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const so = sectioner(D), emp = (A.P || []).filter(r => ['empb2b', 'empjobboard'].includes(so(r.p))).sort((a, b) => b.clicks - a.clicks).slice(0, 14).map(r => U.pathOnly(r.p));
    const pages = [...emp.map((p, i) => [p, Math.max(2, 40 - i * 3)]), ['/contact-us', 30], ['/organiser-panel/dashboard', 45], ['/organiser-panel/assessment', 20], ['/employers/contact-us', 10], ['/institutions', 5]];
    const tot = pages.reduce((a, [, w]) => a + w, 0);
    const doms = { official: ['acme-hr.com', 'brightcorp.in', 'nova-tech.io', 'pixelworks.co', 'finedge.in', 'retailone.com'], campus: ['sample.ac.in', 'demo-university.edu.in', 'example.edu'], personal: ['gmail.com', 'yahoo.com', 'outlook.com'], internal: ['unstop.com'] };
    const header = ['name', 'usertype', 'type', 'created_at', 'link', 'Channel', 'User Status', 'Email Domain'], rows = [header];
    const end = new Date(D.end + 'T00:00:00Z');
    for (let i = 0; i < 1400; i++) {
      let x = R() * tot, page = pages[0][0]; for (const [p, w] of pages) { x -= w; if (x <= 0) { page = p; break; } }
      const k = R(), kind = /hire-|sourcing/.test(page) ? (k < .34 ? 'official' : k < .5 ? 'campus' : k < .97 ? 'personal' : 'internal') : (k < .24 ? 'official' : k < .39 ? 'campus' : k < .97 ? 'personal' : 'internal');
      const d = new Date(end); d.setUTCDate(d.getUTCDate() - Math.floor(Math.pow(R(), 1.3) * 540));
      const ds = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) + ', 10:00 AM';
      rows.push(['Sample lead ' + i, kind === 'campus' ? 'College Students' : kind === 'official' ? 'Working Professionals' : ['Fresher', 'College Students', 'Working Professionals'][Math.floor(R() * 3)], 'salesForm', ds, 'https://unstop.com' + page, R() < .9 ? 'Organic' : 'jnigads210', R() < .35 ? 'New User' : 'Existing User', doms[kind][Math.floor(R() * doms[kind].length)]]);
    }
    return { res: SL.salesModel([{ name: 'Sample leads', rows }]), name: 'Sample leads', at: Date.now(), source: 'sample' };
  }
  // where a form page sits: the two B2E clusters, or the other places the sales form appears
  function salesPlace(path, so) {
    if (!path) return { group: 'Other form pages', area: 'Page not recorded' };
    const id = so(path);
    if (id === 'empb2b') return { group: 'B2E', area: b2eProduct(path) };
    if (id === 'empjobboard') return { group: 'B2E (J&I)', area: b2eProduct(path) };
    if (/^\/organiser-panel|^\/user\//.test(path)) return { group: 'Other form pages', area: 'Organiser panel / account (logged in)' };
    if (/contact-us/.test(path)) return { group: 'Other form pages', area: 'Contact us' };
    if (/^\/institutions/.test(path)) return { group: 'Other form pages', area: 'Institutions (B2I)' };
    if (path === '/') return { group: 'Other form pages', area: 'Home page' };
    return { group: 'Other form pages', area: so.label(id) };
  }
  const B2E_AI = new Map(); // site → { month, source } opened from the AI table
  const B2E_LD = new Map(); // site → lead filter opened from a count
  const B2E_KW = new Map(); // site → { seg, k, i } keyword list opened from the table
  const B2E_COLS = [{ id: 'empb2b', name: 'B2E' }, { id: 'empjobboard', name: 'B2E (J&I)' }];
  // One board, two set-ups: B2E (employer clusters, sales-form leads, CRM) and a common board for any
  // folder or two (no B2B leads). cfg: { key, title, intro, so, sections, cols, employer, sales, bothName,
  // productOf, productLabel, topicOf, picker }
  const B2E_PRODUCT_FN = url => b2eProduct(url), B2E_TOPIC_FN = q => b2eTopic(q);
  function board(A, D, cfg) {
    demoFill(D);
    window.CW_LAST_A = A;
    const so = cfg.so || sectioner(D);
    const SK = D.site + '|' + cfg.key;
    const cols = cfg.cols || B2E_COLS.filter(c => so.sections.some(x => x.id === c.id)), s0 = settings(D.site), ids = cols.map(c => c.id);
    const realIds = cols.filter(c => !c.dummy).map(c => c.id), bothName = cfg.bothName || 'B2E + B2E (J&I)';
    const b2eProduct = cfg.productOf || B2E_PRODUCT_FN, b2eTopic = cfg.topicOf || B2E_TOPIC_FN;
    const ov = cfg.so ? { so, sections: cfg.sections } : null;
    const intro = cfg.intro ? head(cfg.title, cfg.intro) + (cfg.picker || '') : head('B2E dashboard', 'Employer pages on one page: B2E (hiring platform, employer branding, assessments, AI agents, ATS, pricing) and B2E (J&I) (AI sourcing agent, hire-* and free job posting pages). Search Console, GA4 and PageSpeed together. Copy the table straight into the One-Page Dashboard sheet.');
 if (cfg.empty) return { html: intro + cfg.empty, mount: cfg.pickerMount };
    if (cols.length < 2) return { html: intro + '<div class="note">The B2E and B2E (J&I) clusters are missing from Funnel setup › URL clusters. Reset clusters to the defaults or add them back.</div>' };
    const live = window.CW_SOURCE && window.CW_SOURCE.kind === 'api' && window.CW_SOURCE.gsc;
    const scOf = id => ({ kind: 'cluster', id, label: so.label(id), test: x => so(x) === id });
    const keyOf = sc => [D.site, D.start, D.end, D.prevStart || '', sc.kind, sc.id || '', sc.folder || '', sc.path || '', cfg.key === 'b2e' ? '' : JSON.stringify((so.sections.find(x => x.id === sc.id) || {}).rules || [])].join('|');
    const F = cols.map(c => { if (c.dummy) return { status: 'done', model: null }; const sc = scOf(c.id); return live ? FOC.get(keyOf(sc)) : { status: 'done', model: scopeFromRows(A, D, sc) }; });
    const loading = live && F.some(f => !f || f.status === 'loading');
    const G = F.map(f => f && f.status === 'done' ? f.model : null);
    const errs = F.filter(f => f && f.status === 'error').map(f => f.error);

    // ── GA4 per cluster ──
    const g = GA.get(D.site), M = gaModel(D);
    const gaOf = id => {
      if (!M) return null;
      const P = M.pages.filter(p => so(p.path) === id);
      const t = k => P.reduce((a, p) => a + (p[k] || 0), 0);
      const o = { sessions: t('sessions'), ySessions: t('ySessions'), newUsers: t('newUsers'), yNewUsers: t('yNewUsers'), engaged: t('engaged'), views: t('views'), emp: t('emp'), stu: t('stu'), opp: t('opp'), prodClick: t('prodClick'), demo: t('demo'), contact: t('contact'), scroll: t('scroll'), landings: P.filter(p => p.sessions > 0).length };
      const dev = { desktop: 0, mobile: 0, tablet: 0, yDesktop: 0, yMobile: 0 }, st = new Map();
      if (g && g.raw) {
        if (g.raw.landingDevice) U.gaRows(g.raw.landingDevice).forEach(r => { if (so(U.pathOnly(r.landingPage)) !== id) return; const k = String(r.deviceCategory || '').toLowerCase(); if (r.range === 'yoy') { if (k === 'desktop') dev.yDesktop += r.sessions; if (k === 'mobile') dev.yMobile += r.sessions; } else if (k in dev) dev[k] += r.sessions; });
        if (g.raw.landingRegion) U.gaRows(g.raw.landingRegion).forEach(r => { if (r.range === 'yoy' || so(U.pathOnly(r.landingPage)) !== id) return; const k = r.region || '(not set)'; if (k === '(not set)') return; st.set(k, (st.get(k) || 0) + r.sessions); });
      }
      o.dev = dev; o.stMap = st; o.states = [...st.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      o.pricing = M.pricing ? M.pricing.pages.filter(p => so(U.pathOnly(p.path)) === id).reduce((a, p) => a + p.sessions, 0) : 0;
      return o;
    };
    const GAc = cols.map(c => gaOf(c.id));
    // ── PageSpeed (from Workstream scorecards › Technical SEO) ──
    const psi = scd(D.site).psi;
    const psiOf = id => { if (!psi || !psi.results) return null; const r = psi.results.filter(x => !x.error && so(U.pathOnly(x.url)) === id); if (!r.length) return null; const f = r.filter(x => x.hasField); return { tested: r.length, pass: f.length ? f.filter(x => x.pass).length / f.length * 100 : null, perf: r.map(x => x.perf).filter(x => x != null).sort((a, b) => a - b)[Math.floor(r.length / 2)] }; };
    const PS = cols.map(c => psiOf(c.id));
    // ── sales-form leads (the B2B leads sheet as CRM); organic only unless "All channels" is chosen below ──
    if (cfg.sales !== false && D.source === 'demo' && !SALES.has(D.site)) SALES.set(D.site, sampleSales(D, A));
    const SLd = cfg.sales === false ? null : SALES.get(D.site), SLr = SLd && SLd.res && SLd.res.ok ? SLd.res : null, SST = b2eState(SK);
    const slIn = l => l.day && l.day >= D.start && l.day <= D.end;
    // every clickable lead count registers what it counts; clicking opens those leads
    const LDS = [];
    const ldLink = (n, spec, txt) => n ? `<a href="#" class="un-ld" data-ld="${LDS.push(spec) - 1}" title="Show these leads">${txt == null ? fmtN(n) : txt}</a>` : (txt == null ? '0' : txt);
    const ldMatch = sp => l => (sp.nonOrg ? !l.organic : (sp.all || l.organic)) && (sp.range === 'all' || slIn(l)) && (sp.kind === 'any' ? l.kind !== 'internal' : l.kind === sp.kind)
      && (!sp.cluster || (sp.cluster === 'both' ? ids.includes(so(l.path || '/-')) : so(l.path || '/-') === sp.cluster)) && (!sp.group || salesPlace(l.path, so).group === sp.group)
      && (sp.path == null || (l.path || '') === sp.path) && (!sp.source || l.source === sp.source) && (!sp.month || l.month === sp.month) && (!sp.empOnly || salesPlace(l.path, so).group !== 'Other form pages');
    const slOf = (pred, opt) => SLr ? SLr.leads.filter(l => (opt.all || l.organic) && (opt.range === 'all' || slIn(l)) && pred(l)) : null;
    const slCol = cols.map(c => slOf(l => so(l.path || '/-') === c.id, {}));
    const slT = slCol.map(x => x ? SL.tally(x) : null), slBoth = SLr ? SL.tally(slCol.flat()) : null;

    // ── combine the two clusters ──
    const sum = (a, b) => (a == null && b == null) ? null : (a || 0) + (b || 0);
    const both = (arr, f) => arr.every(x => x == null) ? null : arr.reduce((acc, x) => sum(acc, x == null ? null : f(x)), null);
    const wPos = (list, key) => { let w = 0, i = 0; list.forEach(m => { if (m && m[key].impr) { w += m[key].pos * m[key].impr; i += m[key].impr; } }); return i ? w / i : null; };
    const ratio = (a, b) => a == null || !b ? null : a / b * 100;
    const prevGsc = (m, key, f) => m && m.prev ? f(m.prev[key]) : null;

    // rows: [section, KPI, values per column + total, change per column + total (text), source]
    const R = [];
    const fmtV = (v, kind) => v == null || !isFinite(v) ? '—' : kind === 'pct' ? v.toFixed(1) + '%' : kind === 'pos' ? v.toFixed(1) : kind === 'dec' ? v.toFixed(2) : fmtN(Math.round(v));
    const row = (sec, kpi, vals, kind, chgs, src, note) => R.push({ sec, kpi, vals, kind, chgs: chgs || [], src, note: note || '' });
    const pc = (c, p) => U.chg(c, p);
    const hasPrev = !!D.prevStart;
    const vsGsc = hasPrev ? 'vs previous period' : '';
    // 1. Visibility
    const tot = (key, f) => { const v = G.map(m => m ? f(m[key]) : null); return [...v, both(G, m => f(m[key]))]; };
    const totPrev = (key, f) => { const v = G.map(m => prevGsc(m, key, f)); return [...v, both(G.map(m => m && m.prev ? m : null), m => f(m.prev[key]))]; };
    const chgOf = (cur, prev) => cur.map((c, i) => pc(c, prev[i]));
    const V1 = 'Visibility (Search Console)';
    const nbImpr = tot('nb', x => x.impr), nbClicks = tot('nb', x => x.clicks);
    row(V1, 'Impressions (non-brand)', nbImpr, 'n', hasPrev ? chgOf(nbImpr, totPrev('nb', x => x.impr)) : null, 'GSC');
    row(V1, 'Clicks (non-brand)', nbClicks, 'n', hasPrev ? chgOf(nbClicks, totPrev('nb', x => x.clicks)) : null, 'GSC');
    row(V1, 'CTR (non-brand)', nbClicks.map((c, i) => ratio(c, nbImpr[i])), 'pct', null, 'GSC');
    const nbPos = [...G.map(m => m && m.nb.impr ? m.nb.pos : null), wPos(G.filter(Boolean), 'nb')];
    const nbPosPrev = [...G.map(m => m && m.prev && m.prev.nb.impr ? m.prev.nb.pos : null), wPos(G.filter(m => m && m.prev).map(m => m.prev), 'nb')];
    row(V1, 'Average position (non-brand)', nbPos, 'pos', hasPrev ? nbPos.map((v, i) => v != null && nbPosPrev[i] != null ? { pos: v - nbPosPrev[i] } : null) : null, 'GSC');
    const bImpr = tot('b', x => x.impr), bClicks = tot('b', x => x.clicks);
    row(V1, 'Impressions (brand)', bImpr, 'n', hasPrev ? chgOf(bImpr, totPrev('b', x => x.impr)) : null, 'GSC');
    row(V1, 'Clicks (brand)', bClicks, 'n', hasPrev ? chgOf(bClicks, totPrev('b', x => x.clicks)) : null, 'GSC');
    row(V1, 'CTR (brand)', bClicks.map((c, i) => ratio(c, bImpr[i])), 'pct', null, 'GSC');
    const aImpr = tot('tot', x => x.impr), aClicks = tot('tot', x => x.clicks);
    row(V1, 'Impressions (all queries)', aImpr, 'n', hasPrev ? chgOf(aImpr, totPrev('tot', x => x.impr)) : null, 'GSC', 'includes queries Google anonymises');
    row(V1, 'Clicks (all queries)', aClicks, 'n', hasPrev ? chgOf(aClicks, totPrev('tot', x => x.clicks)) : null, 'GSC');
    // brand + non-brand + hidden = all: Google keeps most low-volume searches private, so this closes the gap
    const hidC = G.map(m => m ? Math.max(0, m.tot.clicks - m.b.clicks - m.nb.clicks) : null), hidI = G.map(m => m ? Math.max(0, m.tot.impr - m.b.impr - m.nb.impr) : null);
    row(V1, 'Clicks from hidden searches', [...hidC, hidC.every(v => v == null) ? null : (hidC[0] || 0) + (hidC[1] || 0)], 'n', null, 'GSC', 'searches Google does not show (anonymised); brand + non-brand + hidden = all queries');
    row(V1, 'Hidden share of clicks', hidC.map((v, i) => v == null || !aClicks[i] ? null : v / aClicks[i] * 100).concat([aClicks[2] ? ((hidC[0] || 0) + (hidC[1] || 0)) / aClicks[2] * 100 : null]), 'pct', null, 'GSC');
    const bk = (f) => [...G.map(m => m ? f(m.buckets) : null), both(G, m => f(m.buckets))];
    const bkPrev = (f) => [...G.map(m => m && m.prevBuckets ? f(m.prevBuckets) : null), both(G.map(m => m && m.prevBuckets ? m : null), m => f(m.prevBuckets))];
    const diff = (cur, prev) => cur.map((c, i) => c != null && prev[i] != null ? { n: c - prev[i] } : null);
    [['Keywords in top 3 (non-brand)', b => b.n.top3, 'n', 'top3'], ['Keywords in top 10 (non-brand)', b => b.n.top10, 'n', 'top10'], ['Keywords in positions 11–20 (non-brand, quick wins)', b => b.n.p11, 'n', 'p11'], ['Keywords in top 3 (brand)', b => b.b.top3, 'b', 'top3'], ['Keywords in top 10 (brand)', b => b.b.top10, 'b', 'top10']]
      .forEach(([l, f, seg, k], j) => { const c = bk(f); row(V1, l, c, 'n', hasPrev ? diff(c, bkPrev(f)) : null, 'GSC', j ? 'click a number to see the keywords' : 'click a number to see the keywords; each query counted once per cluster, total = sum of both'); R[R.length - 1].bucket = { seg, k }; });
    // share of voice and indexation live on other screens: shown here as links so nothing is missing
    R.push({ sec: V1, kpi: 'Share of voice vs 4 competitors', vals: [null, null, null], kind: 'text', chgs: [], src: 'Rank tracker', note: 'fixed keyword set from a rank tracker export', link: ['#visibility', 'Upload on Visibility by page type'] });
    R.push({ sec: V1, kpi: 'Indexed vs submitted pages', vals: [null, null, null], kind: 'text', chgs: [], src: 'GSC', note: 'sitemap level (whole site)', link: ['#visibility', 'Sitemaps on Visibility by page type'] });
    const urlsOf = id => (A.P || []).filter(r => so(r.p) === id && +r.impr > 0);
    const urlC = cols.map(c => urlsOf(c.id).length), urlClk = cols.map(c => urlsOf(c.id).reduce((a, r) => a + (+r.clicks || 0), 0));
    row(V1, 'URLs getting impressions', [...urlC, urlC[0] + urlC[1]], 'n', null, 'GSC', cfg.employer === false ? 'pages Google shows at least once' : 'pages Google shows at least once (programmatic J&I pages: indexation check)');
    row(V1, 'Clicks per URL (traffic per page)', [...urlC.map((n, i) => n ? urlClk[i] / n : null), (urlC[0] + urlC[1]) ? (urlClk[0] + urlClk[1]) / (urlC[0] + urlC[1]) : null], 'dec', null, 'GSC');
    // 2. Traffic
    const T2 = 'Traffic (GA4, organic)';
    const ga = (f) => [...GAc.map(x => x ? f(x) : null), both(GAc, f)];
    const yoy = (f, fy) => { const c = ga(f), p = ga(fy); return c.map((v, i) => pc(v, p[i])); };
    row(T2, 'Organic sessions', ga(x => x.sessions), 'n', yoy(x => x.sessions, x => x.ySessions), 'GA4', 'change vs same dates last year');
    row(T2, 'Organic new users', ga(x => x.newUsers), 'n', yoy(x => x.newUsers, x => x.yNewUsers), 'GA4');
    row(T2, 'Sessions – desktop', ga(x => x.dev.desktop), 'n', yoy(x => x.dev.desktop, x => x.dev.yDesktop), 'GA4');
    row(T2, 'Sessions – mobile', ga(x => x.dev.mobile), 'n', yoy(x => x.dev.mobile, x => x.dev.yMobile), 'GA4');
    const stTxt = x => x.states.length ? x.states.map(([k, v]) => `${k} ${fmtN(Math.round(v))}`).join(', ') : '—';
    const allStates = () => { const m = new Map(); GAc.forEach(x => x && x.stMap.forEach((v, k) => m.set(k, (m.get(k) || 0) + v))); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${fmtN(Math.round(v))}`).join(', ') || '—'; };
    R.push({ sec: T2, kpi: 'Top 3 states (sessions)', vals: [...GAc.map(x => x ? stTxt(x) : null), M ? allStates() : null], kind: 'text', chgs: [], src: 'GA4', note: '' });
    row(T2, 'Landing pages with organic sessions', ga(x => x.landings), 'n', null, 'GA4');
    const pathIds = new Set(s0.pathSections || U.DEFAULT_PATH_SECTIONS);
    R.push({ sec: T2, kpi: 'Share of sessions on pages with a conversion path', vals: [...cols.map((c, i) => GAc[i] ? (pathIds.has(c.id) ? 100 : 0) : null), M ? (both(GAc, x => x.sessions) ? cols.reduce((a, c, i) => a + (pathIds.has(c.id) && GAc[i] ? GAc[i].sessions : 0), 0) / both(GAc, x => x.sessions) * 100 : null) : null], kind: 'pct', chgs: [], src: 'GA4', note: 'clusters marked as having a conversion path (demo / post a job) in Funnel setup' });
    const aiOf = id => M && M.aiPages ? M.aiPages.filter(p => so(p.path) === id).reduce((a, p) => a + p.sessions, 0) : null;
    const aiC = cols.map(c => aiOf(c.id));
    row(T2, 'AI assistant sessions landing here', [...aiC, M ? aiC[0] + aiC[1] : null], 'n', null, 'GA4', 'ChatGPT, Perplexity, Gemini, Copilot… referrals (all channels)');
    // 3. Leads & signups
    const L3 = 'Leads & signups (GA4)';
    let AQ = { qsrc: null, cpsEmp: null }, AS = null;
    if (cfg.employer === false) {
      const ses2 = ga(x => x.sessions);
      row(L3, 'Student signups', ga(x => x.stu), 'n', null, 'GA4', 'signup events in organic sessions that landed here (event names: Funnel setup)');
      row(L3, 'Employer / recruiter signups', ga(x => x.emp), 'n', null, 'GA4');
      row(L3, 'Signup CVR (all signups)', ga(x => x.stu + x.emp).map((v, i) => ratio(v, ses2[i])), 'pct', null, 'GA4', 'signups ÷ organic sessions');
      row(L3, 'Register / apply', ga(x => x.opp), 'n', null, 'GA4');
      row(L3, 'Register / apply per 100 sessions', ga(x => x.opp).map((v, i) => v == null || !ses2[i] ? null : v / ses2[i] * 100), 'dec', null, 'GA4');
      row(L3, 'Product clicks (content → product)', ga(x => x.prodClick), 'n', null, 'GA4');
      row(L3, 'Demo + contact', ga(x => x.demo + x.contact), 'n', null, 'GA4');
    } else {
    row(L3, 'Demo requests', ga(x => x.demo), 'n', null, 'GA4', 'event names: Funnel setup');
    row(L3, 'Contact form submissions', ga(x => x.contact), 'n', null, 'GA4');
    const leads = ga(x => x.demo + x.contact), ses = ga(x => x.sessions);
    row(L3, 'Demo + contact per 1,000 sessions', leads.map((v, i) => v == null || !ses[i] ? null : v / ses[i] * 1000), 'dec', null, 'GA4');
    row(L3, 'Employer / recruiter signups', ga(x => x.emp), 'n', null, 'GA4', 'needs the real employer signup event name');
    row(L3, 'Employer signup CVR', ga(x => x.emp).map((v, i) => ratio(v, ses[i])), 'pct', null, 'GA4', 'signups ÷ organic sessions');
    row(L3, 'Pricing page sessions', ga(x => x.pricing), 'n', null, 'GA4', 'intent signal, not a lead');
    const slRow = (kpi, f, kind, note, ldKind) => R.push({ sec: L3, kpi, vals: [...slT.map(t => t ? f(t) : null), slBoth ? f(slBoth) : null], kind, chgs: [], src: 'Leads sheet', note: note || '', ldKind, link: SLr ? null : (kpi.startsWith('Sales-form leads') ? ['#un-b2e-sales', 'Load the leads sheet'] : null) });
    slRow('Sales-form leads (leads sheet, organic)', t => t.total, 'n', SLr ? 'click a number to see the leads; organic form submissions on these pages, unstop.com emails excluded' : 'connect the B2B Form Leads sheet below', 'any');
    slRow('Official-email leads (company domain)', t => t.official, 'n', '', 'official');
    slRow('Campus-email leads (college / university)', t => t.campus, 'n', '', 'campus');
    slRow('Personal-email leads (Gmail, Yahoo…)', t => t.personal, 'n', '', 'personal');
    slRow('Official-email share', t => t.officialShare, 'pct');
    AQ = acqModel(D);
    R.push({ sec: L3, kpi: 'Cost per organic employer signup', vals: [null, null, AQ.cpsEmp != null ? '₹' + fmtN(Math.round(AQ.cpsEmp)) : null], kind: 'text', chgs: [], src: 'Cost input', note: AQ.cpsEmp != null ? `${AQ.empShare}% of ₹${fmtN(AQ.cost)} a month ÷ all organic employer signups${AQ.costSample ? ' (sample cost)' : ''}` : 'add monthly SEO cost and employer share in Funnel setup', link: AQ.cpsEmp != null ? null : ['#funnelsetup', 'Funnel setup'] });
    const qx = AQ.moe && AQ.moe.seg ? AQ.moe.seg : null;
    [['profile', 'Employer profile completion: organic vs other'], ['act7', 'Employer 7-day activation: organic vs other'], ['ret30', 'Employer 30-day retention: organic vs other']].forEach(([k, l]) => {
      const o = qx && qx.orgEmployer && qx.orgEmployer[k], t = qx && qx.othEmployer && qx.othEmployer[k];
      R.push({ sec: L3, kpi: l, vals: [null, null, o ? `${pct1(o.rate)} vs ${t ? pct1(t.rate) : '—'}` : null], kind: 'text', chgs: [], src: 'MoEngage', note: o ? '' : 'MoEngage export or live dashboard with an employer / recruiter user type', link: o ? null : ['#quality', 'Signup quality'] });
    });
    AS = assistedOf(D);
    }
    if (cfg.employer !== false) R.push({ sec: L3, kpi: 'Assisted employer conversions (organic started, closed elsewhere)', vals: [null, null, AS ? AS.cur.assisted.total : null], kind: 'n', chgs: [null, null, AS ? U.chg(AS.cur.assisted.total, AS.yoy.assisted.total) : null], src: 'GA4', note: 'demo / contact / employer signup events, first visit organic, converting visit another channel' });
    // 4. Engagement
    const E4 = 'Engagement (GA4)', ses = ga(x => x.sessions);
    row(E4, 'Engaged sessions', ga(x => x.engaged), 'n', null, 'GA4');
    row(E4, 'Engagement rate', ga(x => x.engaged).map((v, i) => ratio(v, ses[i])), 'pct', null, 'GA4');
    row(E4, 'Pages per session', ga(x => x.views).map((v, i) => v == null || !ses[i] ? null : v / ses[i]), 'dec', null, 'GA4');
    row(E4, 'Scroll 90% per 100 page views', ga(x => x.scroll).map((v, i) => { const vw = ga(x => x.views)[i]; return v == null || !vw ? null : v / vw * 100; }), 'dec', null, 'GA4');
    R.push({ sec: E4, kpi: 'Return visits within 30 days', vals: [null, null, null], kind: 'text', chgs: [], src: 'GA4', note: 'GA4 cohorts are site-wide, not per landing cluster', link: ['#engagement', 'Engagement'] });
    // 5. Technical
    const S5 = 'Technical (PageSpeed)';
    const ps = f => [...PS.map(x => x ? f(x) : null), null];
    row(S5, 'Core Web Vitals pass rate (field data)', ps(x => x.pass), 'pct', null, 'PageSpeed', 'run from Workstream scorecards › Technical SEO');
    row(S5, 'Median performance score (mobile)', ps(x => x.perf), 'n', null, 'PageSpeed');
    row(S5, 'Pages tested', ps(x => x.tested), 'n', null, 'PageSpeed');
    const cr = scd(D.site).crawl, crR = cr && cr.res && cr.res.ok ? cr.res : null;
    const crOf = id => { if (!crR) return null; const c = crR.clusters.find(x => x.id === id); return c ? c.errors : 0; };
    const crC = cols.map(c => crOf(c.id));
    row(S5, 'Crawl errors (4xx / 5xx)', [...crC, crR ? crC[0] + crC[1] : null], 'n', null, 'Crawl', crR ? '' : 'upload a Screaming Frog crawl in Workstream scorecards › Technical SEO');
    // 6. Needs CRM / finance (kept visible so nothing is silently missing)
    const C6 = 'Pipeline & revenue (CRM)';
    const crm = cfg.employer === false ? null : crmOf(D), C = crm ? crm.res : null;
    // first-touch numbers split by the lead's first landing page (when the CRM export has one)
    const lpOf = id => C && C.landing ? C.landing.filter(x => so(x.path) === id) : [];
    const lpSum = (id, k) => C && C.coverage && C.coverage.landing > 0 ? lpOf(id).reduce((a, x) => a + (x[k] || 0), 0) : null;
    const inr = v => v == null ? null : '₹' + fmtN(Math.round(v));
    const crmRow = (kpi, perCol, total, note) => cfg.employer === false ? null : R.push({ sec: C6, kpi, vals: [...perCol, total], kind: 'text', chgs: [], src: 'CRM', note: C ? note || '' : (kpi.startsWith('MQL') ? 'upload a CRM export (lead source, landing page, stage, amount)' : ''), link: C ? null : (kpi.startsWith('MQL') ? ['#leads', 'Leads & revenue'] : null) });
    crmRow('MQLs from organic (first touch)', cols.map(c => { const v = lpSum(c.id, 'mqls'); return v == null ? null : fmtN(v); }), C && C.ft.mqls != null ? fmtN(C.ft.mqls) : null, 'per column: by the lead’s first landing page');
    crmRow('Pipeline created – organic first touch', cols.map(c => inr(lpSum(c.id, 'pipeline'))), C ? inr(C.ft.pipeline) : null);
    crmRow('Pipeline created – organic in the journey (assisted)', [null, null], C ? inr(C.assisted.pipeline) : null, 'not split by page: assisted leads first landed elsewhere');
    crmRow('Revenue closed – organic first touch', cols.map(c => inr(lpSum(c.id, 'revenue'))), C ? inr(C.ft.revenue) : null);
    crmRow('Revenue closed – organic in the journey (assisted)', [null, null], C ? inr(C.assisted.revenue) : null);
    crmRow('Lead → opportunity: organic vs other channels', [null, null], C ? `${pct1(C.ft.toOpp)} vs ${pct1(C.other.toOpp)}` : null);
    crmRow('Lead → close: organic vs other channels', [null, null], C ? `${pct1(C.ft.toClose)} vs ${pct1(C.other.toClose)}` : null);

    const MID = [[/^Impressions/, 'impr'], [/^Clicks \(non-brand/, 'nbClicks'], [/^Clicks/, 'clicks'], [/^CTR/, 'ctr'], [/^Average position/, 'pos'], [/^Keywords in positions 11/, 'p11'], [/^Keywords in top/, 'top10'], [/^Share of voice/, 'sov'], [/^Indexed|^URLs getting/, 'indexed'], [/^Clicks per URL/, 'clicks'],
      [/^Organic sessions|^Sessions –|^Top 3 states|^Landing pages/, 'sessions'], [/^Organic new users/, 'newUsers'], [/^Share of sessions on pages/, 'pathCov'], [/^AI assistant/, 'aiSessions'],
      [/^Sales-form|email leads|^Official-email share/, 'demo'], [/^Demo/, 'demo'], [/^Contact/, 'contact'], [/^Employer \/ recruiter signups/, 'emp'], [/^Employer signup CVR/, 'cvrEmp'], [/^Pricing/, 'pricing'], [/^Cost per organic employer/, 'cpsEmp'], [/^Employer profile/, 'profile'], [/^Employer 7-day/, 'act7'], [/^Employer 30-day/, 'ret30'], [/^Assisted/, 'assistedGa'],
      [/^Engaged sessions/, 'engaged'], [/^Engagement rate/, 'engRate'], [/^Pages per session/, 'pps'], [/^Scroll/, 'scrollKey'], [/^Return visits/, 'return4w'],
      [/^MQL/, 'mqls'], [/^Pipeline created – organic first/, 'pipeFT'], [/^Pipeline created – organic in/, 'pipeAssist'], [/^Revenue closed – organic first/, 'revFT'], [/^Revenue closed – organic in/, 'revAssist'], [/^Lead → opp/, 'l2o'], [/^Lead → close/, 'l2c']];
    const ownerOf = r => { const m = MID.find(([rx]) => rx.test(r.kpi)); if (!m) return r.src === 'PageSpeed' || r.src === 'Crawl' ? 'Technical SEO + Engineering' : (cfg.employer === false ? 'SEO' : 'B2B SEO'); const mt = U.METRICS.find(x => x.id === m[1]); return (s0.owners || {})[m[1]] || (mt ? mt.owner : 'B2B SEO'); };
    R.forEach(r => { r.owner = ownerOf(r); });
    const heads = [...cols.map(c => c.name), cfg.bothHead || 'Combined (B2E + J&I)'];
    const chgTxt = c => c == null ? '' : typeof c === 'object' ? (c.pos != null ? (c.pos > 0 ? '+' : '') + c.pos.toFixed(1) : (c.n > 0 ? '+' : '') + fmtN(c.n)) : (c > 0 ? '+' : '') + c.toFixed(1) + '%';
    const chgHtml = (c, kpi) => { if (c == null) return ''; if (typeof c === 'object') { const v = c.pos != null ? c.pos : c.n; if (c.pos != null) return dchip(v, true, 'pos'); const good = /11–20/.test(kpi) ? null : v > 0; return `<span class="un-d ${v === 0 ? 'flat' : good === null ? 'flat' : good ? 'up' : 'down'}">${chgTxt(c)}</span>`; } return dchip(c); };
    const cell = (r, i) => { const v = r.vals[i]; if (r.ldKind && v > 0) return ldLink(v, { range: 'period', kind: r.ldKind, cluster: i === 2 ? 'both' : ids[i], label: `${heads[i]} · ${r.kpi}` }, fmtV(v, r.kind)); if (r.kind === 'text') return v == null ? '<span class="un-n">—</span>' : `<span class="un-b2e-t">${esc(v)}</span>`; if (r.bucket && v > 0) return `<a href="#" class="un-b2e-kw" data-kw="${r.bucket.seg}|${r.bucket.k}|${i}" title="Show these keywords">${fmtV(v, r.kind)}</a>`; return fmtV(v, r.kind); };
    const status = r => r.src === 'GSC' ? (live ? 'live' : D.source === 'demo' ? 'sample' : 'file') : r.src === 'GA4' ? (!g ? 'none' : g.sample ? 'sample' : 'live') : r.src === 'PageSpeed' ? (!psi ? 'none' : psi.sample ? 'sample' : 'live') : r.src === 'Crawl' ? (!crR ? 'none' : cr.sample ? 'sample' : 'file') : r.src === 'CRM' ? (!C ? 'none' : crm.sample ? 'sample' : 'file') : r.src === 'MoEngage' ? (!AQ.qsrc ? 'none' : AQ.qsrc) : r.src === 'Cost input' ? (AQ.cpsEmp == null ? 'none' : AQ.costSample ? 'sample' : 'input') : r.src === 'Rank tracker' ? 'file' : r.src === 'Leads sheet' ? (!SLr ? 'none' : SLd.source === 'sample' ? 'sample' : SLd.source === 'sheet' ? 'live' : 'file') : 'later';
    let lastSec = '';
    // which columns to show and copy: all three, or just B2E, just B2E (J&I) or just the combined total
    const VIEW = cols[1].dummy ? '0' : (b2eState(SK).view || 'all'), shown = VIEW === 'all' ? [0, 1, 2] : [+VIEW];
    const trs = R.map(r => { const s = r.sec !== lastSec ? `<tr class="un-b2e-sec"><th colspan="${shown.length * 2 + 3}">${esc(r.sec)}</th></tr>` : ''; lastSec = r.sec; return s + `<tr><td>${esc(r.kpi)}${r.note ? `<br><small class="un-n">${esc(r.note)}</small>` : ''}</td>${shown.map(i => `<td class="r"><b>${cell(r, i)}</b></td><td class="r un-b2e-d">${chgHtml(r.chgs[i], r.kpi)}</td>`).join('')}<td>${r.link ? `<a href="${esc(r.link[0])}">${esc(r.link[1])} →</a>` : chip(status(r))}</td><td class="un-b2e-o">${esc(r.owner)}</td></tr>`; }).join('');
    const tsv = () => {
      // changes go out as plain numbers ("46.5%", "-3.9") with no leading +, so Google Sheets reads them as numbers
      const chgOut = c => c == null ? '' : typeof c === 'object' ? (c.pos != null ? c.pos.toFixed(1) : String(c.n)) : c.toFixed(1) + '%';
      const lines = [['Section', 'KPI', ...shown.flatMap(i => [heads[i], heads[i] + ' change']), 'Source', 'Owner', 'Note'].join('\t')];
      R.forEach(r => lines.push([r.sec, r.kpi, ...shown.flatMap(i => [r.kind === 'text' ? (r.vals[i] == null ? '' : r.vals[i]) : (r.vals[i] == null || !isFinite(r.vals[i]) ? '' : r.kind === 'n' ? String(Math.round(r.vals[i])) : fmtV(r.vals[i], r.kind)), chgOut(r.chgs[i])]), r.src, r.owner, r.note].join('\t')));
      return lines.join('\n');
    };
    const period = `${fmtD(D.start)} – ${fmtD(D.end)}${hasPrev ? ` · Search Console changes vs ${fmtD(D.prevStart)} – ${fmtD(D.prevEnd)}` : ' · turn on “Compare with the previous period” for week-on-week changes'}${g ? ` · GA4 ${fmtD(g.start)} – ${fmtD(g.end)}, changes vs same dates last year` : ''}`;
    const notes = [];
    if (loading) notes.push('Loading B2E and B2E (J&I) from Search Console…');
    if (errs.length) notes.push(`<span class="start-error">Search Console: ${esc(errs.join('; '))}</span>`);
    if (!g) { const ga = gaAutoState(D); notes.push(ga === 'loading' ? 'Loading GA4 for the same dates…' : ga === 'noprop' ? 'Signed in, but no Unstop GA4 property was found on this account: pick it once on <a href="#ga4">GA4 organic</a>.' : ga === 'error' ? `${esc(MSG.ga)} · <a href="#ga4">Load it on GA4 organic</a>` : live ? 'GA4 loads automatically after <b>Connect Search Console</b> when GA4 access was allowed in the same sign-in. Otherwise press Connect GA4 on <a href="#ga4">GA4 organic</a>.' : 'GA4 is not loaded: open <a href="#ga4">GA4 organic</a> and press Load GA4 data.'); }
    if (!live && D.source !== 'demo') notes.push('Search Console numbers here come from an upload; brand / non-brand split is an estimate. Connect Search Console for exact numbers.');
    if (D.source === 'demo') notes.push('<b>Sample data.</b> Connect Search Console and GA4 for real numbers.');
    // top landing pages
    // ── first review: the three questions, answered for the employer side ──
    const reviewPanel = () => {
      const isB = brandOf(A), qp = new Map();
      (D.QP || []).forEach(r => { const k = U.pathOnly(r.p).toLowerCase(); const o = qp.get(k) || { b: 0, n: 0 }; if (isB(r.q)) o.b += +r.clicks || 0; else o.n += +r.clicks || 0; qp.set(k, o); });
      const slByPage = new Map(); if (SLr) SLr.leads.filter(l => l.organic && slIn(l) && l.kind !== 'internal').forEach(l => { const o = slByPage.get(l.path) || { n: 0, off: 0 }; o.n++; if (l.kind === 'official') o.off++; slByPage.set(l.path, o); });
      const pg = M ? M.pages.filter(p => cols.some(c => so(p.path) === c.id)).map(p => { const sl = slByPage.get(p.path.toLowerCase()) || { n: 0, off: 0 }; return { ...p, cluster: so.label(so(p.path)), sl: sl.n, slOff: sl.off, conv: cfg.employer === false ? p.stu + p.emp : p.emp + p.demo + p.contact + sl.n }; }) : [];
      const top = pg.filter(p => p.conv > 0).sort((a, b) => b.conv - a.conv || b.sessions - a.sessions).slice(0, 10);
      let wn = 0, wt = 0, covered = 0, all = 0;
      pg.forEach(p => { all += p.conv; const x = qp.get(p.path.toLowerCase()); if (!x || !(x.b + x.n)) return; covered += p.conv; wt += p.conv; wn += p.conv * x.n / (x.b + x.n); });
      const nbShare = wt ? wn / wt * 100 : null;
      const EMP = cfg.employer !== false;
      const q1 = !M ? '<p class="un-n">Load GA4 data to answer this.</p>' : !EMP && top.length ? `<div class="tw"><table class="un-mini"><thead><tr><th>Page</th><th>Folder</th><th class="r">Student signups</th><th class="r">Employer signups</th><th class="r">Register / apply</th><th class="r">Sessions</th></tr></thead><tbody>${top.map(p => `<tr><td class="u"><a href="${esc(focusHref({ u: p.path }))}">${esc(p.path)}</a></td><td>${esc(p.cluster)}</td><td class="r">${fmtN(Math.round(p.stu))}</td><td class="r">${fmtN(Math.round(p.emp))}</td><td class="r">${fmtN(Math.round(p.opp))}</td><td class="r">${fmtN(Math.round(p.sessions))}</td></tr>`).join('')}</tbody></table></div>` : top.length ? `<div class="tw"><table class="un-mini"><thead><tr><th>Page</th><th>Cluster</th><th class="r">Employer signups</th><th class="r">Demo + contact</th>${SLr ? '<th class="r">Sales-form leads (official)</th>' : ''}<th class="r">Sessions</th></tr></thead><tbody>${top.map(p => `<tr><td class="u"><a href="${esc(focusHref({ u: p.path }))}">${esc(p.path)}</a></td><td>${esc(p.cluster)}</td><td class="r">${fmtN(Math.round(p.emp))}</td><td class="r">${fmtN(Math.round(p.demo + p.contact))}</td>${SLr ? `<td class="r">${fmtN(p.sl)} (${fmtN(p.slOff)})</td>` : ''}<td class="r">${fmtN(Math.round(p.sessions))}</td></tr>`).join('')}</tbody></table></div>` : `<p class="un-n">No ${EMP ? 'employer signup, demo or contact' : 'signup'} events on these pages yet: check the event names in Funnel setup.</p>`;
      const q2 = !M ? '<p class="un-n">Load GA4 data to answer this.</p>' : nbShare == null ? '<p class="un-n">Needs Search Console query × page rows for these pages.</p>' : `<p class="un-big"><b>${pct1(nbShare)}</b> <span>of ${EMP ? 'employer signups + leads' : 'signups'} came from non-branded searches (estimate)</span></p><p class="hint">Each page’s signups and leads × that page’s non-branded share of clicks. Google does not tie a search to a signup, so this is a proxy, not an exact count. Covers ${pct1(all ? covered / all * 100 : 0)} of conversions (pages with query data).</p>`;
      const q3 = C ? `<div class="grid-2 even"><p class="un-big"><b>${inr(C.ft.pipeline)}</b> <span>pipeline with organic as first touch</span></p><p class="un-big"><b>${inr(C.assisted.pipeline)}</b> <span>pipeline with organic in the journey (assisted)</span></p></div><p class="hint">Kept separate, never added together. ${fmtN(C.ft.leads)} organic first-touch leads, ${fmtN(C.ft.opps)} opportunities. Source known on ${pct1(C.coverage.source)} of CRM leads${C.coverage.landing ? `, landing page on ${pct1(C.coverage.landing)}` : ''}.${crm.sample ? ' Sample CRM data.' : ''}</p>` : `<p class="un-n">Not traceable yet: upload a CRM export with lead source, landing page, stage and amount on <a href="#leads">Leads & revenue</a>.</p>`;
      return `<section class="panel"><div class="panel-h"><h2>First review: ${EMP ? 'the three questions (employer side)' : 'signups from these pages'}</h2></div><div class="panel-b">
        <h3 class="un-sub">1. Which ${EMP ? 'employer ' : ''}pages drove the most signups${EMP ? ' and leads' : ''} (not the most traffic)?</h3>${q1}
        <h3 class="un-sub">2. What share of organic signups${EMP ? ' and leads' : ''} comes from non-branded queries?</h3>${q2}
        ${EMP ? `<h3 class="un-sub">3. How much pipeline can we trace to organic?</h3>${q3}` : ''}
        <p class="hint">Cadence: <b>weekly</b> the Visibility rows (indexation, rankings, impressions) · <b>monthly</b> traffic → signups → leads · <b>quarterly</b> pipeline, revenue, cost and what to stop. Decisions and owners are logged on <a href="#reviews">Reviews</a>.</p></div></section>`;
    };
    // keywords behind a bucket count (clicked in the table)
    const kwSel = B2E_KW.get(SK);
    delete TABLES['t-un-b2e-kw'];
    function kwPanel() {
      if (!kwSel) return '';
      const { seg, k, i, topic } = kwSel, lab = { top3: 'in top 3', top10: 'in top 10', p11: 'in positions 11–20', all: '' }[k];
      const idx = i === 2 ? [0, 1] : [i];
      const isBr = brandOf(A);
      const rows = idx.flatMap(j => { const m = G[j]; if (!m) return []; const src = topic ? (m.allQueries || []).filter(r => b2eTopic(r.q) === topic && (seg === 'b') === !!isBr(r.q) && (k === 'all' || (k === 'top10' ? r.pos <= 10 : r.pos > 10 && r.pos <= 20))) : (m.bucketLists ? m.bucketLists[seg][k] : []); return src.map(r => ({ ...r, cluster: cols[j].name, ctr: r.impr ? r.clicks / r.impr * 100 : 0 })); }).sort((a, b) => b.impr - a.impr);
      const title = `${i === 2 ? bothName : cols[i].name}: ${topic ? topic + ', ' : ''}${seg === 'n' ? 'non-brand' : 'brand'} keywords ${lab} (${fmtN(rows.length)})`.replace(/ \(/, ' (').replace(/\s+\(/, ' (');
      return `<section class="panel" id="un-b2e-kwp"><div class="panel-h"><h2>${esc(title)}</h2><p>Search Console, ${esc(fmtD(D.start))} – ${esc(fmtD(D.end))}. Position is the average for this cluster’s pages. <button class="btn-quiet sm" type="button" id="un-b2e-kwx">Close</button></p></div>` +
        table('t-un-b2e-kw', [{ k: 'q', l: 'Keyword', cls: 'q', f: r => `<a href="https://www.google.com/search?q=${encodeURIComponent(r.q)}&gl=in&hl=en" target="_blank" rel="noopener">${esc(r.q)}</a>`, csv: r => r.q }, ...(i === 2 ? [{ k: 'cluster', l: 'Cluster' }] : []), { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) }, { k: 'impr', l: 'Impressions', r: 1, f: r => fmtN(r.impr) }, { k: 'ctr', l: 'CTR', r: 1, f: r => pct1(r.ctr) }, { k: 'pos', l: 'Position', r: 1, f: r => posTag(r.pos), csv: r => r.pos.toFixed(1) }],
          rows, { file: cfg.file + '-' + (topic ? topic.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' : '') + (seg === 'n' ? 'nonbrand' : 'brand') + '-' + k, sort: 'impr', pageSize: 50, placeholder: 'Filter keywords' }) + '</section>';
    }
    // ═══ extra sections: alerts, weekly trend, products, topics, quick wins, all landing pages ═══
    const ST = b2eState(SK);
    const XK = b2eKey(D) + '|' + cfg.key + (cfg.key === 'b2e' ? '' : '|' + realIds.map(id => JSON.stringify((so.sections.find(x => x.id === id) || {}).rules)).join());
    const X = live ? B2EX.get(XK) : b2eFromRows(A, D, realIds, cfg.so);
    const xReady = X && X.status === 'done';
    const isB = brandOf(A);
    const clusterName = id => (cols.find(c => c.id === id) || { name: so.label(id) }).name;
    // query × page rows of the employer pages (brand split per page / product, ranking page per query)
    const { QPe, pageQ, qpBest } = memo('qp|' + D.site, [D.QP, so, A.brandRx, ids.join()], () => {
      const QPe = (D.QP || []).filter(r => ids.includes(so(r.p)));
      const pageQ = new Map(), qpBest = new Map();
      QPe.forEach(r => { const k = U.pathOnly(r.p).toLowerCase(); const o = pageQ.get(k) || { b: 0, n: 0 }; const br = isB(r.q); if (br) o.b += +r.clicks || 0; else { o.n += +r.clicks || 0; const x = qpBest.get(r.q); if (!x || (+r.impr || 0) > x.impr) qpBest.set(r.q, { p: r.p, impr: +r.impr || 0 }); } pageQ.set(k, o); });
      return { QPe, pageQ, qpBest };
    });
    const gaPage = new Map(M ? M.pages.map(p => [p.path.toLowerCase(), p]) : []);
    const prevPage = new Map((D.prevP || []).map(r => [r.p, r]));
    // all landing pages
    const pagesAll = (A.P || []).filter(r => ids.includes(so(r.p))).map(r => {
      const path = U.pathOnly(r.p), lk = path.toLowerCase(), gp = gaPage.get(lk), qx = pageQ.get(lk), pr = prevPage.get(r.p);
      return { p: r.p, path, product: b2eProduct(r.p), cluster: clusterName(so(r.p)), clicks: +r.clicks || 0, impr: +r.impr || 0, ctr: r.impr ? r.clicks / r.impr * 100 : 0, pos: +r.pos || 0, dClicks: pr ? U.chg(r.clicks, pr.clicks) : null,
        nbC: qx ? qx.n : null, bC: qx ? qx.b : null, sessions: gp ? gp.sessions : null, dSes: gp ? U.chg(gp.sessions, gp.ySessions) : null, leads: gp ? gp.demo + gp.contact : null, emp: gp ? gp.emp : null };
    });
    // ── drop alerts ──
    let alertHtml = '', alertTop = '';
    if (live && (!X || X.status === 'loading')) alertHtml = '<p class="progress">Loading this week vs last week from Search Console…</p>';
    else if (X && X.status === 'error') alertHtml = `<p class="start-error">${esc(X.error)}</p>`;
    else if (xReady) {
      const pd = realIds.flatMap(id => b2eDrops(X.cur[id].pages, X.prev[id].pages, 10).map(r => ({ ...r, cluster: clusterName(id), path: U.pathOnly(r.k) })));
      const kd = realIds.flatMap(id => b2eDrops(X.cur[id].queries.filter(q => !isB(q.k)), X.prev[id].queries.filter(q => !isB(q.k)), 5).map(r => ({ ...r, cluster: clusterName(id) })));
      const win = X.periodBased ? `${fmtD(D.start)} – ${fmtD(D.end)} vs the previous period` : `${fmtD(X.W.curS)} – ${fmtD(X.W.end)} vs ${fmtD(X.W.prevS)} – ${fmtD(X.W.prevE)}`;
      const lost = pd.reduce((a, r) => a + r.lost, 0);
      alertTop = pd.length || kd.length ? `<div class="note un-b2e-alert"><b>${fmtN(pd.length)} page${pd.length === 1 ? '' : 's'} and ${fmtN(kd.length)} non-brand keyword${kd.length === 1 ? '' : 's'} dropped</b> (${esc(win)}): about ${fmtN(Math.round(lost))} clicks lost on pages. <a href="#" data-jump="un-b2e-alerts">See the drops and why →</a></div>` : `<div class="note">No drops this week (${esc(win)}).</div>`;
      const dRow = (r, label) => `<tr><td class="${label === 'page' ? 'u' : 'q'}">${label === 'page' ? `<a href="${esc(focusHref({ u: r.path }))}">${esc(r.path)}</a>` : esc(r.k)}</td><td>${esc(r.cluster)}</td><td class="r">${fmtN(Math.round(r.prevClicks))} → ${fmtN(Math.round(r.clicks))} ${dchip(r.dc)}</td><td class="r">${r.prevPos ? r.prevPos.toFixed(1) : '—'} → ${r.pos ? r.pos.toFixed(1) : '—'}</td><td class="r">${fmtN(Math.round(r.prevImpr))} → ${fmtN(Math.round(r.impr))}</td><td>${esc(r.why)}</td></tr>`;
      const dTbl = (list, label) => list.length ? `<div class="tw"><table class="un-mini"><thead><tr><th>${label === 'page' ? 'Landing page' : 'Keyword'}</th><th>Cluster</th><th class="r">Clicks</th><th class="r">Position</th><th class="r">Impressions</th><th>Likely reason</th></tr></thead><tbody>${list.slice(0, 20).map(r => dRow(r, label)).join('')}</tbody></table></div>${list.length > 20 ? `<p class="hint">Showing the 20 biggest of ${fmtN(list.length)}.</p>` : ''}` : '<p class="un-n">None.</p>';
      alertHtml = `<p class="hint">${esc(win)}. Flagged when clicks fell 30% or more (pages with 10+ clicks, keywords with 5+) or the position slipped 3+ places.${X.periodBased ? ' Connect Search Console for a true week-on-week check.' : ''}</p><h3 class="un-sub">Landing pages</h3>${dTbl(pd, 'page')}<h3 class="un-sub">Non-brand keywords</h3>${dTbl(kd, 'kw')}`;
    }
    // ── weekly trend ──
    let trendHtml = '';
    if (live && (!X || X.status === 'loading')) trendHtml = '<p class="progress">Loading 16 weeks from Search Console…</p>';
    else if (xReady && Object.keys(X.weekly).length) {
      const wk = [...new Set(realIds.flatMap(id => (X.weekly[id] ? X.weekly[id].nb : []).map(r => r.w)))].sort();
      const val = (id, w, m) => { const s = X.weekly[id]; if (!s) return null; const r = (m === 'b' ? s.b : s.nb).find(x => x.w === w); return r ? r : null; };
      trendHtml = `<div class="un-tabs" role="tablist">${[['nb', 'Non-brand clicks'], ['nbi', 'Non-brand impressions'], ['pos', 'Non-brand position'], ['b', 'Brand clicks']].map(([k, l]) => `<button type="button" class="${ST.trend === k ? 'on' : ''}" data-b2t="${k}">${l}</button>`).join('')}</div><div class="chart-box un-tall"><canvas id="un-b2e-ch" aria-label="Weekly trend B2E vs B2E (J&I)"></canvas></div>
        <div class="tw"><table class="un-mini"><thead><tr><th>Week starting</th>${cols.filter(c => !c.dummy).map(c => `<th class="r">${esc(c.name)} NB clicks</th><th class="r">${esc(c.name)} NB position</th><th class="r">${esc(c.name)} brand clicks</th>`).join('')}</tr></thead><tbody>${wk.slice().reverse().slice(0, 8).map(w => { const part = realIds.some(id => { const r = val(id, w, 'nb'); return r && r.partial; }); return `<tr><td>${fmtD(w)}${part ? ' <span class="tag">partial</span>' : ''}</td>${realIds.map(id => { const n = val(id, w, 'nb'), b = val(id, w, 'b'); return `<td class="r">${n ? fmtN(n.clicks) : '—'}</td><td class="r">${n && n.impr ? n.pos.toFixed(1) : '—'}</td><td class="r">${b ? fmtN(b.clicks) : '—'}</td>`; }).join('')}</tr>`; }).join('')}</tbody></table></div>${X.sample ? '<p class="hint">Sample weekly series generated from the sample totals.</p>' : `<p class="hint">Last 16 weeks to ${fmtD(D.end)}, Monday-start weeks.</p>`}`;
    } else trendHtml = '<p class="un-n">Weekly trend needs a live Search Console connection (an upload has no daily rows per cluster).</p>';
    // ── products ──
    const prodMap = new Map();
    pagesAll.forEach(r => { const o = prodMap.get(r.product) || { product: r.product, clusters: new Set(), pages: 0, clicks: 0, impr: 0, posW: 0, pClicks: 0, hasPrev: false, nbC: 0, bC: 0, sessions: 0, ySes: 0, leads: 0, emp: 0, ga: false, q: new Map() }; o.clusters.add(r.cluster); o.pages++; o.clicks += r.clicks; o.impr += r.impr; o.posW += r.pos * r.impr; const pr = prevPage.get(r.p); if (pr) { o.pClicks += +pr.clicks || 0; o.hasPrev = true; } o.nbC += r.nbC || 0; o.bC += r.bC || 0; const gp = gaPage.get(r.path.toLowerCase()); if (gp) { o.ga = true; o.sessions += gp.sessions; o.ySes += gp.ySessions; o.leads += gp.demo + gp.contact; o.emp += gp.emp; } prodMap.set(r.product, o); });
    QPe.forEach(r => { if (isB(r.q)) return; const o = prodMap.get(b2eProduct(r.p)); if (!o) return; const x = o.q.get(r.q) || { impr: 0, posW: 0 }; x.impr += +r.impr || 0; x.posW += (+r.pos || 0) * (+r.impr || 0); o.q.set(r.q, x); });
    const prods = [...prodMap.values()].map(o => { let t10 = 0, p11 = 0; o.q.forEach(x => { const p = x.impr ? x.posW / x.impr : 99; if (p <= 10) t10++; else if (p <= 20) p11++; }); return { product: o.product, clusters: [...o.clusters].join(', '), pages: o.pages, clicks: o.clicks, impr: o.impr, ctr: o.impr ? o.clicks / o.impr * 100 : 0, pos: o.impr ? o.posW / o.impr : 0, dClicks: o.hasPrev ? U.chg(o.clicks, o.pClicks) : null, nbC: QPe.length ? o.nbC : null, bC: QPe.length ? o.bC : null, t10: QPe.length ? t10 : null, p11: QPe.length ? p11 : null, sessions: o.ga ? o.sessions : null, dSes: o.ga ? U.chg(o.sessions, o.ySes) : null, leads: o.ga ? o.leads : null, emp: o.ga ? o.emp : null }; });
    delete TABLES['t-un-b2e-prod'];
    const nOr = v => v == null ? '—' : fmtN(Math.round(v));
    const prodHtml = table('t-un-b2e-prod', [
      { k: 'product', l: 'Product', f: r => `<a href="#" data-prod="${esc(r.product)}"><b>${esc(r.product)}</b></a><br><small class="un-n">${esc(r.clusters)} · ${fmtN(r.pages)} page${r.pages === 1 ? '' : 's'}</small>`, csv: r => r.product },
      { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) + ' ' + (D.prevStart ? dchip(r.dClicks) : ''), csv: r => r.clicks }, { k: 'impr', l: 'Impr.', r: 1, f: r => fmtN(r.impr) }, { k: 'ctr', l: 'CTR', r: 1, f: r => pct1(r.ctr) }, { k: 'pos', l: 'Position', r: 1, f: r => r.impr ? posTag(r.pos) : '—', csv: r => r.pos.toFixed(1) },
      { k: 'nbC', l: 'Non-brand clicks', r: 1, f: r => nOr(r.nbC) }, { k: 'bC', l: 'Brand clicks', r: 1, f: r => nOr(r.bC) }, { k: 't10', l: 'NB keywords top 10', r: 1, f: r => nOr(r.t10) }, { k: 'p11', l: 'NB 11–20', r: 1, f: r => nOr(r.p11) },
      ...(M ? [{ k: 'sessions', l: 'Organic sessions', r: 1, f: r => r.sessions == null ? '—' : fmtN(Math.round(r.sessions)) + ' ' + dchip(r.dSes), csv: r => r.sessions }, { k: 'leads', l: 'Demo + contact', r: 1, f: r => nOr(r.leads) }, { k: 'emp', l: 'Employer signups', r: 1, f: r => nOr(r.emp) }] : [])
    ], prods, { file: cfg.file + '-products', sort: 'clicks', pageSize: 40, search: false });
    // ── search topics: brand vs non-brand ──
    const tcol = ST.topicCol, tIdx = tcol === 2 ? [0, 1] : [tcol];
    const tq = tIdx.flatMap(j => G[j] && G[j].allQueries ? G[j].allQueries.map(r => ({ ...r, cluster: cols[j].name })) : []);
    const tm = new Map();
    tq.forEach(r => { const t = b2eTopic(r.q), o = tm.get(t) || { topic: t, n: { clicks: 0, impr: 0, posW: 0, k: 0, t10: 0, p11: 0 }, b: { clicks: 0, impr: 0, posW: 0, k: 0 } }; const x = isB(r.q) ? o.b : o.n; x.clicks += +r.clicks || 0; x.impr += +r.impr || 0; x.posW += (+r.pos || 0) * (+r.impr || 0); x.k++; if (!isB(r.q)) { if (r.pos <= 10) o.n.t10++; else if (r.pos <= 20) o.n.p11++; } tm.set(t, o); });
    const topics = [...tm.values()].map(o => ({ topic: o.topic, nClicks: o.n.clicks, nImpr: o.n.impr, nCtr: o.n.impr ? o.n.clicks / o.n.impr * 100 : 0, nPos: o.n.impr ? o.n.posW / o.n.impr : null, nK: o.n.k, t10: o.n.t10, p11: o.n.p11, bClicks: o.b.clicks, bImpr: o.b.impr, bCtr: o.b.impr ? o.b.clicks / o.b.impr * 100 : 0, bPos: o.b.impr ? o.b.posW / o.b.impr : null, bK: o.b.k }));
    delete TABLES['t-un-b2e-top'];
    const tLink = (v, topic, seg, k) => v ? `<a href="#" data-tkw="${esc(topic)}|${seg}|${k}" title="Show these keywords">${fmtN(Math.round(v))}</a>` : '0';
    const topicHtml = (live && G.some(m => !m)) ? '<p class="progress">Loading…</p>' : G.some(m => m && !m.allQueries) ? '<p class="un-n">Press Reload Search Console to load the full query list.</p>' :
      `<label class="field un-f sm" style="max-width:260px"><span>Cluster</span><select id="un-b2e-tcol">${[[2, bothName], [0, cols[0].name], [1, cols[1].name]].filter(([v]) => !(v !== 0 && cols[1].dummy)).map(([v, l]) => `<option value="${v}" ${tcol === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` +
      table('t-un-b2e-top', [
        { k: 'topic', l: 'Search topic', f: r => `<b>${esc(r.topic)}</b>`, csv: r => r.topic },
        { k: 'nClicks', l: 'NB clicks', r: 1, f: r => fmtN(r.nClicks) }, { k: 'nImpr', l: 'NB impr.', r: 1, f: r => fmtN(r.nImpr) }, { k: 'nCtr', l: 'NB CTR', r: 1, f: r => pct1(r.nCtr) }, { k: 'nPos', l: 'NB position', r: 1, f: r => r.nPos == null ? '—' : posTag(r.nPos), csv: r => r.nPos },
        { k: 'nK', l: 'NB keywords', r: 1, f: r => tLink(r.nK, r.topic, 'n', 'all') }, { k: 't10', l: 'NB top 10', r: 1, f: r => tLink(r.t10, r.topic, 'n', 'top10') }, { k: 'p11', l: 'NB 11–20', r: 1, f: r => tLink(r.p11, r.topic, 'n', 'p11') },
        { k: 'bClicks', l: 'Brand clicks', r: 1, f: r => fmtN(r.bClicks) }, { k: 'bCtr', l: 'Brand CTR', r: 1, f: r => r.bImpr ? pct1(r.bCtr) : '—' }, { k: 'bPos', l: 'Brand position', r: 1, f: r => r.bPos == null ? '—' : posTag(r.bPos), csv: r => r.bPos }, { k: 'bK', l: 'Brand keywords', r: 1, f: r => tLink(r.bK, r.topic, 'b', 'all') }
      ], topics, { file: cfg.file + '-search-topics', sort: 'nClicks', pageSize: 30, search: false });
    // ── quick wins: non-brand keywords in positions 11–20 with the page that ranks and the next step ──
    const qwAll = [0, 1].flatMap(j => G[j] && G[j].allQueries ? G[j].allQueries.filter(r => !isB(r.q) && r.pos > 10 && r.pos <= 20).map(r => ({ ...r, cluster: cols[j].name })) : []);
    const qw = qwAll.map(r => {
      const pg = qpBest.get(r.q), path = pg ? U.pathOnly(pg.p) : null;
      const action = !path ? 'Find the page that should rank for this search (none in the page × query data) and link to it from the employer hub' : r.pos <= 13 ? 'Close to page 1: add 2–3 internal links with this phrase as anchor text and use the phrase in the title and H1' : r.impr >= 500 ? 'High demand: add a section or FAQ that answers this search directly on the page, then link to it' : 'Expand the page for this search (a focused section, examples, FAQ) and add internal links';
      return { ...r, path, url: pg ? pg.p : null, topic: b2eTopic(r.q), action, score: r.impr * (21 - r.pos) / 10 };
    }).sort((a, b) => b.score - a.score);
    delete TABLES['t-un-b2e-qw'];
    const QW = qw.slice(0, 300);
    const qwHtml = (live && G.some(m => !m)) ? '<p class="progress">Loading…</p>' : !QW.length ? '<p class="un-n">No non-brand keywords in positions 11–20 for these pages.</p>' :
      `<div class="un-row" style="margin-bottom:8px"><button class="btn-primary sm" type="button" id="un-b2e-qw10">Add the top 10 to the Action board</button><span class="hint" id="un-b2e-qwmsg">${fmtN(qw.length)} quick wins, most impressions × closeness to page 1 first.</span></div>` +
      table('t-un-b2e-qw', [
        { k: 'q', l: 'Keyword', cls: 'q', f: r => `<a href="https://www.google.com/search?q=${encodeURIComponent(r.q)}&gl=in&hl=en" target="_blank" rel="noopener">${esc(r.q)}</a><br><small class="un-n">${esc(r.topic)}</small>`, csv: r => r.q },
        { k: 'cluster', l: 'Cluster' }, { k: 'pos', l: 'Position', r: 1, f: r => posTag(r.pos), csv: r => r.pos.toFixed(1) }, { k: 'impr', l: 'Impr.', r: 1, f: r => fmtN(r.impr) }, { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) },
        { k: 'path', l: 'Page that ranks', cls: 'u', f: r => r.path ? `<a href="${esc(focusHref({ u: r.path }))}">${esc(r.path)}</a>` : '<span class="un-n">not found</span>', csv: r => r.path || '' },
        { k: 'action', l: 'Next step', f: r => `<small>${esc(r.action)}</small>` },
        { k: 'add', l: '', f: r => `<button class="btn-quiet sm" type="button" data-qw="${QW.indexOf(r)}">Add task</button>`, csv: () => '' }
      ], QW, { file: cfg.file + '-quick-wins', sort: 'score', pageSize: 25, placeholder: 'Filter keywords or pages', searchKeys: ['q', 'path', 'topic'] });
    // ── all landing pages (filtered by a product when one is picked) ──
    delete TABLES['t-un-b2e-pages'];
    const pList = ST.product ? pagesAll.filter(r => r.product === ST.product) : pagesAll;
    const pagesHtml = `${ST.product ? `<p class="un-row"><span class="un-chip">Product: <b>${esc(ST.product)}</b></span> <a href="#" id="un-b2e-pall">Show all ${fmtN(pagesAll.length)} pages</a></p>` : ''}` +
      table('t-un-b2e-pages', [
        { k: 'path', l: 'Landing page', cls: 'u', f: r => `<a href="${esc(focusHref({ u: r.path }))}">${esc(r.path)}</a>`, csv: r => r.p },
        { k: 'product', l: 'Product', f: r => `<a href="#" data-prod="${esc(r.product)}">${esc(r.product)}</a>`, csv: r => r.product }, { k: 'cluster', l: 'Cluster' },
        { k: 'clicks', l: 'Clicks', r: 1, f: r => fmtN(r.clicks) + ' ' + (D.prevStart ? dchip(r.dClicks) : ''), csv: r => r.clicks }, { k: 'impr', l: 'Impr.', r: 1, f: r => fmtN(r.impr) }, { k: 'ctr', l: 'CTR', r: 1, f: r => pct1(r.ctr) }, { k: 'pos', l: 'Position', r: 1, f: r => r.impr ? posTag(r.pos) : '—', csv: r => r.pos.toFixed(1) },
        { k: 'nbC', l: 'Non-brand clicks', r: 1, f: r => nOr(r.nbC) }, { k: 'bC', l: 'Brand clicks', r: 1, f: r => nOr(r.bC) },
        ...(M ? [{ k: 'sessions', l: 'Organic sessions', r: 1, f: r => r.sessions == null ? '—' : fmtN(Math.round(r.sessions)) + ' ' + dchip(r.dSes), csv: r => r.sessions }, { k: 'leads', l: 'Demo + contact', r: 1, f: r => nOr(r.leads) }, { k: 'emp', l: 'Employer signups', r: 1, f: r => nOr(r.emp) }] : [])
      ], pList, { file: cfg.file + '-landing-pages', sort: 'clicks', pageSize: 50, placeholder: 'Filter URLs or products', searchKeys: ['path', 'product', 'cluster'] });
    // ── the leads behind a clicked count ──
    const LDSEL = B2E_LD.get(SK); let ldTsv = '';
    delete TABLES['t-un-b2e-ld'];
    function leadPanel() {
      if (!LDSEL || !SLr) return '';
      const rows = SLr.leads.filter(ldMatch(LDSEL)).map(l => ({ ...l, place: salesPlace(l.path, so) })).sort((a, b) => String(b.day).localeCompare(String(a.day)));
      const KN = { official: 'Official', campus: 'Campus', personal: 'Personal', internal: 'Internal', unknown: '—' };
      ldTsv = [['Date', 'Name', 'Email domain', 'Email type', 'User type', 'New / existing', 'Page', 'Product / area', 'Source'].join('\t'), ...rows.map(l => [l.day || '', l.name || '', l.domain, KN[l.kind] || l.kind, l.usertype, l.status, l.path, l.place.area, l.source].map(v => String(v == null ? '' : v).replace(/[\t\n]/g, ' ')).join('\t'))].join('\n');
      return `<section class="panel un-ldp" id="un-b2e-ldp"><div class="panel-h"><h2>${esc(LDSEL.label || 'Leads')} (${fmtN(rows.length)})</h2><p>${LDSEL.range === 'all' ? 'Everything in the sheet' : `${esc(fmtD(D.start))} – ${esc(fmtD(D.end))}`} · ${LDSEL.nonOrg ? 'non-organic sources' : LDSEL.all || LDSEL.source ? 'all channels' : 'organic'} · newest first. Only the name and email domain are shown. <button class="btn-primary sm" type="button" id="un-ld-copy">Copy for Google Sheets</button> <button class="btn-quiet sm" type="button" id="un-b2e-ldx">Close</button> <span class="hint" id="un-ld-msg"></span></p></div>` +
        table('t-un-b2e-ld', [
          { k: 'day', l: 'Date', f: r => r.day ? esc(fmtD(r.day)) : '—', csv: r => r.day || '' }, { k: 'name', l: 'Name', f: r => esc(r.name || '—') },
          { k: 'domain', l: 'Email domain', f: r => r.kind === 'personal' ? `<span class="un-n">${esc(r.domain)}</span>` : `<b>${esc(r.domain)}</b>` }, { k: 'kind', l: 'Email type', f: r => esc(KN[r.kind] || r.kind), csv: r => KN[r.kind] || r.kind },
          { k: 'usertype', l: 'User type' }, { k: 'status', l: 'New / existing' },
          { k: 'path', l: 'Page', cls: 'u', f: r => r.path ? esc(r.path) : '<span class="un-n">not recorded</span>', csv: r => r.path }, { k: 'area', l: 'Product / area', f: r => esc(r.place.area), csv: r => r.place.area }, { k: 'source', l: 'Source' }
        ], rows, { file: cfg.file + '-leads', sort: 'day', pageSize: 25, placeholder: 'Filter by name, domain, page or source', searchKeys: ['name', 'domain', 'path', 'source', 'usertype'] }) + '</section>';
    }
    // ── sales-form leads section ──
    const slRange = SST.slRange || 'period', slAll = !!SST.slAll;
    let salesHtml = '';
    const slAuto = SALESAUTO.get(D.site);
    const slCtl = `<div class="un-row" style="flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <label class="field un-f sm"><span>Dates</span><select id="un-sl-range"><option value="period" ${slRange === 'period' ? 'selected' : ''}>Dashboard dates (${esc(fmtD(D.start))} – ${esc(fmtD(D.end))})</option><option value="all" ${slRange === 'all' ? 'selected' : ''}>Everything in the sheet</option></select></label>
        <label class="field un-f sm"><span>Channel</span><select id="un-sl-ch"><option value="org" ${!slAll ? 'selected' : ''}>Organic only</option><option value="all" ${slAll ? 'selected' : ''}>All channels</option></select></label>
        <button class="btn-quiet sm" type="button" id="un-sl-load">${SLd && SLd.source === 'sheet' ? 'Reload the Google Sheet' : 'Load from the Google Sheet'}</button>
        <label class="btn-quiet sm un-file">Upload the sheet (.xlsx / .csv)<input type="file" id="un-sl-file" accept=".xlsx,.xls,.csv" hidden></label>
        <span class="hint" id="un-sl-msg">${slAuto === 'loading' ? 'Loading the leads sheet…' : ''}</span></div>`;
    if (!SLr) salesHtml = slCtl + `<div class="note">${SLd && SLd.error ? `<span class="start-error">${esc(SLd.error)}</span><br>` : ''}Reads the <b>B2B Form Leads</b> sheet (every tab, duplicates dropped) as the lead list: which page the sales form was filled on, and whether the email is an <b>official</b> company address, a <b>campus</b> (college / university) address or a <b>personal</b> one (Gmail etc.). Only rows whose Channel is Organic count unless you pick All channels. unstop.com emails are left out as internal. Names, emails and phone numbers are not shown or kept. Sheet: ${sheetIdOf(salesSheetOf(D)) ? `<a href="https://docs.google.com/spreadsheets/d/${esc(sheetIdOf(salesSheetOf(D)))}/edit" target="_blank" rel="noopener">open</a> · change it in <a href="#funnelsetup">Funnel setup</a>` : 'add the link in <a href="#funnelsetup">Funnel setup</a>'}.</div>`;
    else {
      const L = SLr.leads.filter(l => (slAll || l.organic) && (slRange === 'all' || slIn(l)));
      const t = SL.tally(L);
      const base = { range: slRange, all: slAll };
      const kpS = (l, v, sub) => `<div class="un-kpi"><span>${esc(l)}</span><b>${v}</b><small>${sub || ''}</small></div>`;
      // every page with leads from any source in the date range: organic vs other sources side by side
      const LA = SLr.leads.filter(l => slRange === 'all' || slIn(l));
      const pm = new Map();
      LA.forEach(l => { const k = l.path || ''; if (!pm.has(k)) pm.set(k, { path: k, ...salesPlace(k, so), list: [] }); pm.get(k).list.push(l); });
      const prow = [...pm.values()].map(o => { const shown = o.list.filter(l => slAll || l.organic), org = SL.tally(o.list.filter(l => l.organic)), oth = o.list.filter(l => !l.organic && l.kind !== 'internal'); const sc = new Map(); oth.forEach(l => sc.set(l.source, (sc.get(l.source) || 0) + 1)); const all = SL.tally(o.list); return { ...o, ...SL.tally(shown), list: undefined, org: org.total, orgOff: org.official, other: oth.length, otherOff: oth.filter(l => l.kind === 'official').length, orgShare: all.total ? org.total / all.total * 100 : null, otherSrc: [...sc.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') }; }).filter(r => r.total + r.internal + r.other > 0);
      // sources for the employer pages (B2E + J&I) in the date range
      const srcM = new Map(); LA.filter(l => salesPlace(l.path, so).group !== 'Other form pages').forEach(l => { if (!srcM.has(l.source)) srcM.set(l.source, []); srcM.get(l.source).push(l); });
      const srcRows = [...srcM.entries()].map(([k, list]) => ({ k, ...SL.tally(list) })).sort((a, b) => b.total - a.total);
      const srcTot = srcRows.reduce((a, r) => a + r.total, 0);
      const gm = ['B2E', 'B2E (J&I)', 'Other form pages'].map(g => ({ g, ...SL.tally(L.filter(l => salesPlace(l.path, so).group === g)) }));
      const mm = new Map(); SLr.leads.filter(l => (slAll || l.organic) && l.month).forEach(l => { if (!mm.has(l.month)) mm.set(l.month, { emp: [], all: [] }); const o = mm.get(l.month); o.all.push(l); if (salesPlace(l.path, so).group !== 'Other form pages') o.emp.push(l); });
      const months = [...mm.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 18).map(([m, o]) => ({ m, e: SL.tally(o.emp), a: SL.tally(o.all) }));
      const nonOrg = SLr.leads.filter(l => !l.organic).length;
      delete TABLES['t-un-b2e-sl'];
      salesHtml = slCtl + `<p class="hint">${esc(SLd.name)} · ${SLd.source === 'sheet' ? 'Google Sheet' : SLd.source === 'sample' ? 'sample leads' : 'uploaded file'} · loaded ${when(SLd.at)} · ${SLr.sheets.map(x => `${esc(x.name)}: ${fmtN(x.used)} leads${x.dup ? ` (${fmtN(x.dup)} duplicates dropped)` : ''}${x.skipped ? ` (skipped: ${esc(x.skipped)})` : ''}`).join(' · ')} · ${esc(fmtD(SLr.min))} – ${esc(fmtD(SLr.max))}${!slAll && nonOrg ? ` · ${fmtN(nonOrg)} non-organic leads (ads, banners…) left out` : ''}</p>
        <div class="un-kpis">${kpS(slAll ? 'Leads (all channels)' : 'Organic leads', ldLink(t.total, { ...base, kind: 'any', label: 'All leads' }), slRange === 'all' ? 'everything in the sheet' : 'dashboard dates')}${kpS('Official email', ldLink(t.official, { ...base, kind: 'official', label: 'Official email' }), pct1(t.officialShare) + ' of leads')}${kpS('Campus email', ldLink(t.campus, { ...base, kind: 'campus', label: 'Campus email' }), pct1(t.total ? t.campus / t.total * 100 : null))}${kpS('Personal email', ldLink(t.personal, { ...base, kind: 'personal', label: 'Personal email' }), pct1(t.total ? t.personal / t.total * 100 : null))}</div>
        ${leadPanel()}
        <div class="tw"><table class="un-mini"><thead><tr><th>Where the form was filled</th><th class="r">Leads</th><th class="r">Official</th><th class="r">Campus</th><th class="r">Personal</th><th class="r">Official share</th><th class="r">New users</th><th class="r">Internal (excluded)</th></tr></thead><tbody>${gm.map(r => `<tr><td><b>${esc(r.g)}</b></td><td class="r">${ldLink(r.total, { ...base, kind: 'any', group: r.g, label: r.g })}</td><td class="r">${ldLink(r.official, { ...base, kind: 'official', group: r.g, label: r.g + ' · official' })}</td><td class="r">${ldLink(r.campus, { ...base, kind: 'campus', group: r.g, label: r.g + ' · campus' })}</td><td class="r">${ldLink(r.personal, { ...base, kind: 'personal', group: r.g, label: r.g + ' · personal' })}</td><td class="r">${pct1(r.officialShare)}</td><td class="r">${fmtN(r.newU)}</td><td class="r">${fmtN(r.internal)}</td></tr>`).join('')}</tbody></table></div>
        <h3 class="un-sub">B2E + J&I pages by source</h3><p class="hint">Organic next to every other source of sales-form leads on the employer pages (${slRange === 'all' ? 'everything in the sheet' : 'dashboard dates'}).</p><div class="tw"><table class="un-mini"><thead><tr><th>Source</th><th class="r">Leads</th><th class="r">Share</th><th class="r">Official</th><th class="r">Campus</th><th class="r">Personal</th><th class="r">Official share</th></tr></thead><tbody>${srcRows.map(r => { const sb = { range: slRange, all: true, source: r.k, empOnly: true }; return `<tr${r.k === 'Organic search' ? ' class="un-hl"' : ''}><td><b>${esc(r.k)}</b></td><td class="r">${ldLink(r.total, { ...sb, kind: 'any', label: 'B2E + J&I · ' + r.k })}</td><td class="r">${pct1(srcTot ? r.total / srcTot * 100 : null)}</td><td class="r">${ldLink(r.official, { ...sb, kind: 'official', label: 'B2E + J&I · ' + r.k + ' · official' })}</td><td class="r">${ldLink(r.campus, { ...sb, kind: 'campus', label: 'B2E + J&I · ' + r.k + ' · campus' })}</td><td class="r">${ldLink(r.personal, { ...sb, kind: 'personal', label: 'B2E + J&I · ' + r.k + ' · personal' })}</td><td class="r">${pct1(r.officialShare)}</td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">No leads on employer pages in these dates.</td></tr>'}</tbody></table></div>
        <h3 class="un-sub">By landing page</h3><p class="hint">Leads, official, campus and personal are ${slAll ? 'all channels' : 'organic'}; "Other sources" shows what non-organic channels brought to the same page.</p>` +
        table('t-un-b2e-sl', [
          { k: 'path', l: 'Page the form was filled on', cls: 'u', f: r => !r.path ? '<span class="un-n">not recorded</span>' : r.group !== 'Other form pages' ? `<a href="${esc(focusHref({ u: r.path }))}">${esc(r.path)}</a>` : esc(r.path), csv: r => r.path },
          { k: 'group', l: 'Group' }, { k: 'area', l: 'Product / area' },
          { k: 'total', l: 'Leads', r: 1, f: r => ldLink(r.total, { ...base, kind: 'any', path: r.path, label: r.path || 'page not recorded' }), csv: r => r.total }, { k: 'official', l: 'Official', r: 1, f: r => ldLink(r.official, { ...base, kind: 'official', path: r.path, label: (r.path || 'page not recorded') + ' · official' }), csv: r => r.official }, { k: 'campus', l: 'Campus', r: 1, f: r => ldLink(r.campus, { ...base, kind: 'campus', path: r.path, label: (r.path || 'page not recorded') + ' · campus' }), csv: r => r.campus }, { k: 'personal', l: 'Personal', r: 1, f: r => ldLink(r.personal, { ...base, kind: 'personal', path: r.path, label: (r.path || 'page not recorded') + ' · personal' }), csv: r => r.personal },
          { k: 'officialShare', l: 'Official share', r: 1, f: r => pct1(r.officialShare), csv: r => r.officialShare == null ? '' : r.officialShare.toFixed(1) }, { k: 'newU', l: 'New users', r: 1, f: r => fmtN(r.newU) },
          { k: 'other', l: 'Other sources', r: 1, f: r => r.other ? `${ldLink(r.other, { range: slRange, nonOrg: true, kind: 'any', path: r.path, label: (r.path || 'page not recorded') + ' · other sources' })}<br><small class="un-n">${esc(r.otherSrc)}</small>` : '0', csv: r => r.other }, { k: 'otherOff', l: 'Other: official', r: 1, f: r => fmtN(r.otherOff) }, { k: 'orgShare', l: 'Organic share of all leads', r: 1, f: r => pct1(r.orgShare), csv: r => r.orgShare == null ? '' : r.orgShare.toFixed(1) }, { k: 'internal', l: 'Internal', r: 1, f: r => fmtN(r.internal) }
        ], prow, { file: cfg.file + '-sales-form-leads', sort: 'total', pageSize: 30, placeholder: 'Filter pages or products', searchKeys: ['path', 'area', 'group'], filters: [{ key: 'group', label: 'Group', options: [['B2E', 'B2E'], ['B2E (J&I)', 'B2E (J&I)'], ['Other form pages', 'Other form pages']], test: (r, v) => r.group === v }] }) +
        `<h3 class="un-sub">By month (${slAll ? 'all channels' : 'organic'})</h3><div class="tw"><table class="un-mini"><thead><tr><th>Month</th><th class="r">B2E + J&I leads</th><th class="r">Official</th><th class="r">Campus</th><th class="r">Personal</th><th class="r">Official share</th><th class="r">All form pages</th><th class="r">All: official</th></tr></thead><tbody>${months.map(r => { const mb = { range: 'all', all: slAll, month: r.m, empOnly: true }; return `<tr><td>${esc(r.m)}</td><td class="r">${ldLink(r.e.total, { ...mb, kind: 'any', label: r.m + ' · B2E + J&I' })}</td><td class="r">${ldLink(r.e.official, { ...mb, kind: 'official', label: r.m + ' · B2E + J&I · official' })}</td><td class="r">${ldLink(r.e.campus, { ...mb, kind: 'campus', label: r.m + ' · B2E + J&I · campus' })}</td><td class="r">${ldLink(r.e.personal, { ...mb, kind: 'personal', label: r.m + ' · B2E + J&I · personal' })}</td><td class="r">${pct1(r.e.officialShare)}</td><td class="r">${fmtN(r.a.total)}</td><td class="r">${fmtN(r.a.official)}</td></tr>`; }).join('')}</tbody></table></div>
        <p class="hint">Official = company email domain. Campus = college or university domain (.ac.in, .edu, or a domain mostly used by students). Personal = Gmail, Yahoo, Outlook and other free mail. One class per domain.</p>`;
    }
    // ── AI assistants: visits by month (GA4, any channel), click a number for the landing pages ──
    const aiScope = ST.aiScope || 'both', aiSel = B2E_AI.get(SK);
    const AIR = M && M.aiMonthly ? M.aiMonthly.filter(r => aiScope === 'site' ? true : aiScope === 'both' ? ids.includes(so(r.path)) : so(r.path) === aiScope) : null;
    if (cols[1].dummy && aiScope === 'both') ST.aiScope = ids[0];
    let aiHtml = '', aiTsv = '', aiDrillTsv = '';
    const AIL = [];
    const aiLink = (n, spec) => n ? `<a href="#" data-ai="${AIL.push(spec) - 1}" title="Show the landing pages">${fmtN(Math.round(n))}</a>` : '0';
    if (!M) aiHtml = '<p class="un-n">Needs GA4 (loads with the same sign-in).</p>';
    else if (!M.aiMonthly || !M.aiMonthly.length) aiHtml = `<p class="un-n">${(g && g.raw && !g.raw.aiMonthly) ? 'Press Reload GA4 on the GA4 organic screen once to fetch the monthly AI report.' : 'No AI assistant referrals in the last 16 months.'}</p>`;
    else {
      const srcT = new Map(); AIR.forEach(r => srcT.set(r.source, (srcT.get(r.source) || 0) + r.sessions));
      const srcs = [...srcT.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
      const mm = new Map(); AIR.forEach(r => { const o = mm.get(r.month) || { m: r.month, tot: 0, ke: 0, nu: 0, by: {} }; o.tot += r.sessions; o.ke += r.keyEvents; o.nu += r.newUsers; o.by[r.source] = (o.by[r.source] || 0) + r.sessions; mm.set(r.month, o); });
      const months = [...mm.values()].sort((a, b) => b.m.localeCompare(a.m));
      const scName = aiScope === 'site' ? 'Whole site' : aiScope === 'both' ? bothName : clusterName(aiScope);
      aiTsv = [['Month', 'All AI sessions', ...srcs, 'New users', 'Key events'].join('\t'), ...months.map(o => [o.m, Math.round(o.tot), ...srcs.map(x => Math.round(o.by[x] || 0)), Math.round(o.nu), Math.round(o.ke)].join('\t'))].join('\n');
      const last = months[0], prev = months[1];
      aiHtml = `<div class="un-row" style="flex-wrap:wrap;gap:8px;margin-bottom:10px"><label class="field un-f sm"><span>Pages</span><select id="un-ai-scope">${[['both', bothName], [ids[0], cols[0].name], [ids[1], cols[1].name], ['site', 'Whole site']].filter(([v]) => !(cols[1].dummy && (v === ids[1] || v === 'both'))).map(([v, l]) => `<option value="${v}" ${aiScope === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label><button class="btn-primary sm" type="button" id="un-ai-copy">Copy for Google Sheets</button><span class="hint" id="un-ai-msg">${esc(scName)} · ${last ? `${esc(last.m)}: ${fmtN(Math.round(last.tot))} AI sessions${prev ? ' ' + dchip(U.chg(last.tot, prev.tot)) + ' vs ' + esc(prev.m) : ''}` : ''}</span></div>
        <div class="chart-box"><canvas id="un-ai-ch" aria-label="AI assistant sessions by month"></canvas></div>
        <div class="tw"><table class="un-mini"><thead><tr><th>Month</th><th class="r">All AI</th>${srcs.map(x => `<th class="r"><a href="#" data-ai="${AIL.push({ source: x }) - 1}">${esc(x)}</a></th>`).join('')}<th class="r">New users</th><th class="r">Key events</th></tr></thead><tbody>${months.map(o => `<tr><td>${esc(o.m)}${o.m === (D.end || '').slice(0, 7) ? ' <span class="tag">partial</span>' : ''}</td><td class="r"><b>${aiLink(o.tot, { month: o.m })}</b></td>${srcs.map(x => `<td class="r">${aiLink(o.by[x], { month: o.m, source: x })}</td>`).join('')}<td class="r">${fmtN(Math.round(o.nu))}</td><td class="r">${fmtN(Math.round(o.ke))}</td></tr>`).join('')}</tbody></table></div>
        <p class="hint">GA4 sessions referred by AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Claude…), any channel, landing on ${esc(scName.toLowerCase())}. Click a number for its landing pages; click an assistant name for all its months.</p>`;
      // drill-down: landing pages for the clicked month / assistant
      if (aiSel) {
        const rows0 = AIR.filter(r => (!aiSel.month || r.month === aiSel.month) && (!aiSel.source || r.source === aiSel.source));
        const pm2 = new Map(); rows0.forEach(r => { const k = r.path; const o = pm2.get(k) || { path: k, cluster: ids.includes(so(k)) ? clusterName(so(k)) : so.label(so(k)), product: ids.includes(so(k)) ? b2eProduct(k) : '', sessions: 0, newUsers: 0, engaged: 0, keyEvents: 0, by: {} }; o.sessions += r.sessions; o.newUsers += r.newUsers; o.engaged += r.engaged; o.keyEvents += r.keyEvents; o.by[r.source] = (o.by[r.source] || 0) + r.sessions; pm2.set(k, o); });
        const drows = [...pm2.values()].map(o => ({ ...o, engRate: o.sessions ? o.engaged / o.sessions * 100 : null, srcTxt: Object.entries(o.by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ') })).sort((a, b) => b.sessions - a.sessions);
        const ttl = `${aiSel.source || 'All AI assistants'} · ${aiSel.month || 'last 16 months'} · ${scName} (${fmtN(drows.length)} pages)`;
        aiDrillTsv = [['Landing page', 'Cluster', 'Product', 'AI sessions', 'New users', 'Engagement rate %', 'Key events', 'By assistant'].join('\t'), ...drows.map(r => [r.path, r.cluster, r.product, Math.round(r.sessions), Math.round(r.newUsers), r.engRate == null ? '' : r.engRate.toFixed(1), Math.round(r.keyEvents), r.srcTxt].join('\t'))].join('\n');
        delete TABLES['t-un-b2e-ai'];
        aiHtml += `<section class="panel un-ldp" id="un-b2e-aip"><div class="panel-h"><h2>${esc(ttl)}</h2><p><button class="btn-primary sm" type="button" id="un-ai-dcopy">Copy for Google Sheets</button> <button class="btn-quiet sm" type="button" id="un-ai-x">Close</button> <span class="hint" id="un-ai-dmsg"></span></p></div>` +
          table('t-un-b2e-ai', [{ k: 'path', l: 'Landing page', cls: 'u', f: r => ids.includes(so(r.path)) ? `<a href="${esc(focusHref({ u: r.path }))}">${esc(r.path)}</a>` : esc(r.path), csv: r => r.path }, { k: 'cluster', l: 'Cluster' }, { k: 'product', l: 'Product' }, { k: 'sessions', l: 'AI sessions', r: 1, f: r => fmtN(Math.round(r.sessions)) }, { k: 'newUsers', l: 'New users', r: 1, f: r => fmtN(Math.round(r.newUsers)) }, { k: 'engRate', l: 'Engagement rate', r: 1, f: r => pct1(r.engRate) }, { k: 'keyEvents', l: 'Key events', r: 1, f: r => fmtN(Math.round(r.keyEvents)) }, { k: 'srcTxt', l: 'By assistant', f: r => `<small>${esc(r.srcTxt)}</small>` }],
            drows, { file: cfg.file + '-ai-landing-pages', sort: 'sessions', pageSize: 25, placeholder: 'Filter pages', searchKeys: ['path', 'cluster', 'product'] }) + '</section>';
      }
      var aiChart = { months: months.slice().reverse(), srcs };
    }
    const navLinks0 = [['un-b2e-sum', 'Summary'], ['un-b2e-alerts', 'Drop alerts'], ['un-b2e-sales', 'Sales-form leads'], ['un-b2e-ai', 'AI traffic'], ['un-b2e-trend', 'Weekly trend'], ['un-b2e-prod', 'Products'], ['un-b2e-topics', 'Search topics'], ['un-b2e-qw', 'Quick wins'], ['un-b2e-pages', 'All landing pages'], ['un-b2e-rev', 'First review']];
    const navLinks = navLinks0.filter(([id]) => !(cfg.sales === false && id === 'un-b2e-sales')).map(([id, l]) => [id, id === 'un-b2e-prod' && cfg.productLabel ? cfg.productLabel : l]);
    const navHtml = `<nav class="un-b2e-nav">${navLinks.map(([id, l]) => `<a href="#" data-jump="${id}">${esc(l)}</a>`).join('')}</nav>`;
    const sec = (id, title, sub, body) => `<section class="panel" id="${id}"><div class="panel-h"><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div class="panel-b">${body}</div></section>`;
    const html = intro +
      `<p class="un-meta">${esc(period)}</p>` + (notes.length ? `<div class="note">${notes.join('<br>')}</div>` : '') + alertTop + navHtml +
      `<div class="un-row" style="margin:6px 0 12px;flex-wrap:wrap;gap:8px"><div class="un-tabs" role="tablist" aria-label="Columns" ${cols[1].dummy ? 'hidden' : ''}>${[['all', 'All three'], ['0', heads[0] + ' only'], ['1', heads[1] + ' only'], ['2', 'Combined only']].map(([v, l]) => `<button type="button" class="${VIEW === v ? 'on' : ''}" data-b2v="${v}">${esc(l)}</button>`).join('')}</div><button class="btn-primary sm" type="button" id="un-b2e-copy">Copy for Google Sheets</button><button class="btn-quiet sm" type="button" id="un-b2e-csv">Download CSV</button>${live ? '<button class="btn-quiet sm" type="button" id="un-b2e-reload">Reload Search Console</button>' : ''}<span class="hint" id="un-b2e-msg">Copies the columns shown: ${esc(shown.map(i => heads[i]).join(', '))}. Paste into the sheet with Ctrl/Cmd + V.</span></div>` +
      `<section class="panel" id="un-b2e-sum"><div class="panel-b flush"><div class="tw"><table class="un-mini un-b2e"><thead><tr><th>KPI</th>${shown.map(i => `<th class="r">${esc(heads[i])}</th><th class="r un-b2e-d">Change</th>`).join('')}<th>Data</th><th>Owner <a class="un-n" href="#funnelsetup" title="Change owners in Funnel setup">edit</a></th></tr></thead><tbody>${trs}</tbody></table></div></div></section>` +
      kwPanel() +
      sec('un-b2e-alerts', 'Drop alerts', 'Employer pages and non-brand keywords that lost clicks or ranking this week, with the likely reason.', alertHtml || '<p class="un-n">—</p>') +
      (cfg.sales === false ? '' : sec('un-b2e-sales', 'Sales-form leads (B2B Form Leads sheet)', 'Every sales-form submission by the page it was filled on, split into official, campus and personal email. Organic only by default. This is the lead list (CRM) for B2E.', salesHtml)) +
      sec('un-b2e-ai', 'AI assistant traffic by month', 'How many visits ChatGPT, Perplexity, Gemini and other assistants send each month, and to which pages.', aiHtml) +
      sec('un-b2e-trend', cols[1].dummy ? `Weekly trend: ${cols[0].name}` : `Weekly trend: ${cols[0].name} vs ${cols[1].name}`, 'Non-brand and brand Search Console clicks, impressions and position per week.', trendHtml) +
      sec('un-b2e-prod', cfg.productLabel || 'Products', (cfg.productIntro || 'Every employer product (the folder after /employers).') + ' Click one to list all its landing pages below.' + (QPe.length ? '' : ' Brand / non-brand and keyword counts need query × page rows.'), prodHtml) +
      sec('un-b2e-topics', 'Search topics: brand vs non-brand', 'Searches that bring people to the employer pages, grouped by topic. Click a keyword count to see the keywords.', topicHtml) +
      sec('un-b2e-qw', 'Quick wins: non-brand keywords in positions 11–20', 'Each with the page that ranks and the next step. Add a task to put it on the Action board with an owner and due date.', qwHtml) +
      sec('un-b2e-pages', cfg.pagesTitle || 'All employer landing pages', `${fmtN(pagesAll.length)} pages with Search Console data${M ? ', with GA4 sessions, leads and employer signups' : ''}. Click a page to analyse it on its own.`, pagesHtml) +
      `<div id="un-b2e-rev">${reviewPanel()}</div>`;
    const mount = () => {
      if (live) cols.forEach((c, i) => { if (!F[i]) { const sc = scOf(c.id); loadScope(D, A, sc, keyOf(sc), ov); } });
      const msg = t => { const el = document.getElementById('un-b2e-msg'); if (el) el.textContent = t; };
      const cp = document.getElementById('un-b2e-copy');
      if (cp) cp.addEventListener('click', async () => {
        const text = tsv();
        try { await navigator.clipboard.writeText(text); msg('Copied. Paste into the sheet with Ctrl/Cmd + V.'); }
        catch (e) { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (x) { } ta.remove(); msg(ok ? 'Copied. Paste into the sheet with Ctrl/Cmd + V.' : 'Copy was blocked by the browser: use Download CSV instead.'); }
      });
      const dl = document.getElementById('un-b2e-csv');
      if (dl) dl.addEventListener('click', () => { const csv = tsv().split('\n').map(l => l.split('\t').map(v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v).join(',')).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `${cfg.file}-dashboard-${VIEW === 'all' ? 'all' : VIEW === '0' ? 'b2e' : VIEW === '1' ? 'b2e-ji' : 'combined'}-${D.start}-${D.end}.csv`; document.body.appendChild(a); a.click(); a.remove(); });
      document.querySelectorAll('[data-b2v]').forEach(b => b.addEventListener('click', () => { b2eState(SK).view = b.dataset.b2v; rerender(); }));
      const tb = document.querySelector('.un-b2e');
      if (tb) tb.addEventListener('click', e => { const el = e.target.closest('[data-kw]'); if (!el) return; e.preventDefault(); const [seg, k, i] = el.dataset.kw.split('|'); B2E_KW.set(SK, { seg, k, i: +i }); rerender(); setTimeout(() => { const p = document.getElementById('un-b2e-kwp'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60); });
      if (document.getElementById('t-un-b2e-kw')) drawTable('t-un-b2e-kw');
      const kx = document.getElementById('un-b2e-kwx'); if (kx) kx.addEventListener('click', () => { B2E_KW.delete(SK); rerender(); });
      const rl = document.getElementById('un-b2e-reload');
      if (rl) rl.addEventListener('click', () => { cols.forEach(c => FOC.delete(keyOf(scOf(c.id)))); B2EX.delete(XK); rerender(); });
      if (live && !B2EX.get(XK)) loadB2EX(D, A, realIds, ov, XK);
      if (document.getElementById('t-un-b2e-sl')) drawTable('t-un-b2e-sl');
      if (document.getElementById('t-un-b2e-ld')) drawTable('t-un-b2e-ld');
      ['un-b2e-sum', 'un-b2e-sales'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('click', e => { const a = e.target.closest('[data-ld]'); if (!a) return; e.preventDefault(); const sp = LDS[+a.dataset.ld]; if (!sp) return; B2E_LD.set(SK, sp); rerender(); setTimeout(() => jump('un-b2e-ldp'), 60); }); });
      // AI traffic: scope, drill-down, copy, chart
      const copyTsv = async (text, msgId) => { const msg = t => { const el = document.getElementById(msgId); if (el) el.textContent = t; }; try { await navigator.clipboard.writeText(text); msg('Copied. Paste into the sheet with Ctrl/Cmd + V.'); } catch (e) { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (x) { } ta.remove(); msg(ok ? 'Copied. Paste into the sheet with Ctrl/Cmd + V.' : 'Copy was blocked by the browser: use Export CSV.'); } };
      const aisc = document.getElementById('un-ai-scope'); if (aisc) aisc.addEventListener('change', () => { ST.aiScope = aisc.value; rerender(); setTimeout(() => jump('un-b2e-ai'), 60); });
      const aiEl = document.getElementById('un-b2e-ai'); if (aiEl) aiEl.addEventListener('click', e => { const a = e.target.closest('[data-ai]'); if (!a) return; e.preventDefault(); const sp = AIL[+a.dataset.ai]; if (!sp) return; B2E_AI.set(SK, sp); rerender(); setTimeout(() => jump('un-b2e-aip'), 60); });
      const aic = document.getElementById('un-ai-copy'); if (aic) aic.addEventListener('click', () => copyTsv(aiTsv, 'un-ai-msg'));
      const aidc = document.getElementById('un-ai-dcopy'); if (aidc) aidc.addEventListener('click', () => copyTsv(aiDrillTsv, 'un-ai-dmsg'));
      const aix = document.getElementById('un-ai-x'); if (aix) aix.addEventListener('click', () => { B2E_AI.delete(SK); rerender(); setTimeout(() => jump('un-b2e-ai'), 60); });
      if (document.getElementById('t-un-b2e-ai')) drawTable('t-un-b2e-ai');
      if (typeof aiChart !== 'undefined' && aiChart && document.getElementById('un-ai-ch')) { const pal = ['--signal', '--good', '--orange', '--sky', '--teal', '--watch', '--bad']; chart('un-ai-ch', { type: 'line', data: { labels: aiChart.months.map(o => o.m), datasets: aiChart.srcs.slice(0, 7).map((x, i) => ({ label: x, data: aiChart.months.map(o => Math.round(o.by[x] || 0)), borderColor: cssVar(pal[i % pal.length]), backgroundColor: cssVar(pal[i % pal.length]), tension: .25, pointRadius: 2, borderWidth: 2 })) }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { beginAtZero: true } }, plugins: { legend: { position: 'bottom' } } } }); }
      const ldc = document.getElementById('un-ld-copy'); if (ldc) ldc.addEventListener('click', () => copyTsv(ldTsv, 'un-ld-msg'));
      const ldx = document.getElementById('un-b2e-ldx'); if (ldx) ldx.addEventListener('click', () => { B2E_LD.delete(SK); rerender(); setTimeout(() => jump('un-b2e-sales'), 60); });
      const slr = document.getElementById('un-sl-range'); if (slr) slr.addEventListener('change', () => { SST.slRange = slr.value; rerender(); setTimeout(() => jump('un-b2e-sales'), 60); });
      const slc = document.getElementById('un-sl-ch'); if (slc) slc.addEventListener('change', () => { SST.slAll = slc.value === 'all'; rerender(); setTimeout(() => jump('un-b2e-sales'), 60); });
      const sll = document.getElementById('un-sl-load'); if (sll) sll.addEventListener('click', async () => { const m = document.getElementById('un-sl-msg'); if (m) m.textContent = 'Loading the leads sheet…'; sll.disabled = true; try { await loadSalesSheet(D); } catch (e) { SALES.set(D.site, { error: e.message }); } rerender(); setTimeout(() => jump('un-b2e-sales'), 60); });
      const slf = document.getElementById('un-sl-file'); if (slf) slf.addEventListener('change', async () => { const f = slf.files[0]; if (!f) return; try { const sheets = /\.csv$/i.test(f.name) ? [{ name: f.name, rows: await readSheet(f) }] : await readAllSheets(f); const res = SL.salesModel(sheets); SALES.set(D.site, res.ok ? { res, name: f.name, at: Date.now(), source: 'file' } : { error: res.error }); } catch (e) { SALES.set(D.site, { error: e.message }); } rerender(); setTimeout(() => jump('un-b2e-sales'), 60); });
      const jump = id => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      document.querySelectorAll('[data-jump]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); jump(a.dataset.jump); }));
      ['t-un-b2e-prod', 't-un-b2e-top', 't-un-b2e-qw', 't-un-b2e-pages'].forEach(id => { if (document.getElementById(id)) drawTable(id); });
      // product → its landing pages
      ['un-b2e-prod', 'un-b2e-pages'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('click', e => { const a = e.target.closest('[data-prod]'); if (!a) return; e.preventDefault(); ST.product = a.dataset.prod; rerender(); setTimeout(() => jump('un-b2e-pages'), 60); }); });
      const pall = document.getElementById('un-b2e-pall'); if (pall) pall.addEventListener('click', e => { e.preventDefault(); ST.product = ''; rerender(); setTimeout(() => jump('un-b2e-pages'), 60); });
      // topics: cluster picker and keyword lists
      const tc = document.getElementById('un-b2e-tcol'); if (tc) tc.addEventListener('change', () => { ST.topicCol = +tc.value; rerender(); setTimeout(() => jump('un-b2e-topics'), 60); });
      const tEl = document.getElementById('un-b2e-topics'); if (tEl) tEl.addEventListener('click', e => { const a = e.target.closest('[data-tkw]'); if (!a) return; e.preventDefault(); const [topic, seg, k] = a.dataset.tkw.split('|'); B2E_KW.set(SK, { topic, seg, k, i: ST.topicCol }); rerender(); setTimeout(() => jump('un-b2e-kwp'), 60); });
      // quick wins → Action board
      const addTask = r => { const GW = window.CW_GROWTH, TK = window.CW_TASKS; if (!GW || !TK) return false; const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10); return GW.upsert(D.site, TK.manual({ title: `Quick win: "${r.q}" (position ${r.pos.toFixed(1)})`, url: r.url || null, action: r.action, owner: ownerOf({ kpi: 'Keywords in positions 11', src: 'GSC' }), due }, D)); };
      const qmsg = t => { const el = document.getElementById('un-b2e-qwmsg'); if (el) el.textContent = t; };
      const qEl = document.getElementById('un-b2e-qw'); if (qEl) qEl.addEventListener('click', e => { const b = e.target.closest('[data-qw]'); if (!b) return; const r = QW[+b.dataset.qw]; if (!r) return; const ok = addTask(r); b.textContent = ok ? 'Added ✓' : 'Could not add'; b.disabled = true; qmsg(ok ? `Added "${r.q}" to the Action board.` : 'The Action board could not be saved in this browser.'); });
      const q10 = document.getElementById('un-b2e-qw10'); if (q10) q10.addEventListener('click', () => { let n = 0; QW.slice(0, 10).forEach(r => { if (addTask(r)) n++; }); q10.disabled = true; qmsg(`Added ${n} quick wins to the Action board (due in 14 days).`); });
      // weekly chart
      if (xReady && document.getElementById('un-b2e-ch')) {
        const wk = [...new Set(realIds.flatMap(id => (X.weekly[id] ? X.weekly[id].nb : []).map(r => r.w)))].sort().filter(w => !ids.some(id => { const s = X.weekly[id]; const r = s && s.nb.find(x => x.w === w); return r && r.partial; }));
        const colors = ['--signal', '--orange'];
        let ch = null;
        const draw = () => { if (ch) { try { ch.destroy(); } catch (x) { } } const m = ST.trend; ch = chart('un-b2e-ch', { type: 'line', data: { labels: wk.map(w => fmtD(w)), datasets: realIds.map((id, i) => { const s = X.weekly[id] || { nb: [], b: [] }; const src = m === 'b' ? s.b : s.nb; return { label: cols[i].name, data: wk.map(w => { const r = src.find(x => x.w === w); return !r ? null : m === 'nbi' ? r.impr : m === 'pos' ? +r.pos.toFixed(2) : r.clicks; }), borderColor: cssVar(colors[i]), backgroundColor: cssVar(colors[i]), tension: .25, pointRadius: 2, borderWidth: 2 }; }) }, options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { reverse: m === 'pos', beginAtZero: m !== 'pos' } }, plugins: { legend: { position: 'bottom' } } } }); };
        draw();
        document.querySelectorAll('[data-b2t]').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('[data-b2t]').forEach(x => x.classList.toggle('on', x === b)); ST.trend = b.dataset.b2t; draw(); }));
      }
    };
    return { html, mount };
  };

  V.b2e = (A, D) => board(A, D, { key: 'b2e', file: 'unstop-b2e' });

  // ════════════════════════════ FOLDER DASHBOARD (common) ════════════════════════════
  // The B2E board for any folder: type a folder (and optionally a second one to compare) and every
  // section follows it. No B2B sales-form leads or CRM rows here.
  const BOARD_SO = new Map();
  const normFolder = v => { let x = String(v || '').trim(); if (!x) return ''; try { if (/^https?:\/\//i.test(x)) x = new URL(x).pathname; } catch (e) { } x = x.split(/[?#]/)[0].trim(); if (!x.startsWith('/')) x = '/' + x; if (x.length > 1 && !x.endsWith('*')) x = x.replace(/\/+$/, ''); return x.toLowerCase(); };
  V.board = (A, D) => {
    const P = fParams(), a = normFolder(P.get('a')), b = normFolder(P.get('b'));
    const s = settings(D.site), so0 = sectioner(D);
    // folders people can pick: first-level and second-level folders with Search Console clicks
    const fm = new Map(); (A.P || []).forEach(r => { const segs = U.pathOnly(r.p).toLowerCase().split('/').filter(Boolean); for (let n = 1; n <= Math.min(2, segs.length - (segs.length > 1 ? 1 : 0)); n++) { const f = '/' + segs.slice(0, n).join('/'); fm.set(f, (fm.get(f) || 0) + (+r.clicks || 0)); } });
    const folders = [...fm.entries()].sort((x, y) => y[1] - x[1]).slice(0, 300);
    const picker = `<form class="un-scope" id="un-bd-form"><span class="un-scope-t">Folders</span>
      <label class="field un-grow"><span>Folder</span><input type="text" id="un-bd-a" list="un-bd-list" value="${esc(a)}" placeholder="/internship, /hackathons, /blog, /employers/ai-assessment-agent…" spellcheck="false" autocomplete="off" required></label>
      <label class="field un-grow"><span>Compare with (optional)</span><input type="text" id="un-bd-b" list="un-bd-list" value="${esc(b)}" placeholder="/jobs" spellcheck="false" autocomplete="off"></label>
      <datalist id="un-bd-list">${folders.map(([f, c]) => `<option value="${esc(f)}">${fmtN(c)} clicks</option>`).join('')}</datalist>
      <button class="btn-primary sm" type="submit">Show</button></form>`;
    const pickerMount = () => { const f = document.getElementById('un-bd-form'); if (!f) return; f.addEventListener('submit', e => { e.preventDefault(); const na = normFolder(document.getElementById('un-bd-a').value), nb = normFolder(document.getElementById('un-bd-b').value); if (!na) return; location.hash = '#board?' + new URLSearchParams(Object.entries({ a: na, b: nb }).filter(([, v]) => v)).toString(); }); };
    const intro = 'Any folder on one page: Search Console visibility (brand vs non-brand, keyword buckets, search topics, quick wins, drops, weekly trend), GA4 traffic, signups and engagement, and AI assistant traffic. Type a folder, and a second one to compare. B2B sales-form leads are on the B2E dashboard only.';
    const base = { key: 'common', title: 'Folder dashboard', intro, picker, file: 'unstop-folder', employer: false, sales: false };
    if (!a) return board(A, D, { ...base, empty: `<div class="note">Type a folder to start, for example ${folders.slice(0, 6).map(([f]) => `<a href="#board?a=${encodeURIComponent(f)}">${esc(f)}</a>`).join(', ')}. It covers the folder and everything under it; end with * for a prefix (e.g. <code>/employers/hire-*</code>).</div>`, pickerMount });
    const secA = { id: 'fa', name: a, type: 'other', rules: [a] }, secB = b ? { id: 'fb', name: b, type: 'other', rules: [b] } : null;
    const bare = r => r.replace(/\*$/, '').replace(/\/$/, '');
    // the narrower folder goes first so its pages are not counted in the wider one
    const own = secB && bare(b).startsWith(bare(a) + (a.endsWith('*') ? '' : '/')) ? [secB, secA] : secB ? [secA, secB] : [secA];
    const list = own.concat(s.sections || U.DEFAULT_SECTIONS);
    const sk = D.site + '|' + JSON.stringify([list, s.rootArticles]);
    let so = BOARD_SO.get(sk); if (!so) { so = U.makeSectioner(list, { rootArticles: s.rootArticles }); if (BOARD_SO.size > 20) BOARD_SO.clear(); BOARD_SO.set(sk, so); }
    const cols = [{ id: 'fa', name: a }, b ? { id: 'fb', name: b } : { id: 'fb', name: '—', dummy: true }];
    // sub-folder one level below the chosen folder (pages straight in the folder are grouped as the folder page)
    const productOf = url => { const path = U.pathOnly(url).toLowerCase(); const id = so(path); const rule = id === 'fb' ? b : a; const r = bare(rule); if (rule.endsWith('*')) { const seg = path.slice(r.length).split('/')[0]; return r + (seg || '') ; } const rest = path.slice(r.length).split('/').filter(Boolean); return rest.length ? r + '/' + rest[0] : r + ' (folder page)'; };
    const { clusterOf } = tools(D);
    const out = board(A, D, { ...base, key: 'common|' + a + '|' + b, so, sections: list, cols, bothName: b ? `${a} + ${b}` : a, bothHead: 'Combined', productOf, productLabel: 'Sub-folders', productIntro: 'Every sub-folder one level below the folder.', topicOf: q => clusterOf(q), pagesTitle: 'All landing pages in these folders' });
    const m = out.mount; return { ...out, mount: () => { pickerMount(); if (m) m(); } };
  };

  // every funnel screen tries the one-sign-in GA4 load after it renders
  ['b2e', 'board', 'funnel', 'ga4', 'acquisition', 'engagement', 'leads', 'focus', 'scorecards', 'reviews', 'urlclusters', 'visibility', 'quality'].forEach(k => {
    const f = V[k]; if (!f) return;
    V[k] = (A, D) => { const r = f(A, D); if (!r || typeof r !== 'object') return r; const m = r.mount; return { ...r, mount: () => { if (m) m(); gaAuto(D); if (k === 'b2e' || k === 'leads') salesAuto(D); } }; };
  });
  window.UN_VIEW = { GA, MOE, settings, sampleGa, sampleMoe };
})();
