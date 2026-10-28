// Workstream scorecards: technical SEO, content & programmatic pages, link building, content refreshes and
// visibility in AI answers. Pure functions (no DOM, no network) so they can be tested in Node; the screens
// and the PageSpeed / URL Inspection calls live in scorecards-view.js.
(function (root) {
  'use strict';
  const U = root.UN || (typeof require !== 'undefined' ? require('./unstop.js') : null);
  const pathOnly = U.pathOnly;
  const chg = (c, p) => (p == null || !isFinite(p) || p === 0 || c == null) ? null : (c - p) / p * 100;
  const num = v => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/[,%\s]/g, '')); return isFinite(n) ? n : null; };
  const yes = v => /^(yes|y|true|1|cited|mentioned|✓|x)$/i.test(String(v == null ? '' : v).trim());
  function toDate(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5));
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    const d = new Date(s); return isNaN(d) ? null : d;
  }
  const iso = d => d ? d.toISOString().slice(0, 10) : null;
  // header lookup: exact name first, then "contains"
  function headerMap(header, fields) {
    const h = header.map(x => String(x || '').trim().toLowerCase().replace(/\s+/g, ' '));
    const map = {}, used = new Set();
    Object.entries(fields).forEach(([k, names]) => {
      let i = h.findIndex((x, j) => !used.has(j) && names.includes(x));
      if (i < 0) i = h.findIndex((x, j) => !used.has(j) && names.some(n => n.length > 3 && x.includes(n)));
      if (i >= 0) { map[k] = i; used.add(i); }
    });
    return map;
  }

  // ── Technical: PageSpeed Insights (field data from CrUX when Google has it, lab data otherwise) ──
  const CWV = { lcp: 2500, inp: 200, cls: 0.1 };
  function psiUrl(url, key, strategy = 'mobile') {
    return 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=' + encodeURIComponent(url) + '&strategy=' + strategy + '&category=performance' + (key ? '&key=' + encodeURIComponent(key) : '');
  }
  function psiParse(url, j) {
    const le = (j && j.loadingExperience) || {}, m = le.metrics || {}, ole = (j && j.originLoadingExperience) || {};
    const p75 = k => m[k] ? m[k].percentile : null;
    const lr = (j && j.lighthouseResult) || {}, au = lr.audits || {};
    const field = { lcp: p75('LARGEST_CONTENTFUL_PAINT_MS'), inp: p75('INTERACTION_TO_NEXT_PAINT'), cls: m.CUMULATIVE_LAYOUT_SHIFT_SCORE ? m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null };
    const hasField = field.lcp != null && field.cls != null;
    const lab = { lcp: au['largest-contentful-paint'] ? au['largest-contentful-paint'].numericValue : null, cls: au['cumulative-layout-shift'] ? au['cumulative-layout-shift'].numericValue : null, tbt: au['total-blocking-time'] ? au['total-blocking-time'].numericValue : null };
    const pass = hasField ? field.lcp <= CWV.lcp && field.cls <= CWV.cls && (field.inp == null || field.inp <= CWV.inp) : null;
    return { url, perf: lr.categories && lr.categories.performance ? Math.round(lr.categories.performance.score * 100) : null, field, lab, hasField, pass, fieldCat: le.overall_category || null, originCat: ole.overall_category || null, originPass: ole.metrics ? (ole.metrics.LARGEST_CONTENTFUL_PAINT_MS || {}).percentile <= CWV.lcp && ((ole.metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE || {}).percentile / 100) <= CWV.cls && (!ole.metrics.INTERACTION_TO_NEXT_PAINT || ole.metrics.INTERACTION_TO_NEXT_PAINT.percentile <= CWV.inp) : null };
  }
  function cwvSummary(list) {
    const ok = (list || []).filter(r => r && !r.error);
    const withField = ok.filter(r => r.hasField);
    const perf = ok.map(r => r.perf).filter(v => v != null).sort((a, b) => a - b);
    const med = a => a.length ? a[Math.floor((a.length - 1) / 2)] : null;
    return { tested: ok.length, failed: (list || []).length - ok.length, withField: withField.length, passRate: withField.length ? withField.filter(r => r.pass).length / withField.length * 100 : null, medianPerf: med(perf), medianLcp: med(ok.map(r => r.hasField ? r.field.lcp : r.lab.lcp).filter(v => v != null).sort((a, b) => a - b)) };
  }

  // ── Technical: crawler export (Screaming Frog, Sitebulb, JetOctopus…) ──
  const CRAWL_FIELDS = { url: ['address', 'url', 'page url', 'uri'], status: ['status code', 'http status code', 'status', 'response code'], indexability: ['indexability', 'indexable'], why: ['indexability status', 'reason', 'non-indexable reason'], time: ['response time', 'response time (s)', 'time to first byte', 'ttfb'], type: ['content type', 'content-type'] };
  function crawlModel(rows, sectionOf) {
    if (!rows || rows.length < 2) return { ok: false, error: 'The file has no rows.' };
    const map = headerMap(rows[0], CRAWL_FIELDS);
    if (map.url == null || map.status == null) return { ok: false, error: 'Expected an “Address” (URL) and a “Status Code” column, as in a Screaming Frog Internal export.', header: rows[0] };
    const by = new Map(), errors = [];
    const z = id => ({ id, cluster: sectionOf ? sectionOf.label(id) : id, urls: 0, ok: 0, redirect: 0, c4: 0, c5: 0, other: 0, nonIndexable: 0, times: [] });
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i], u = String(r[map.url] || '').trim(); if (!/^https?:\/\//i.test(u)) continue;
      if (map.type != null && r[map.type] && !/html/i.test(String(r[map.type]))) continue; // pages only
      const st = num(r[map.status]) || 0, id = sectionOf ? sectionOf(u) : 'all';
      const o = by.get(id) || z(id); o.urls++;
      if (st >= 200 && st < 300) o.ok++; else if (st >= 300 && st < 400) o.redirect++; else if (st >= 400 && st < 500) o.c4++; else if (st >= 500) o.c5++; else o.other++;
      const nonIdx = map.indexability != null ? /non/i.test(String(r[map.indexability])) : false;
      if (nonIdx && st >= 200 && st < 300) o.nonIndexable++;
      const t = map.time != null ? num(r[map.time]) : null; if (t != null) o.times.push(t);
      if (st >= 400 || st === 0) errors.push({ url: u, status: st || 'no response', cluster: o.cluster, why: map.why != null ? String(r[map.why] || '') : '' });
      by.set(id, o);
    }
    const clusters = [...by.values()].map(o => { const t = o.times.sort((a, b) => a - b); return { ...o, times: undefined, errors: o.c4 + o.c5, errorRate: o.urls ? (o.c4 + o.c5) / o.urls * 100 : 0, medianTime: t.length ? t[Math.floor((t.length - 1) / 2)] : null }; }).sort((a, b) => b.urls - a.urls);
    const tot = k => clusters.reduce((a, c) => a + c[k], 0);
    return { ok: true, urls: tot('urls'), errors4: tot('c4'), errors5: tot('c5'), redirects: tot('redirect'), nonIndexable: tot('nonIndexable'), clusters, errorList: errors.slice(0, 2000) };
  }

  // ── Content & programmatic: publishing log joined with Search Console pages ──
  const PUB_FIELDS = { url: ['url', 'page url', 'address', 'page', 'link'], date: ['publish date', 'published', 'published date', 'date published', 'created', 'created date', 'live date', 'date'], template: ['template', 'page template', 'type', 'content type', 'programmatic template'] };
  function publishingModel(rows, P, sectionOf, asOf) {
    if (!rows || rows.length < 2) return { ok: false, error: 'The file has no rows.' };
    const map = headerMap(rows[0], PUB_FIELDS);
    if (map.url == null || map.date == null) return { ok: false, error: 'Expected a URL column and a publish date column.', header: rows[0] };
    const gsc = new Map(); (P || []).forEach(r => { const k = pathOnly(r.p).toLowerCase(); const o = gsc.get(k) || { clicks: 0, impr: 0 }; o.clicks += +r.clicks || 0; o.impr += +r.impr || 0; gsc.set(k, o); });
    const ref = asOf ? new Date(asOf + 'T00:00:00Z') : new Date();
    const pages = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i], u = String(r[map.url] || '').trim(); if (!u) continue;
      const d = toDate(r[map.date]); if (!d) continue;
      const path = pathOnly(u), g = gsc.get(path.toLowerCase()) || { clicks: 0, impr: 0 };
      const id = sectionOf ? sectionOf(path) : 'all';
      pages.push({ path, date: iso(d), month: iso(d).slice(0, 7), age: Math.floor((ref - d) / 864e5), template: map.template != null && r[map.template] ? String(r[map.template]) : (sectionOf ? sectionOf.label(id) : ''), cluster: sectionOf ? sectionOf.label(id) : '', clicks: g.clicks, impr: g.impr });
    }
    if (!pages.length) return { ok: false, error: 'No rows had a URL and a readable date.', header: rows[0] };
    const agg = list => { const old = list.filter(p => p.age >= 90); return { published: list.length, visible: list.filter(p => p.impr > 0).length, old: old.length, traffic90: old.filter(p => p.clicks > 0).length, clicks: list.reduce((a, p) => a + p.clicks, 0), visibleRate: list.length ? list.filter(p => p.impr > 0).length / list.length * 100 : null, traffic90Rate: old.length ? old.filter(p => p.clicks > 0).length / old.length * 100 : null, perPage: list.length ? list.reduce((a, p) => a + p.clicks, 0) / list.length : null }; };
    const group = key => { const m = new Map(); pages.forEach(p => { const k = p[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(p); }); return [...m.entries()].map(([k, list]) => ({ key: k, ...agg(list) })); };
    return { ok: true, total: agg(pages), byMonth: group('month').sort((a, b) => a.key.localeCompare(b.key)), byTemplate: group('template').sort((a, b) => b.published - a.published), pages: pages.sort((a, b) => b.date.localeCompare(a.date)) };
  }

  // ── Link building: referring-domain export joined with ranking movement on the target pages ──
  const LINK_FIELDS = { domain: ['referring domain', 'domain', 'source domain', 'referring domains', 'root domain'], dr: ['domain rating', 'dr', 'authority score', 'as', 'domain authority', 'da', 'trust flow', 'tf'], date: ['first seen', 'first_seen', 'date', 'found', 'first found', 'date found'], target: ['target url', 'target', 'link target', 'url to', 'destination', 'target page'], source: ['referring page url', 'source url', 'referring page', 'url from'], status: ['link type', 'type', 'nofollow', 'follow'] };
  function linksModel(rows, A, D, sectionOf, since) {
    if (!rows || rows.length < 2) return { ok: false, error: 'The file has no rows.' };
    const map = headerMap(rows[0], LINK_FIELDS);
    if (map.domain == null && map.source == null) return { ok: false, error: 'Expected a referring domain (or referring page URL) column.', header: rows[0] };
    const seen = new Map();
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      let dom = map.domain != null ? String(r[map.domain] || '').trim().toLowerCase() : '';
      if (!dom && map.source != null) { try { dom = new URL(String(r[map.source])).hostname.toLowerCase(); } catch (e) { } }
      dom = dom.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]; if (!dom) continue;
      const d = map.date != null ? toDate(r[map.date]) : null, dr = map.dr != null ? num(r[map.dr]) : null;
      const nofollow = map.status != null && /nofollow|ugc|sponsored/i.test(String(r[map.status]));
      const tgt = map.target != null && r[map.target] ? pathOnly(r[map.target]) : null;
      const o = seen.get(dom); // one row per domain: earliest date, best rating, every target
      if (!o) seen.set(dom, { domain: dom, date: d, dr, nofollow, targets: new Set(tgt ? [tgt] : []) });
      else { if (d && (!o.date || d < o.date)) o.date = d; if (dr != null && (o.dr == null || dr > o.dr)) o.dr = dr; if (!nofollow) o.nofollow = false; if (tgt) o.targets.add(tgt); }
    }
    let list = [...seen.values()];
    if (since) list = list.filter(x => !x.date || iso(x.date) >= since);
    const tier = dr => dr == null ? 'Unknown' : dr >= 50 ? 'High (50+)' : dr >= 20 ? 'Medium (20–49)' : 'Low (0–19)';
    const tiers = ['High (50+)', 'Medium (20–49)', 'Low (0–19)', 'Unknown'].map(t => ({ tier: t, domains: list.filter(x => tier(x.dr) === t).length }));
    const months = new Map(); list.filter(x => x.date).forEach(x => { const k = iso(x.date).slice(0, 7); const o = months.get(k) || { month: k, domains: 0, high: 0, follow: 0 }; o.domains++; if (x.dr >= 50) o.high++; if (!x.nofollow) o.follow++; months.set(k, o); });
    // target pages: links gained + Search Console now vs previous period
    const cur = new Map((A.P || []).map(r => [pathOnly(r.p).toLowerCase(), r])), prev = new Map((D.prevP || []).map(r => [pathOnly(r.p).toLowerCase(), r]));
    const tg = new Map(); list.forEach(x => x.targets.forEach(t => { const o = tg.get(t) || { path: t, domains: 0, high: 0 }; o.domains++; if (x.dr >= 50) o.high++; tg.set(t, o); }));
    const targets = [...tg.values()].map(o => { const c = cur.get(o.path.toLowerCase()), p = prev.get(o.path.toLowerCase()); return { ...o, cluster: sectionOf ? sectionOf.label(sectionOf(o.path)) : '', clicks: c ? c.clicks : 0, pos: c ? c.pos : null, prevPos: p ? p.pos : null, posChange: c && p ? p.pos - c.pos : null, dClicks: c && p ? chg(c.clicks, p.clicks) : null }; }).sort((a, b) => b.domains - a.domains);
    const moved = targets.filter(t => t.posChange != null);
    return { ok: true, domains: list.length, follow: list.filter(x => !x.nofollow).length, avgDr: list.filter(x => x.dr != null).length ? list.filter(x => x.dr != null).reduce((a, x) => a + x.dr, 0) / list.filter(x => x.dr != null).length : null, tiers, months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)), targets, improved: moved.filter(t => t.posChange >= 1).length, declined: moved.filter(t => t.posChange <= -1).length, measured: moved.length, list: list.sort((a, b) => (b.date || 0) - (a.date || 0)).slice(0, 3000).map(x => ({ domain: x.domain, date: iso(x.date), dr: x.dr, nofollow: x.nofollow, tier: tier(x.dr), targets: [...x.targets].slice(0, 5).join(', ') })) };
  }

  // ── Visibility in AI answers: export of a prompt / query tracker ──
  const AI_FIELDS = { query: ['query', 'prompt', 'keyword', 'question'], engine: ['engine', 'platform', 'model', 'llm', 'source', 'ai engine', 'assistant'], mentioned: ['mentioned', 'brand mentioned', 'mention', 'unstop mentioned', 'is mentioned'], cited: ['cited', 'citation', 'unstop cited', 'is cited', 'linked'], url: ['cited url', 'citation url', 'source url', 'url', 'unstop url'], date: ['date', 'run date', 'checked', 'timestamp', 'run at'], cluster: ['cluster', 'topic', 'category', 'group', 'intent'], position: ['position', 'rank', 'mention position'] };
  function engineName(v) {
    const s = String(v || '').toLowerCase();
    if (/overview|sge|google ai|aio\b/.test(s)) return 'Google AI Overviews';
    if (/ai mode/.test(s)) return 'Google AI Mode';
    if (/chatgpt|openai|gpt/.test(s)) return 'ChatGPT';
    if (/perplexity/.test(s)) return 'Perplexity';
    if (/gemini|bard/.test(s)) return 'Gemini';
    if (/claude|anthropic/.test(s)) return 'Claude';
    if (/copilot|bing/.test(s)) return 'Copilot';
    return String(v || 'Other').trim() || 'Other';
  }
  function aiModel(rows) {
    if (!rows || rows.length < 2) return { ok: false, error: 'The file has no rows.' };
    const map = headerMap(rows[0], AI_FIELDS);
    if (map.query == null || map.engine == null || (map.mentioned == null && map.cited == null)) return { ok: false, error: 'Expected query (or prompt), engine (or platform) and a mentioned and / or cited column.', header: rows[0] };
    const runs = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i], q = String(r[map.query] || '').trim(); if (!q) continue;
      const d = map.date != null ? toDate(r[map.date]) : null;
      const cited = map.cited != null ? yes(r[map.cited]) || (map.url != null && /unstop\.com/i.test(String(r[map.url] || ''))) : false;
      const mentioned = map.mentioned != null ? yes(r[map.mentioned]) || cited : cited;
      runs.push({ q, engine: engineName(r[map.engine]), mentioned, cited, url: map.url != null ? String(r[map.url] || '') : '', date: iso(d), cluster: map.cluster != null ? String(r[map.cluster] || '') : '' });
    }
    if (!runs.length) return { ok: false, error: 'No rows with a query.', header: rows[0] };
    const latest = runs.map(r => r.date).filter(Boolean).sort().pop() || null;
    const agg = list => ({ runs: list.length, queries: new Set(list.map(r => r.q)).size, mention: list.length ? list.filter(r => r.mentioned).length / list.length * 100 : null, cite: list.length ? list.filter(r => r.cited).length / list.length * 100 : null });
    const engines = [...new Set(runs.map(r => r.engine))].map(e => ({ engine: e, ...agg(runs.filter(r => r.engine === e)) })).sort((a, b) => b.runs - a.runs);
    const months = new Map(); runs.filter(r => r.date).forEach(r => { const k = r.date.slice(0, 7); if (!months.has(k)) months.set(k, []); months.get(k).push(r); });
    const trend = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([m, list]) => ({ month: m, ...agg(list), byEngine: Object.fromEntries(engines.map(e => [e.engine, agg(list.filter(r => r.engine === e.engine)).mention])) }));
    const qm = new Map(); runs.forEach(r => { const o = qm.get(r.q) || { q: r.q, cluster: r.cluster, runs: 0, mentioned: 0, cited: 0, engines: new Set(), citedBy: new Set() }; o.runs++; if (r.mentioned) { o.mentioned++; o.engines.add(r.engine); } if (r.cited) { o.cited++; o.citedBy.add(r.engine); } qm.set(r.q, o); });
    const queries = [...qm.values()].map(o => ({ q: o.q, cluster: o.cluster, runs: o.runs, mention: o.mentioned / o.runs * 100, cite: o.cited / o.runs * 100, engines: [...o.engines].join(', '), citedBy: [...o.citedBy].join(', ') })).sort((a, b) => a.mention - b.mention);
    const um = new Map(); runs.filter(r => r.cited && /unstop\.com/i.test(r.url)).forEach(r => { const k = pathOnly(r.url); um.set(k, (um.get(k) || 0) + 1); });
    const clusters = [...new Set(runs.map(r => r.cluster).filter(Boolean))].map(c => ({ cluster: c, ...agg(runs.filter(r => r.cluster === c)) })).sort((a, b) => b.runs - a.runs);
    return { ok: true, total: agg(runs), latest, engines, trend, queries, clusters, urls: [...um.entries()].map(([path, n]) => ({ path, n })).sort((a, b) => b.n - a.n) };
  }


  // ── Share of voice on a fixed keyword set (rank tracker export: Semrush, Ahrefs, SE Ranking, DataForSEO…) ──
  // Long format: keyword, domain (or URL), position, [volume], [date], [url].
  // Wide format: keyword, [volume], one position column per domain (header contains the domain).
  // Share of voice = estimated clicks (volume × CTR at the position) ÷ the same for every tracked domain.
  const SOV_FIELDS = { keyword: ['keyword', 'query', 'search term', 'term'], domain: ['domain', 'competitor', 'site', 'website', 'ranking domain'], url: ['url', 'ranking url', 'landing page', 'page'], position: ['position', 'rank', 'pos', 'ranking', 'current position'], volume: ['volume', 'search volume', 'avg. monthly searches', 'msv', 'sv'], date: ['date', 'checked', 'tracked on', 'run date'] };
  const host = v => { const s = String(v || '').trim().toLowerCase(); if (!s) return ''; try { return new URL(/^https?:/.test(s) ? s : 'https://' + s).hostname.replace(/^www\./, ''); } catch (e) { return s.replace(/^www\./, '').split('/')[0]; } };
  function sovModel(rows, opt = {}) {
    if (!rows || rows.length < 2) return { ok: false, error: 'The file has no rows.' };
    const own = host(opt.own || 'unstop.com'), comps = (opt.competitors || []).map(host).filter(Boolean);
    const domains = [own].concat(comps.filter(c => c !== own));
    const match = h => domains.find(d => h === d || h.endsWith('.' + d)) || null;
    const ctr = opt.ctr || (p => p <= 1 ? 28 : p <= 2 ? 15 : p <= 3 ? 10 : p <= 5 ? 6 : p <= 10 ? 2.5 : p <= 20 ? 0.8 : 0.2);
    const header = rows[0], map = headerMap(header, SOV_FIELDS);
    if (map.keyword == null) return { ok: false, error: 'Expected a keyword column.', header };
    const obs = []; // { kw, date, domain, pos, url, vol }
    const hl = header.map(x => String(x || '').toLowerCase());
    // wide format when two or more headers name a tracked domain
    const wideAll = hl.map((h, i) => ({ i, d: match(host(h.replace(/position|rank|pos|\(|\)|:|_/g, ' ').trim().split(/\s+/).find(x => x.includes('.')) || '')) })).filter(x => x.d);
    const wideCols = wideAll.length >= 2 ? wideAll : [];
    if (map.position == null && !wideCols.length) return { ok: false, error: 'Expected a position column (long format) or one position column per domain (wide format).', header };
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i], kw = String(r[map.keyword] || '').trim().toLowerCase(); if (!kw) continue;
      const vol = map.volume != null ? num(r[map.volume]) : null, d = map.date != null ? iso(toDate(r[map.date])) : null;
      if (wideCols.length) wideCols.forEach(c => { const p = num(r[c.i]); if (p != null && p > 0) obs.push({ kw, date: d, domain: c.d, pos: p, url: '', vol }); });
      else { const dm = match(host(map.domain != null ? r[map.domain] : r[map.url])); const p = num(r[map.position]); if (dm && p != null && p > 0) obs.push({ kw, date: d, domain: dm, pos: p, url: map.url != null ? String(r[map.url] || '') : '', vol }); else if (dm == null && map.domain == null && map.url != null && p != null) { /* other domains are ignored */ } }
    }
    if (!obs.length) return { ok: false, error: `No positions found for ${domains.join(', ')}. Check the competitor domains in Funnel setup.`, header };
    const dates = [...new Set(obs.map(o => o.date).filter(Boolean))].sort();
    const latest = dates.length ? dates[dates.length - 1] : null, prevDate = dates.length > 1 ? dates[dates.length - 2] : null;
    const fixed = (opt.keywords || []).map(k => String(k).trim().toLowerCase()).filter(Boolean);
    const inSet = fixed.length ? new Set(fixed) : null;
    const pick = dt => { const m = new Map(); obs.filter(o => (!dt || o.date === dt) && (!inSet || inSet.has(o.kw))).forEach(o => { const k = o.kw + '|' + o.domain, x = m.get(k); if (!x || o.pos < x.pos) m.set(k, o); }); return [...m.values()]; };
    const volOf = new Map(); obs.forEach(o => { if (o.vol != null && !volOf.has(o.kw)) volOf.set(o.kw, o.vol); });
    const snap = list => {
      const kws = [...new Set(list.map(o => o.kw))];
      const per = domains.map(d => { const mine = list.filter(o => o.domain === d); const est = mine.reduce((a, o) => a + (volOf.get(o.kw) || 100) * ctr(o.pos) / 100, 0); return { domain: d, own: d === own, ranked: mine.length, top3: mine.filter(o => o.pos <= 3).length, top10: mine.filter(o => o.pos <= 10).length, avgPos: mine.length ? mine.reduce((a, o) => a + o.pos, 0) / mine.length : null, est }; });
      const tot = per.reduce((a, x) => a + x.est, 0);
      per.forEach(x => { x.sov = tot ? x.est / tot * 100 : null; });
      return { keywords: kws.length, per };
    };
    const cur = snap(pick(latest)), prev = prevDate ? snap(pick(prevDate)) : null;
    cur.per.forEach(x => { const p = prev && prev.per.find(y => y.domain === x.domain); x.dSov = p && p.sov != null && x.sov != null ? x.sov - p.sov : null; x.dTop10 = p ? x.top10 - p.top10 : null; });
    // keyword table (latest snapshot)
    const L = pick(latest), kwRows = [...new Set(L.map(o => o.kw))].map(kw => { const r = { kw, vol: volOf.get(kw) || null, cluster: opt.clusterOf ? opt.clusterOf(kw) : '' }; domains.forEach(d => { const o = L.find(x => x.kw === kw && x.domain === d); r[d] = o ? o.pos : null; if (d === own && o) r.url = o.url; }); const best = domains.filter(d => r[d] != null).sort((a, b) => r[a] - r[b])[0]; r.leader = best || null; r.gap = r[own] == null ? null : best && best !== own ? r[own] - r[best] : 0; return r; }).sort((a, b) => (b.vol || 0) - (a.vol || 0));
    // by query cluster
    const byCluster = opt.clusterOf ? [...new Set(kwRows.map(r => r.cluster))].map(c => { const s2 = snap(L.filter(o => opt.clusterOf(o.kw) === c)); const me = s2.per.find(x => x.own); const lead = s2.per.slice().sort((a, b) => (b.sov || 0) - (a.sov || 0))[0]; return { cluster: c, keywords: s2.keywords, sov: me ? me.sov : null, leader: lead && lead.sov ? lead.domain : null, leaderSov: lead ? lead.sov : null }; }).sort((a, b) => b.keywords - a.keywords) : [];
    const trend = dates.map(dt => { const s2 = snap(pick(dt)); return { date: dt, ...Object.fromEntries(s2.per.map(x => [x.domain, x.sov])) }; });
    return { ok: true, own, domains, latest, prevDate, fixed: fixed.length, covered: inSet ? kwRows.length : null, missing: inSet ? fixed.filter(k => !kwRows.some(r => r.kw === k)) : [], cur, kwRows, byCluster, trend };
  }
  const API = { sovModel, CWV, psiUrl, psiParse, cwvSummary, crawlModel, publishingModel, linksModel, aiModel, engineName, headerMap, toDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.UN_SC = API;
})(typeof window !== 'undefined' ? window : globalThis);
