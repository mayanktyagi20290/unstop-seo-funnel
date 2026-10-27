// Unstop full-funnel layer: page types, query clusters, GSC visibility by page type, GA4 organic funnel
// and MoEngage signup quality. Pure functions only (no DOM, no network) so they can be tested in Node.
(function (root) {
  'use strict';

  // ── page types ──
  // Each rule is a path prefix matched on a folder boundary ("/hackathons" matches /hackathons and
  // /hackathons/x, not /hackathons-2026). A trailing * matches any continuation ("/employers/hire-*").
  // "=/" matches one exact path. First matching type wins, in the order listed.
  const DEFAULT_TYPES = [
    { id: 'home', name: 'Home', rules: ['=/'] },
    { id: 'util', name: 'Login, account & utility', seo: false, rules: ['/auth', '/user', '/organiser-panel', '/manage', '/app', '/api', '/submissions-round', '/post-now', '/legal', '/faq', '/contact-us', '/refer-and-earn', '/about', '/notifications', '/home', '/certificate-preview', '/f'] },
    { id: 'emp', name: 'Employer-facing', rules: ['/employers', '/saas-pricing', '/institutions', '/reports', '/unstop-bridge-for-colleges', '/online-assessment-platform', '/hire', '/recruiters', '/hiring-solutions', '/talent-report-*', '/unstop-talent-meet-*', '/our-partners'] },
    { id: 'org', name: 'College & company', rules: ['/c', '/college', '/colleges', '/company', '/companies', '/institute', '/institutes'] },
    { id: 'opp', name: 'Opportunity & competition', rules: ['/hackathons', '/competitions', '/competitions-challenges', '/internships', '/internship', '/internship-portal', '/jobs', '/job', '/job-portal', '/quiz', '/quizzes', '/college-fests', '/festival', '/events', '/awards', '/workshops-webinars', '/workshops', '/scholarships', '/conferences', '/cultural-events', '/hiring-challenges', '/all-opportunities', '/compete', '/p', '/o', '/off-campus-hiring-drive-*', '/campus-ambassador-program', '/college-festivals', '/online-quizzing-festival', '/voting-round', '/unstop-dream-companies-*'] },
    { id: 'blog', name: 'Blog & guides', rules: ['/blog', '/blog-series', '/category', '/prep-zone', '/bites', '/resources', '/top-*'] },
    { id: 'prod', name: 'Practice, courses & tools', rules: ['/practice', '/courses', '/code', '/mentor', '/find-a-mentor', '/become-a-mentor', '/resume-builder', '/tools', '/business-simulation-games', '/pro', '/unstop-leaderboard', '/unstop-rewards-program', '/unstop-igniters-club'] }
  ];
  // the four page types the tracking sheet reports on, in its order
  const CORE = ['opp', 'org', 'blog', 'emp'];
  const OTHER = { id: 'other', name: 'Other' };

  // Root-level article slugs such as /tcs-nqt-exam-pattern-sections-and-preparation-guide count as Blog & guides
  // when they have at least this many hyphens.
  const ROOT_ARTICLE_HYPHENS = 4;

  function pathOnly(u) {
    let s = String(u || '').trim();
    s = s.replace(/^[a-z]+:\/\/[^/]+/i, '');
    s = s.split('#')[0].split('?')[0];
    try { s = decodeURI(s); } catch (e) { }
    s = s.trim();
    if (!s.startsWith('/')) s = '/' + s;
    s = s.replace(/\/{2,}/g, '/');
    return s.length > 1 ? s.replace(/\/$/, '') : s;
  }
  function ruleTest(rule) {
    rule = String(rule || '').trim().toLowerCase();
    if (!rule) return null;
    if (rule.startsWith('=')) { const p = pathOnly(rule.slice(1)); return path => path === p; }
    if (!rule.startsWith('/')) rule = '/' + rule;
    if (rule.endsWith('*')) { const pre = rule.slice(0, -1); return path => path.startsWith(pre); }
    const p = rule.replace(/\/$/, '');
    return path => path === p || path.startsWith(p + '/');
  }
  function makeClassifier(types, opt = {}) {
    const list = (types && types.length ? types : DEFAULT_TYPES).map(t => ({ ...t, tests: (t.rules || []).map(ruleTest).filter(Boolean) }));
    const blog = list.find(t => t.id === 'blog');
    const rootArticles = opt.rootArticles !== false;
    const cache = new Map();
    const fn = url => {
      const path = pathOnly(url).toLowerCase();
      if (cache.has(path)) return cache.get(path);
      let hit = list.find(t => t.tests.some(f => f(path)));
      if (!hit && rootArticles && blog) {
        const segs = path.split('/').filter(Boolean);
        if (segs.length === 1 && (segs[0].match(/-/g) || []).length >= ROOT_ARTICLE_HYPHENS) hit = blog;
      }
      const id = hit ? hit.id : OTHER.id;
      if (cache.size > 200000) cache.clear();
      cache.set(path, id);
      return id;
    };
    fn.types = list.map(t => ({ id: t.id, name: t.name, seo: t.seo !== false, rules: t.rules || [] })).concat([{ ...OTHER, seo: true, rules: [] }]);
    fn.label = id => (fn.types.find(t => t.id === id) || OTHER).name;
    return fn;
  }
  // Google Search Console accepts RE2 regex page filters; build one per page type from its rules.
  function typeRegex(type, host) {
    const h = host ? '^https?://(www\\.)?' + esc(host) : '^https?://[^/]+';
    const parts = (type.rules || []).map(r => {
      r = String(r).trim().toLowerCase(); if (!r) return null;
      if (r.startsWith('=')) { const p = pathOnly(r.slice(1)); return esc(p) + (p === '/' ? '?' : '/?') + '(\\?.*)?$'; }
      if (!r.startsWith('/')) r = '/' + r;
      if (r.endsWith('*')) return esc(r.slice(0, -1));
      return esc(r.replace(/\/$/, '')) + '([/?#%]|$)';
    }).filter(Boolean);
    if (type.id === 'blog') parts.push('/[^/?#]*(-[^/?#]*){' + ROOT_ARTICLE_HYPHENS + ',}/?(\\?.*)?$');
    return parts.length ? h + '(' + parts.join('|') + ')' : null;
  }
  function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Parse the text the user edits: one type per line, "Name: /a, /b, =/exact".
  function parseTypes(text) {
    const out = [], seen = new Set();
    String(text || '').split('\n').forEach(line => {
      const m = line.match(/^\s*([^:]+):\s*(.*)$/); if (!m) return;
      const name = m[1].trim(); if (!name) return;
      const def = DEFAULT_TYPES.find(t => t.name.toLowerCase() === name.toLowerCase());
      let id = def ? def.id : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'type';
      while (seen.has(id)) id += '2';
      seen.add(id);
      out.push({ id, name, seo: def ? def.seo !== false : true, rules: m[2].split(',').map(s => s.trim()).filter(Boolean) });
    });
    return out;
  }
  const typesText = types => (types || DEFAULT_TYPES).map(t => `${t.name}: ${(t.rules || []).join(', ')}`).join('\n');

  // ── query clusters (first match wins; words are matched as whole words or phrases) ──
  const DEFAULT_CLUSTERS = [
    { name: 'Employer / hiring solutions', words: ['ats', 'applicant tracking', 'assessment platform', 'online assessment', 'recruitment software', 'hiring platform', 'campus hiring', 'hiring software', 'proctoring', 'interview platform', 'sourcing', 'recruitment platform', 'hire'] },
    { name: 'Hackathons', words: ['hackathon', 'hackathons', 'ml challenge', 'codeathon', 'designathon', 'ideathon'] },
    { name: 'Competitions & quizzes', words: ['competition', 'competitions', 'quiz', 'case study', 'case competition', 'challenge', 'olympiad', 'contest'] },
    { name: 'Internships', words: ['internship', 'internships', 'intern', 'summer internship', 'stipend'] },
    { name: 'Jobs & hiring drives', words: ['job', 'jobs', 'fresher', 'freshers', 'off campus', 'hiring', 'recruitment', 'vacancy', 'graduate engineer trainee', 'get', 'walk in'] },
    { name: 'Exam & placement prep', words: ['exam', 'syllabus', 'pattern', 'question paper', 'question papers', 'previous year', 'interview questions', 'aptitude', 'nqt', 'mock test', 'cut off', 'cutoff', 'eligibility', 'salary'] },
    { name: 'College fests & events', words: ['fest', 'fests', 'festival', 'techfest', 'event', 'events', 'conference', 'workshop', 'webinar'] },
    { name: 'Scholarships', words: ['scholarship', 'scholarships'] },
    { name: 'Practice & courses', words: ['practice', 'course', 'courses', 'coding', 'python', 'sql', 'dsa', 'mentor', 'resume'] }
  ];
  function makeClusterer(clusters) {
    const list = (clusters && clusters.length ? clusters : DEFAULT_CLUSTERS).map(c => ({ name: c.name, rx: c.words && c.words.length ? new RegExp('\\b(' + c.words.map(w => esc(String(w).trim().toLowerCase())).filter(Boolean).join('|') + ')\\b', 'i') : null }));
    const fn = q => { const s = String(q || ''); const hit = list.find(c => c.rx && c.rx.test(s)); return hit ? hit.name : 'Other'; };
    fn.names = list.map(c => c.name).concat(['Other']);
    return fn;
  }
  const clustersText = cl => (cl || DEFAULT_CLUSTERS).map(c => `${c.name}: ${c.words.join(', ')}`).join('\n');
  function parseClusters(text) {
    return String(text || '').split('\n').map(l => l.match(/^\s*([^:]+):\s*(.*)$/)).filter(Boolean)
      .map(m => ({ name: m[1].trim(), words: m[2].split(',').map(s => s.trim()).filter(Boolean) })).filter(c => c.name && c.words.length);
  }


  // ── URL clusters: the finer split inside each page type (first match wins, top to bottom) ──
  // Built from the folders that get Search Console traffic on unstop.com. `type` is the page type the
  // cluster rolls up to. The /employers split (job board vs B2B) follows the team's own segmentation.
  const DEFAULT_SECTIONS = [
    { id: 'hackathons', name: 'Hackathons', type: 'opp', rules: ['/hackathons', '/hackathon'] },
    { id: 'competitions', name: 'Competitions', type: 'opp', rules: ['/competitions', '/competition', '/competitions-challenges', '/compete'] },
    { id: 'internships', name: 'Internships', type: 'opp', rules: ['/internships', '/internship', '/internship-portal', '/internship-openings'] },
    { id: 'jobs', name: 'Jobs', type: 'opp', rules: ['/jobs', '/job', '/job-portal', '/hiring-challenges', '/off-campus-hiring-drive-*'] },
    { id: 'quizzes', name: 'Quizzes', type: 'opp', rules: ['/quiz', '/quizzes', '/online-quizzing-festival'] },
    { id: 'fests', name: 'College fests & events', type: 'opp', rules: ['/college-fests', '/college-festivals', '/festival', '/events', '/cultural-events', '/creative-cultural-events', '/conferences'] },
    { id: 'workshops', name: 'Workshops & webinars', type: 'opp', rules: ['/workshops-webinars', '/workshops'] },
    { id: 'scholarships', name: 'Scholarships', type: 'opp', rules: ['/scholarships'] },
    { id: 'awards', name: 'Awards', type: 'opp', rules: ['/awards'] },
    { id: 'ambassador', name: 'Campus ambassador', type: 'opp', rules: ['/campus-ambassador-program'] },
    { id: 'oppother', name: 'Other opportunity pages', type: 'opp', rules: ['/all-opportunities', '/p', '/o', '/voting-round', '/unstop-dream-companies-*'] },
    { id: 'orgpages', name: 'Company & college pages', type: 'org', rules: ['/c', '/college', '/colleges', '/company', '/companies', '/institute', '/institutes'] },
    { id: 'blog', name: 'Blog', type: 'blog', rules: ['/blog', '/blog-series', '/category', '/bites'] },
    { id: 'resources', name: 'Resources & prep', type: 'blog', rules: ['/resources', '/prep-zone', '/top-*'] },
    { id: 'empjobboard', name: 'Employers – job board', type: 'emp', rules: ['/employers/hire-*', '/employers/ai-sourcing-agent', '/employers/jobs-internships-listings-jobboard', '/employers/our-largest-early-talent-community'] },
    { id: 'empb2b', name: 'Employers – B2B products', type: 'emp', rules: ['/employers', '/saas-pricing', '/online-assessment-platform', '/hire', '/recruiters', '/hiring-solutions'] },
    { id: 'empreports', name: 'Employer reports & partners', type: 'emp', rules: ['/talent-report-*', '/unstop-talent-meet-*', '/our-partners', '/unstop-bridge-for-colleges', '/institutions', '/reports'] },
    { id: 'practice', name: 'Practice & coding', type: 'prod', rules: ['/practice', '/code'] },
    { id: 'courses', name: 'Courses & mentorship', type: 'prod', rules: ['/courses', '/mentor', '/find-a-mentor', '/become-a-mentor'] },
    { id: 'tools', name: 'Tools & programs', type: 'prod', rules: ['/resume-builder', '/tools', '/business-simulation-games', '/pro', '/unstop-leaderboard', '/unstop-rewards-program', '/unstop-igniters-club'] },
    { id: 'home', name: 'Home page', type: 'home', rules: ['=/'] },
    { id: 'util', name: 'Login, account & utility', type: 'util', rules: ['/auth', '/user', '/organiser-panel', '/manage', '/app', '/api', '/submissions-round', '/post-now', '/legal', '/faq', '/contact-us', '/refer-and-earn', '/about', '/notifications', '/home', '/certificate-preview', '/f'] }
  ];
  // Clusters whose pages carry a clear conversion path (register, apply, post a job, book a demo) by default.
  const DEFAULT_PATH_SECTIONS = ['hackathons', 'competitions', 'internships', 'jobs', 'quizzes', 'fests', 'workshops', 'scholarships', 'awards', 'ambassador', 'oppother', 'empjobboard', 'empb2b', 'practice'];
  // The section whose id is 'blog' also takes root-level article slugs, like the Blog & guides type.
  function makeSectioner(sections, opt = {}) {
    const list = (sections && sections.length ? sections : DEFAULT_SECTIONS).map(x => ({ ...x, tests: (x.rules || []).map(ruleTest).filter(Boolean) }));
    const blog = list.find(x => x.id === 'blog');
    const cache = new Map();
    const fn = url => {
      const path = pathOnly(url).toLowerCase();
      if (cache.has(path)) return cache.get(path);
      let hit = list.find(x => x.tests.some(f => f(path)));
      if (!hit && opt.rootArticles !== false && blog) { const segs = path.split('/').filter(Boolean); if (segs.length === 1 && (segs[0].match(/-/g) || []).length >= ROOT_ARTICLE_HYPHENS) hit = blog; }
      const id = hit ? hit.id : 'other';
      if (cache.size > 200000) cache.clear();
      cache.set(path, id); return id;
    };
    fn.sections = list.map(x => ({ id: x.id, name: x.name, type: x.type || 'other', rules: x.rules || [] })).concat([{ id: 'other', name: 'Other (no cluster rule)', type: 'other', rules: [] }]);
    fn.label = id => (fn.sections.find(x => x.id === id) || { name: id }).name;
    fn.typeOf = id => (fn.sections.find(x => x.id === id) || { type: 'other' }).type;
    return fn;
  }
  // "Name | Page type: /a, /b" — the page type may be given by name or id; omitted = Other.
  function parseSections(text, types) {
    const T = types && types.length ? types : DEFAULT_TYPES;
    const out = [], seen = new Set();
    String(text || '').split('\n').forEach(line => {
      const m = line.match(/^\s*([^:|]+?)\s*(?:\|\s*([^:]+?)\s*)?:\s*(.*)$/); if (!m) return;
      const name = m[1].trim(); if (!name) return;
      const def = DEFAULT_SECTIONS.find(x => x.name.toLowerCase() === name.toLowerCase());
      const tn = (m[2] || '').trim().toLowerCase();
      const t = tn ? T.find(x => x.name.toLowerCase() === tn || x.id === tn) : null;
      let id = def ? def.id : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'cluster';
      while (seen.has(id)) id += '2';
      seen.add(id);
      out.push({ id, name, type: t ? t.id : def && !tn ? def.type : 'other', rules: m[3].split(',').map(x => x.trim()).filter(Boolean) });
    });
    return out;
  }
  const sectionsText = (sections, types) => { const T = types && types.length ? types : DEFAULT_TYPES; return (sections || DEFAULT_SECTIONS).map(x => `${x.name} | ${(T.find(t => t.id === x.type) || { name: x.type || 'Other' }).name}: ${(x.rules || []).join(', ')}`).join('\n'); };
  function sectionRegex(section, host) { return typeRegex({ id: section.id === 'blog' ? 'blog' : 'x', rules: section.rules }, host); }
  // Search Console page filters are independent regexes, not "first match wins", so a wide cluster
  // (/employers) would also count a narrower cluster listed above it (/employers/hire-*). This returns a
  // regex of those earlier, narrower rules to exclude (null when nothing overlaps).
  function sectionExclude(section, sections) {
    const list = sections && sections.length ? sections : DEFAULT_SECTIONS;
    const idx = list.findIndex(x => x.id === section.id);
    const base = r => { r = String(r).trim().toLowerCase(); if (r.startsWith('=')) return null; if (!r.startsWith('/')) r = '/' + r; return r.replace(/\*$/, '').replace(/\/$/, ''); };
    const mine = (section.rules || []).map(base).filter(Boolean);
    const hits = [];
    list.slice(0, Math.max(0, idx)).forEach(e => (e.rules || []).forEach(r => { const b = base(r); if (b && mine.some(m => b !== m && b.startsWith(m + (m.endsWith('-') ? '' : '/')))) hits.push(r); }));
    // the blog cluster's root-article-slug pattern only applies when no other cluster's rule matches
    // (only prefix rules such as /top-* can match a one-segment slug; exact paths with 4+ hyphens too)
    if (section.id === 'blog') list.forEach(e => { if (e.id !== 'blog') (e.rules || []).forEach(r => { const t = String(r).trim(); if ((t.endsWith('*') || (t.match(/-/g) || []).length >= ROOT_ARTICLE_HYPHENS) && !hits.includes(r)) hits.push(r); }); });
    return hits.length ? typeRegex({ id: 'x', rules: hits }, null) : null;
  }

  // One URL cluster from Search Console rows.
  //   tot/b/nb: aggregate rows ({ clicks, impressions, position }) for all, branded-only and non-branded-only
  //   queries: [{ q, clicks, impr, pos }] with the page filter applied (positions are for this cluster's pages)
  // Queries Google anonymises are in `tot` but in neither branded nor non-branded, so they are shown apart.
  function sectionModel(o, isBrand, clusterOf) {
    const m = r => r ? { clicks: +r.clicks || 0, impr: +r.impressions || +r.impr || 0, ctr: (+r.impressions || +r.impr) ? (+r.clicks || 0) / (+r.impressions || +r.impr) * 100 : 0, pos: +r.position || +r.pos || 0 } : { clicks: 0, impr: 0, ctr: 0, pos: 0 };
    const z = () => ({ top3: 0, top10: 0, p11: 0, total: 0 });
    const put = (x, pos) => { x.total++; if (pos <= 3) x.top3++; if (pos <= 10) x.top10++; if (pos > 10 && pos <= 20) x.p11++; };
    const buckets = list => { const b = z(), n = z(); (list || []).forEach(r => { if (!(+r.impr > 0)) return; put(isBrand(r.q) ? b : n, +r.pos || 999); }); return { b, n }; };
    const tot = m(o.tot), b = m(o.b), nb = m(o.nb);
    const anon = { clicks: Math.max(0, tot.clicks - b.clicks - nb.clicks), impr: Math.max(0, tot.impr - b.impr - nb.impr) };
    const cur = buckets(o.queries), prev = o.prevQueries ? buckets(o.prevQueries) : null;
    const qc = new Map();
    (o.queries || []).forEach(r => {
      if (!(+r.impr > 0)) return;
      const k = clusterOf ? clusterOf(r.q) : 'All';
      const x = qc.get(k) || { name: k, nb: blank(), b: blank(), n3: 0, n10: 0, n11: 0, nq: 0 };
      if (isBrand(r.q)) add(x.b, r); else { add(x.nb, r); x.nq++; const p = +r.pos || 999; if (p <= 3) x.n3++; if (p <= 10) x.n10++; if (p > 10 && p <= 20) x.n11++; }
      qc.set(k, x);
    });
    const quick = (o.queries || []).filter(r => !isBrand(r.q) && r.pos > 10 && r.pos <= 20 && r.impr > 0).sort((a, c) => c.impr - a.impr).slice(0, 50);
    const P = o.prevTot ? { tot: m(o.prevTot), b: m(o.prevB), nb: m(o.prevNb) } : null;
    return {
      tot, b, nb, anon, bShare: (b.clicks + nb.clicks) ? b.clicks / (b.clicks + nb.clicks) * 100 : null,
      buckets: cur, prevBuckets: prev, prev: P,
      d: P ? { clicks: chg(tot.clicks, P.tot.clicks), impr: chg(tot.impr, P.tot.impr), nbClicks: chg(nb.clicks, P.nb.clicks), nbImpr: chg(nb.impr, P.nb.impr), bClicks: chg(b.clicks, P.b.clicks), nbPos: P.nb.pos && nb.pos ? nb.pos - P.nb.pos : null } : null,
      byQueryCluster: [...qc.values()].map(x => ({ name: x.name, nb: fin(x.nb), b: fin(x.b), n3: x.n3, n10: x.n10, n11: x.n11, nq: x.nq })).sort((a, c) => c.nb.clicks - a.nb.clicks),
      quick, queryRows: (o.queries || []).length, capped: !!o.capped
    };
  }
  // Fallback for uploads and sample data: page totals from the page report, the branded split from
  // query × page rows (an estimate, labelled as such by the view).
  function sectionsFromRows(A, D, sectionOf, isBrand, clusterOf, opt = {}) {
    const S = new Map();
    const get = id => { if (!S.has(id)) S.set(id, { tot: blank(), prevTot: blank(), qp: new Map() }); return S.get(id); };
    (A.P || []).forEach(r => add(get(sectionOf(r.p)).tot, r));
    (D.prevP || []).forEach(r => add(get(sectionOf(r.p)).prevTot, r));
    (D.QP || []).forEach(r => { const x = get(sectionOf(r.p)); const o = x.qp.get(r.q) || { q: r.q, clicks: 0, impr: 0, posW: 0 }; o.clicks += +r.clicks || 0; o.impr += +r.impr || 0; o.posW += (+r.pos || 0) * (+r.impr || 0); x.qp.set(r.q, o); });
    const out = new Map();
    S.forEach((x, id) => {
      const queries = [...x.qp.values()].map(o => ({ q: o.q, clicks: o.clicks, impr: o.impr, pos: o.impr ? o.posW / o.impr : 0 }));
      const sumOf = f => { const o = blank(); queries.filter(f).forEach(r => add(o, r)); return o; };
      const qb = sumOf(r => isBrand(r.q)), qn = sumOf(r => !isBrand(r.q));
      const T = fin(x.tot), share = (qb.clicks + qn.clicks) ? qb.clicks / (qb.clicks + qn.clicks) : null, ishare = (qb.impr + qn.impr) ? qb.impr / (qb.impr + qn.impr) : null;
      // exact: query × page rows are complete (sample data), so they are used as they are
      const est = (f, fi, src) => opt.exact ? { clicks: src.clicks, impressions: src.impr, position: fin(src).pos } : ({ clicks: f == null ? 0 : T.clicks * f, impressions: fi == null ? 0 : T.impr * fi, position: fin(src).pos });
      const pt = fin(x.prevTot);
      out.set(id, sectionModel({ tot: { clicks: T.clicks, impressions: T.impr, position: T.pos }, b: est(share, ishare, qb), nb: est(share == null ? null : 1 - share, ishare == null ? null : 1 - ishare, qn), queries,
        prevTot: pt.impr ? { clicks: pt.clicks, impressions: pt.impr, position: pt.pos } : null, prevB: null, prevNb: null }, isBrand, clusterOf));
      const s = out.get(id); s.estimated = !opt.exact; if (!opt.exact) s.anon = { clicks: 0, impr: 0 }; if (s.prev) { s.d = { clicks: chg(T.clicks, pt.clicks), impr: chg(T.impr, pt.impr) }; }
    });
    return out;
  }

  // ── aggregation helpers ──
  function blank() { return { clicks: 0, impr: 0, posW: 0, n: 0 }; }
  function add(o, r) { o.clicks += +r.clicks || 0; o.impr += +r.impr || 0; o.posW += (+r.pos || 0) * (+r.impr || 0); o.n++; return o; }
  function fin(o) { return { clicks: o.clicks, impr: o.impr, ctr: o.impr ? o.clicks / o.impr * 100 : 0, pos: o.impr ? o.posW / o.impr : 0, n: o.n }; }
  const chg = (c, p) => (p == null || !isFinite(p) || p === 0 || c == null) ? null : (c - p) / p * 100;

  // ── GSC: visibility by page type ──
  // Page totals come from the page report (complete for pages); the branded share of each type comes from
  // query × page rows (the API's first 25,000), applied to the page totals and labelled as such.
  function visibility(A, D, typeOf, isBrand) {
    const T = new Map();
    const get = id => { if (!T.has(id)) T.set(id, { id, pages: blank(), prevPages: blank(), qpB: blank(), qpN: blank(), urls: 0, prevUrls: 0 }); return T.get(id); };
    (A.P || []).forEach(r => { const t = get(typeOf(r.p)); add(t.pages, r); if ((+r.impr || 0) > 0) t.urls++; });
    (D.prevP || []).forEach(r => { const t = get(typeOf(r.p)); add(t.prevPages, r); if ((+r.impr || 0) > 0) t.prevUrls++; });
    const hasQP = !!(D.QP && D.QP.length);
    if (hasQP) D.QP.forEach(r => { const t = get(typeOf(r.p)); add(isBrand(r.q) ? t.qpB : t.qpN, r); });
    const rows = [...T.values()].map(t => {
      const cur = fin(t.pages), prev = t.prevPages.n ? fin(t.prevPages) : null;
      const b = fin(t.qpB), n = fin(t.qpN);
      const qpClicks = b.clicks + n.clicks, qpImpr = b.impr + n.impr;
      const bShareC = qpClicks ? b.clicks / qpClicks : null, bShareI = qpImpr ? b.impr / qpImpr : null;
      return {
        id: t.id, name: typeOf.label(t.id), ...cur, urls: t.urls, prevUrls: t.prevUrls,
        prev, dClicks: prev ? chg(cur.clicks, prev.clicks) : null, dImpr: prev ? chg(cur.impr, prev.impr) : null, dPos: prev && prev.pos && cur.pos ? cur.pos - prev.pos : null,
        brand: hasQP ? { clicks: b.clicks, impr: b.impr, ctr: b.ctr, pos: b.pos } : null,
        nonBrand: hasQP ? { clicks: n.clicks, impr: n.impr, ctr: n.ctr, pos: n.pos } : null,
        bShareC, bShareI,
        // estimated split of the page totals using the query × page share
        estNB: bShareC == null ? null : { clicks: cur.clicks * (1 - bShareC), impr: cur.impr * (1 - (bShareI || 0)) }
      };
    });
    const order = id => { const i = typeOf.types.findIndex(t => t.id === id); return CORE.includes(id) ? CORE.indexOf(id) : 10 + (i < 0 ? 99 : i); };
    rows.sort((a, b) => order(a.id) - order(b.id));
    return { rows, hasQP, qpRows: hasQP ? D.QP.length : 0 };
  }

  // Ranking buckets: each query is assigned to the page type of the page that got most of its impressions
  // (query × page rows). Counts keywords in the top 3, top 10 and positions 11–20, branded and non-branded.
  function rankBuckets(A, D, typeOf, isBrand, clusterOf) {
    const topPage = qpTop(D.QP);
    const prevTop = topPage; // the previous period has no query × page rows; reuse current mapping
    const out = new Map();
    const row = (key, name) => { if (!out.has(key)) out.set(key, { key, name, b: z(), n: z(), pb: z(), pn: z() }); return out.get(key); };
    function z() { return { top3: 0, top10: 0, p11: 0, total: 0 }; }
    const put = (o, pos) => { o.total++; if (pos <= 3) o.top3++; if (pos <= 10) o.top10++; if (pos > 10 && pos <= 20) o.p11++; };
    const keyOf = (q, mode, top) => {
      if (mode === 'cluster') { const c = clusterOf(q); return [c, c]; }
      const p = top.get(q); const id = p ? typeOf(p) : 'unmapped'; return [id, id === 'unmapped' ? 'Not in query × page rows' : typeOf.label(id)];
    };
    const run = (mode) => {
      out.clear();
      (A.Q || []).forEach(r => { if (!r.impr) return; const [k, nm] = keyOf(r.q, mode, topPage); put(row(k, nm)[isBrand(r.q) ? 'b' : 'n'], +r.pos || 999); });
      (D.prevQ || []).forEach(r => { if (!r.impr) return; const [k, nm] = keyOf(r.q, mode, prevTop); put(row(k, nm)[isBrand(r.q) ? 'pb' : 'pn'], +r.pos || 999); });
      return [...out.values()];
    };
    const byType = run('type');
    const byCluster = run('cluster').sort((a, b) => (b.n.top10 + b.b.top10) - (a.n.top10 + a.b.top10));
    const order = id => CORE.includes(id) ? CORE.indexOf(id) : id === 'unmapped' ? 999 : 10 + typeOf.types.findIndex(t => t.id === id);
    byType.sort((a, b) => order(a.key) - order(b.key));
    const total = { b: z(), n: z(), pb: z(), pn: z() };
    byType.forEach(r => ['b', 'n', 'pb', 'pn'].forEach(k => ['top3', 'top10', 'p11', 'total'].forEach(m => { total[k][m] += r[k][m]; })));
    return { byType, byCluster, total, hasQP: !!(D.QP && D.QP.length), hasPrev: !!(D.prevQ && D.prevQ.length) };
  }
  function qpTop(QP) {
    const m = new Map();
    (QP || []).forEach(r => { const o = m.get(r.q); if (!o || r.impr > o.impr) m.set(r.q, { p: r.p, impr: r.impr }); });
    const out = new Map(); m.forEach((v, k) => out.set(k, v.p)); return out;
  }
  // Quick-win candidates: non-branded queries in positions 11–20 with their page type.
  function strikingDistance(A, D, typeOf, isBrand, clusterOf) {
    const top = qpTop(D.QP);
    return (A.Q || []).filter(r => !isBrand(r.q) && r.pos > 10 && r.pos <= 20 && r.impr > 0).map(r => {
      const p = top.get(r.q) || null;
      return { q: r.q, p, path: p ? pathOnly(p) : '', type: p ? typeOf.label(typeOf(p)) : '—', cluster: clusterOf(r.q), clicks: r.clicks, impr: r.impr, ctr: r.ctr, pos: r.pos };
    }).sort((a, b) => b.impr - a.impr);
  }
  // Query clusters with branded / non-branded totals.
  function clusters(A, D, isBrand, clusterOf) {
    const m = new Map(), pm = new Map();
    const g = (mp, k) => { if (!mp.has(k)) mp.set(k, { b: blank(), n: blank() }); return mp.get(k); };
    (A.Q || []).forEach(r => add(g(m, clusterOf(r.q))[isBrand(r.q) ? 'b' : 'n'], r));
    (D.prevQ || []).forEach(r => add(g(pm, clusterOf(r.q))[isBrand(r.q) ? 'b' : 'n'], r));
    return [...m.entries()].map(([name, o]) => {
      const n = fin(o.n), b = fin(o.b), p = pm.get(name);
      return { name, nb: n, br: b, clicks: n.clicks + b.clicks, impr: n.impr + b.impr, queries: n.n + b.n, prevNb: p ? fin(p.n) : null, dNb: p ? chg(n.clicks, fin(p.n).clicks) : null };
    }).sort((a, b) => b.clicks - a.clicks);
  }
  // Sum daily rows into Monday-start weeks; partial weeks at either end are flagged.
  function weekly(rows) {
    const m = new Map();
    (rows || []).forEach(r => {
      const d = new Date(r.d + 'T00:00:00Z'); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd);
      const k = d.toISOString().slice(0, 10); const o = m.get(k) || { w: k, clicks: 0, impr: 0, posW: 0, days: 0 };
      o.clicks += +r.clicks || 0; o.impr += +r.impr || 0; o.posW += (+r.pos || 0) * (+r.impr || 0); o.days++; m.set(k, o);
    });
    return [...m.values()].sort((a, b) => a.w.localeCompare(b.w)).map(o => ({ w: o.w, clicks: o.clicks, impr: o.impr, ctr: o.impr ? o.clicks / o.impr * 100 : 0, pos: o.impr ? o.posW / o.impr : 0, partial: o.days < 7 }));
  }
  // Sitemaps (Search Console API): submitted URLs per sitemap, mapped to a page type by its address.
  // The API no longer reports indexed counts, so indexation is shown as pages with impressions ÷ submitted.
  function sitemapTypes(sitemaps, typeOf) {
    const words = typeOf.types.map(t => ({ id: t.id, w: (t.rules || []).map(r => String(r).replace(/^=|\*$/g, '').replace(/^\//, '').split('/')[0].toLowerCase()).filter(Boolean) }));
    const sing = w => w.replace(/(ies)$/, 'y').replace(/s$/, '');
    return (sitemaps || []).map(s => {
      const path = String(s.path || '').toLowerCase();
      const fname = path.replace(/^[a-z]+:\/\/[^/]+/, '');
      const toks = fname.split(/[-_./0-9]+/).filter(t => t && !['sitemap', 'sitemaps', 'xml', 'gz', 'index', 'www'].includes(t)).map(sing);
      let id = null;
      for (const t of words) if (t.w.some(w => toks.includes(sing(w)) || (w.length > 3 && toks.some(x => x.length > 3 && (x.startsWith(sing(w)) || sing(w).startsWith(x)))))) { id = t.id; break; }
      const submitted = (s.contents || []).reduce((a, c) => a + (+c.submitted || 0), 0);
      return { path: s.path, type: id, typeName: id ? typeOf.label(id) : 'Not matched', submitted, lastDownloaded: s.lastDownloaded || null, lastSubmitted: s.lastSubmitted || null, errors: +s.errors || 0, warnings: +s.warnings || 0, isIndex: !!s.isSitemapsIndex, pending: !!s.isPending };
    });
  }

  // ── GA4 ──
  const GA = {
    organicFilter: { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { matchType: 'EXACT', value: 'Organic Search' } } },
    and(...f) { const list = f.filter(Boolean); return list.length === 1 ? list[0] : { andGroup: { expressions: list } }; },
    inList(field, values) { return { filter: { fieldName: field, inListFilter: { values: values.slice(0, 100), caseSensitive: false } } }; },
    regex(field, rx) { return { filter: { fieldName: field, stringFilter: { matchType: 'PARTIAL_REGEXP', value: rx, caseSensitive: false } } }; },
    contains(field, v) { return { filter: { fieldName: field, stringFilter: { matchType: 'CONTAINS', value: v, caseSensitive: false } } }; }
  };
  // The report requests the GA4 screen sends (Analytics Data API v1beta runReport bodies).
  function ga4Requests(o) {
    const cur = { startDate: o.start, endDate: o.end, name: 'cur' }, yoy = { startDate: shiftYear(o.start), endDate: shiftYear(o.end), name: 'yoy' };
    const both = [cur, yoy];
    const org = GA.organicFilter;
    const aiRx = (o.aiSources || []).map(esc).join('|') || 'chatgpt';
    const pricing = (o.pricingPaths || []).map(esc).join('|') || 'pricing';
    const R = {
      landing: { dateRanges: both, dimensions: [{ name: 'landingPage' }], metrics: ['sessions', 'newUsers', 'engagedSessions', 'screenPageViews', 'userEngagementDuration', 'keyEvents'].map(name => ({ name })), dimensionFilter: org, limit: 100000 },
      device: { dateRanges: both, dimensions: [{ name: 'deviceCategory' }], metrics: [{ name: 'sessions' }, { name: 'newUsers' }, { name: 'engagedSessions' }], dimensionFilter: org, limit: 50 },
      country: { dateRanges: both, dimensions: [{ name: 'country' }], metrics: [{ name: 'sessions' }, { name: 'newUsers' }], dimensionFilter: org, limit: 300 },
      region: { dateRanges: both, dimensions: [{ name: 'region' }], metrics: [{ name: 'sessions' }, { name: 'newUsers' }], dimensionFilter: GA.and(org, { filter: { fieldName: 'country', stringFilter: { matchType: 'EXACT', value: 'India' } } }), limit: 120 },
      // page type × device and page type × state, so device and geography are never only sitewide
      landingDevice: { dateRanges: both, dimensions: [{ name: 'landingPage' }, { name: 'deviceCategory' }], metrics: [{ name: 'sessions' }, { name: 'newUsers' }], dimensionFilter: org, limit: 250000 },
      landingRegion: { dateRanges: both, dimensions: [{ name: 'landingPage' }, { name: 'region' }], metrics: [{ name: 'sessions' }, { name: 'newUsers' }], dimensionFilter: GA.and(org, { filter: { fieldName: 'country', stringFilter: { matchType: 'EXACT', value: 'India' } } }), limit: 250000 },
      daily: { dateRanges: both, dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }, { name: 'newUsers' }], dimensionFilter: org, limit: 1000 },
      events: { dateRanges: [cur], dimensions: [{ name: 'landingPage' }, { name: 'eventName' }], metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }], dimensionFilter: org, limit: 250000 },
      eventsYoy: { dateRanges: [yoy], dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }], dimensionFilter: org, limit: 2000 },
      returning: { dateRanges: both, dimensions: [{ name: 'newVsReturning' }], metrics: [{ name: 'activeUsers' }, { name: 'sessions' }], dimensionFilter: org, limit: 10 },
      pricing: { dateRanges: both, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }, { name: 'activeUsers' }], dimensionFilter: GA.and(org, GA.regex('pagePath', pricing)), limit: 200 },
      channels: { dateRanges: [cur], dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: ['sessions', 'newUsers', 'engagedSessions', 'keyEvents'].map(name => ({ name })), limit: 50 },
      channelEvents: { dateRanges: [cur], dimensions: [{ name: 'sessionDefaultChannelGroup' }, { name: 'eventName' }], metrics: [{ name: 'eventCount' }], limit: 5000 },
      ai: { dateRanges: both, dimensions: [{ name: 'sessionSource' }, { name: 'landingPage' }], metrics: ['sessions', 'engagedSessions', 'keyEvents', 'newUsers'].map(name => ({ name })), dimensionFilter: GA.regex('sessionSource', aiRx), limit: 10000 }
    };
    return R;
  }
  function shiftYear(d) { const x = new Date(d + 'T00:00:00Z'); x.setUTCFullYear(x.getUTCFullYear() - 1); return x.toISOString().slice(0, 10); }
  // Turn a runReport response into plain objects: { dims..., metrics..., range: 'cur'|'yoy' }.
  function gaRows(res) {
    if (!res || !res.rows) return [];
    const dh = (res.dimensionHeaders || []).map(h => h.name), mh = (res.metricHeaders || []).map(h => h.name);
    return res.rows.map(r => {
      const o = {};
      (r.dimensionValues || []).forEach((v, i) => { o[dh[i]] = v.value; });
      (r.metricValues || []).forEach((v, i) => { o[mh[i]] = +v.value || 0; });
      if (o.dateRange != null) { o.range = o.dateRange; delete o.dateRange; } else o.range = 'cur';
      return o;
    });
  }
  const sum = (rows, k) => rows.reduce((a, r) => a + (+r[k] || 0), 0);
  const inSet = (list) => { const s = new Set((list || []).map(x => String(x).trim().toLowerCase()).filter(Boolean)); return n => s.has(String(n || '').toLowerCase()); };

  // Organic funnel from GA4 rows: totals, YoY, by page type, device, geography, events, AI referrals.
  function ga4Model(raw, typeOf, ev, opt = {}) {
    const R = {}; Object.keys(raw || {}).forEach(k => { R[k] = gaRows(raw[k]); });
    const L = R.landing || [], cur = L.filter(r => r.range === 'cur'), yoy = L.filter(r => r.range === 'yoy');
    const tot = rows => ({ sessions: sum(rows, 'sessions'), newUsers: sum(rows, 'newUsers'), engaged: sum(rows, 'engagedSessions'), views: sum(rows, 'screenPageViews'), dur: sum(rows, 'userEngagementDuration'), keyEvents: sum(rows, 'keyEvents') });
    const T = tot(cur), TY = yoy.length ? tot(yoy) : null;
    const is = {}; Object.keys(ev || {}).forEach(k => { is[k] = inSet(ev[k]); });
    // events by landing page
    const E = R.events || [];
    const byLanding = new Map();
    const lp = p => { const k = pathOnly(p); if (!byLanding.has(k)) byLanding.set(k, { path: k, type: typeOf(k), sessions: 0, newUsers: 0, engaged: 0, views: 0, ySessions: 0, yNewUsers: 0, keyEvents: 0, stu: 0, emp: 0, demo: 0, contact: 0, opp: 0, prodClick: 0, scroll: 0 }); return byLanding.get(k); };
    cur.forEach(r => { const o = lp(r.landingPage); o.sessions += r.sessions; o.newUsers += r.newUsers; o.engaged += r.engagedSessions; o.views += r.screenPageViews; o.keyEvents += r.keyEvents || 0; });
    yoy.forEach(r => { const o = lp(r.landingPage); o.ySessions += r.sessions; o.yNewUsers += r.newUsers; });
    const evTot = new Map();
    E.forEach(r => {
      const o = lp(r.landingPage), n = r.eventName, c = r.eventCount;
      const t = evTot.get(n) || { name: n, count: 0, users: 0, landings: 0 }; t.count += c; t.users += r.totalUsers; t.landings++; evTot.set(n, t);
      if (is.studentSignup && is.studentSignup(n)) o.stu += c;
      if (is.employerSignup && is.employerSignup(n)) o.emp += c;
      if (is.demoRequest && is.demoRequest(n)) o.demo += c;
      if (is.contactSubmit && is.contactSubmit(n)) o.contact += c;
      if (is.opportunityAction && is.opportunityAction(n)) o.opp += c;
      if (is.productClick && is.productClick(n)) o.prodClick += c;
      if (is.scroll && is.scroll(n)) o.scroll += c;
    });
    const pages = [...byLanding.values()].map(o => ({ ...o, typeName: typeOf.label(o.type), signups: o.stu + o.emp, cvr: o.sessions ? (o.stu + o.emp) / o.sessions * 100 : null, engRate: o.sessions ? o.engaged / o.sessions * 100 : null, dSessions: chg(o.sessions, o.ySessions), leads: o.demo + o.contact }));
    // by page type
    const tm = new Map();
    pages.forEach(p => {
      const o = tm.get(p.type) || { id: p.type, name: p.typeName, landings: 0, sessions: 0, ySessions: 0, newUsers: 0, yNewUsers: 0, engaged: 0, views: 0, stu: 0, emp: 0, demo: 0, contact: 0, opp: 0, prodClick: 0, scroll: 0 };
      o.landings += p.sessions > 0 ? 1 : 0; ['sessions', 'ySessions', 'newUsers', 'yNewUsers', 'engaged', 'views', 'stu', 'emp', 'demo', 'contact', 'opp', 'prodClick', 'scroll'].forEach(k => { o[k] += p[k]; });
      tm.set(p.type, o);
    });
    const types = [...tm.values()].map(o => ({ ...o, signups: o.stu + o.emp, cvr: o.sessions ? (o.stu + o.emp) / o.sessions * 100 : null, engRate: o.sessions ? o.engaged / o.sessions * 100 : null, pps: o.sessions ? o.views / o.sessions : null, dSessions: chg(o.sessions, o.ySessions), dNewUsers: chg(o.newUsers, o.yNewUsers), oppRate: o.sessions ? o.opp / o.sessions * 100 : null, prodRate: o.sessions ? o.prodClick / o.sessions * 100 : null, scrollRate: o.views ? o.scroll / o.views * 100 : null }));
    const order = id => CORE.includes(id) ? CORE.indexOf(id) : 10 + typeOf.types.findIndex(t => t.id === id);
    types.sort((a, b) => order(a.id) - order(b.id));
    const evSum = k => pages.reduce((a, p) => a + p[k], 0);
    // YoY event totals for the same event lists
    const EY = R.eventsYoy || [];
    const yEv = k => is[k] ? EY.filter(r => is[k](r.eventName)).reduce((a, r) => a + r.eventCount, 0) : 0;
    const split = (rows, dim) => {
      const m = new Map();
      rows.forEach(r => { const k = r[dim] || '(not set)'; const o = m.get(k) || { key: k, sessions: 0, newUsers: 0, engaged: 0, ySessions: 0, yNewUsers: 0 }; if (r.range === 'yoy') { o.ySessions += r.sessions; o.yNewUsers += r.newUsers; } else { o.sessions += r.sessions; o.newUsers += r.newUsers; o.engaged += r.engagedSessions || 0; } m.set(k, o); });
      return [...m.values()].map(o => ({ ...o, dSessions: chg(o.sessions, o.ySessions), share: T.sessions ? o.sessions / T.sessions * 100 : 0 })).sort((a, b) => b.sessions - a.sessions);
    };
    const device = split(R.device || [], 'deviceCategory');
    const country = split(R.country || [], 'country');
    const region = split(R.region || [], 'region');
    // page type × another dimension, with last year
    const cross = (rows, dim) => {
      const m = new Map();
      rows.forEach(r => { const t = typeOf(r.landingPage), k = t + '|' + (r[dim] || '(not set)'); const o = m.get(k) || { type: t, typeName: typeOf.label(t), key: r[dim] || '(not set)', sessions: 0, ySessions: 0, newUsers: 0, yNewUsers: 0 }; if (r.range === 'yoy') { o.ySessions += r.sessions; o.yNewUsers += r.newUsers; } else { o.sessions += r.sessions; o.newUsers += r.newUsers; } m.set(k, o); });
      return [...m.values()].map(o => ({ ...o, dSessions: chg(o.sessions, o.ySessions), dNewUsers: chg(o.newUsers, o.yNewUsers) }));
    };
    const typeDevice = cross(R.landingDevice || [], 'deviceCategory'), typeRegion = cross(R.landingRegion || [], 'region');
    // URL clusters and the share of organic sessions landing on clusters with a clear conversion path
    let sections = null, pathCov = null;
    if (opt.sectionOf) {
      const so = opt.sectionOf, paths = new Set(opt.pathSections || []), sm = new Map();
      pages.forEach(p => { const id = so(p.path); const o = sm.get(id) || { id, name: so.label(id), type: so.typeOf(id), typeName: so.typeOf(id) === 'other' ? 'Other' : typeOf.label(so.typeOf(id)), path: paths.has(id), landings: 0, sessions: 0, ySessions: 0, newUsers: 0, yNewUsers: 0, engaged: 0, stu: 0, emp: 0, opp: 0, demo: 0, contact: 0, prodClick: 0 }; o.landings += p.sessions > 0 ? 1 : 0; ['sessions', 'ySessions', 'newUsers', 'yNewUsers', 'engaged', 'stu', 'emp', 'opp', 'demo', 'contact', 'prodClick'].forEach(k => { o[k] += p[k]; }); sm.set(id, o); });
      sections = [...sm.values()].map(o => ({ ...o, signups: o.stu + o.emp, cvr: o.sessions ? (o.stu + o.emp) / o.sessions * 100 : null, engRate: o.sessions ? o.engaged / o.sessions * 100 : null, dSessions: chg(o.sessions, o.ySessions), dNewUsers: chg(o.newUsers, o.yNewUsers), share: T.sessions ? o.sessions / T.sessions * 100 : 0 })).sort((a, b) => b.sessions - a.sessions);
      const on = sections.filter(x => x.path), cs = sum(on, 'sessions'), ys = sum(on, 'ySessions'), yt = sum(sections, 'ySessions');
      pathCov = { share: T.sessions ? cs / T.sessions * 100 : null, sessions: cs, yShare: yt ? ys / yt * 100 : null, sections: on.length };
    }
    // daily trend with last year aligned by day index
    const D = R.daily || [];
    const dc = D.filter(r => r.range === 'cur').sort((a, b) => a.date.localeCompare(b.date)), dy = D.filter(r => r.range === 'yoy').sort((a, b) => a.date.localeCompare(b.date));
    const daily = dc.map((r, i) => ({ d: r.date.slice(0, 4) + '-' + r.date.slice(4, 6) + '-' + r.date.slice(6), sessions: r.sessions, newUsers: r.newUsers, ySessions: dy[i] ? dy[i].sessions : null }));
    // returning visitors
    const RT = R.returning || [];
    const ret = rg => { const rows = RT.filter(r => r.range === rg); const t = sum(rows, 'activeUsers'), rv = sum(rows.filter(r => r.newVsReturning === 'returning'), 'activeUsers'); return t ? { users: t, returning: rv, share: rv / t * 100 } : null; };
    // pricing page
    const PR = R.pricing || [];
    const pricing = { sessions: sum(PR.filter(r => r.range === 'cur'), 'sessions'), ySessions: sum(PR.filter(r => r.range === 'yoy'), 'sessions'), pages: PR.filter(r => r.range === 'cur').map(r => ({ path: r.pagePath, sessions: r.sessions, views: r.screenPageViews })).sort((a, b) => b.sessions - a.sessions) };
    // channels: organic vs others, signups per channel from event rows
    const CH = R.channels || [], CE = R.channelEvents || [];
    const channels = CH.map(r => {
      const evs = CE.filter(e => e.sessionDefaultChannelGroup === r.sessionDefaultChannelGroup);
      const cnt = k => is[k] ? evs.filter(e => is[k](e.eventName)).reduce((a, e) => a + e.eventCount, 0) : 0;
      const signups = cnt('studentSignup') + cnt('employerSignup');
      return { channel: r.sessionDefaultChannelGroup, sessions: r.sessions, newUsers: r.newUsers, engRate: r.sessions ? r.engagedSessions / r.sessions * 100 : null, keyEvents: r.keyEvents, stu: cnt('studentSignup'), emp: cnt('employerSignup'), leads: cnt('demoRequest') + cnt('contactSubmit'), signups, cvr: r.sessions ? signups / r.sessions * 100 : null };
    }).sort((a, b) => b.sessions - a.sessions);
    // AI referrals
    const AI = R.ai || [];
    const aiBy = new Map();
    AI.forEach(r => { const k = aiName(r.sessionSource); const o = aiBy.get(k) || { source: k, raw: new Set(), sessions: 0, ySessions: 0, engaged: 0, keyEvents: 0, newUsers: 0 }; o.raw.add(r.sessionSource); if (r.range === 'yoy') o.ySessions += r.sessions; else { o.sessions += r.sessions; o.engaged += r.engagedSessions; o.keyEvents += r.keyEvents; o.newUsers += r.newUsers; } aiBy.set(k, o); });
    const ai = [...aiBy.values()].map(o => ({ ...o, raw: [...o.raw].join(', '), dSessions: chg(o.sessions, o.ySessions), engRate: o.sessions ? o.engaged / o.sessions * 100 : null })).sort((a, b) => b.sessions - a.sessions);
    const aiPages = [];
    const apm = new Map();
    AI.filter(r => r.range !== 'yoy').forEach(r => { const k = pathOnly(r.landingPage); const o = apm.get(k) || { path: k, type: typeOf.label(typeOf(k)), sessions: 0, keyEvents: 0 }; o.sessions += r.sessions; o.keyEvents += r.keyEvents; apm.set(k, o); });
    apm.forEach(v => aiPages.push(v)); aiPages.sort((a, b) => b.sessions - a.sessions);
    return {
      ok: cur.length > 0 || E.length > 0,
      total: { ...T, engRate: T.sessions ? T.engaged / T.sessions * 100 : null, pps: T.sessions ? T.views / T.sessions : null, avgEngSec: T.sessions ? T.dur / T.sessions : null },
      yoy: TY, dSessions: TY ? chg(T.sessions, TY.sessions) : null, dNewUsers: TY ? chg(T.newUsers, TY.newUsers) : null,
      pages, types, device, country, region, typeDevice, typeRegion, sections, pathCov, daily, ai, aiPages,
      events: [...evTot.values()].sort((a, b) => b.count - a.count),
      ev: { stu: evSum('stu'), emp: evSum('emp'), demo: evSum('demo'), contact: evSum('contact'), opp: evSum('opp'), prodClick: evSum('prodClick'), scroll: evSum('scroll'), yStu: yEv('studentSignup'), yEmp: yEv('employerSignup'), yDemo: yEv('demoRequest'), yContact: yEv('contactSubmit'), yOpp: yEv('opportunityAction') },
      returning: { cur: ret('cur'), yoy: ret('yoy') }, pricing, channels
    };
  }
  function aiName(src) {
    const s = String(src || '').toLowerCase();
    if (/chatgpt|openai/.test(s)) return 'ChatGPT';
    if (/perplexity/.test(s)) return 'Perplexity';
    if (/gemini|bard/.test(s)) return 'Gemini';
    if (/copilot|bing\.com\/chat/.test(s)) return 'Copilot';
    if (/claude/.test(s)) return 'Claude';
    if (/deepseek/.test(s)) return 'DeepSeek';
    if (/grok/.test(s)) return 'Grok';
    if (/meta\.ai/.test(s)) return 'Meta AI';
    return src || '(not set)';
  }

  // Joins GSC page rows with GA4 landing pages by path, so every page type shows the chain in one row.
  function joinChain(vis, ga, typeOf) {
    const m = new Map();
    (vis ? vis.rows : []).forEach(r => m.set(r.id, { id: r.id, name: r.name, gsc: r }));
    (ga ? ga.types : []).forEach(t => { const o = m.get(t.id) || { id: t.id, name: t.name }; o.ga = t; m.set(t.id, o); });
    const order = id => CORE.includes(id) ? CORE.indexOf(id) : 10 + typeOf.types.findIndex(t => t.id === id);
    return [...m.values()].sort((a, b) => order(a.id) - order(b.id));
  }
  // First-review question 1: landing pages ranked by organic signups.
  function topSignupPages(ga, n = 20) { return ga ? ga.pages.filter(p => p.signups > 0).sort((a, b) => b.signups - a.signups).slice(0, n) : []; }
  // First-review question 2 (estimate): each landing page's signups split by the non-branded share of its
  // Search Console clicks. GSC never ties a query to a signup, so this is a proxy and labelled as one.
  function nonBrandedSignupShare(ga, D, isBrand) {
    if (!ga || !D || !D.QP || !D.QP.length) return null;
    const share = new Map();
    D.QP.forEach(r => { const k = pathOnly(r.p).toLowerCase(); const o = share.get(k) || { b: 0, all: 0 }; o.all += +r.clicks || 0; if (isBrand(r.q)) o.b += +r.clicks || 0; share.set(k, o); });
    let total = 0, nb = 0, matched = 0, unmatched = 0;
    ga.pages.forEach(p => {
      if (!p.signups) return; total += p.signups;
      const s = share.get(p.path.toLowerCase());
      if (s && s.all > 0) { nb += p.signups * (1 - s.b / s.all); matched += p.signups; } else unmatched += p.signups;
    });
    return total ? { total, nb, matched, unmatched, share: matched ? nb / matched * 100 : null, coverage: matched / total * 100 } : null;
  }

  // ── MoEngage signup quality ──
  // Reads a MoEngage user export (CSV/XLSX rows as arrays) with flexible headers.
  const MOE_FIELDS = {
    id: ['id', 'user id', 'user_id', 'uid', 'moengage id', 'customer id', 'unique id'],
    signup: ['signup date', 'sign up date', 'signed up', 'signup_date', 'created at', 'created_at', 'first seen', 'first_seen', 'registration date', 'user creation time', 'install date', 'created date'],
    source: ['first touch source', 'acquisition source', 'utm source', 'utm_source', 'source', 'install source', 'signup source', 'first source', 'channel', 'acquisition channel', 'first touch channel'],
    medium: ['utm medium', 'utm_medium', 'medium', 'acquisition medium', 'first touch medium'],
    landing: ['landing page', 'landing_page', 'first landing page', 'signup page', 'signup url'],
    type: ['user type', 'user_type', 'type', 'role', 'persona', 'account type', 'segment'],
    profile: ['profile completion', 'profile_completion', 'profile completion %', 'profile complete', 'profile_complete', 'profile score', 'profile strength'],
    firstAction: ['first registration date', 'first application date', 'first apply date', 'first registration', 'first_registration_date', 'first opportunity registration', 'first action date', 'first activity date'],
    actions7: ['registrations in 7 days', 'applications in 7 days', 'actions 7d', 'activated 7d', 'activated_7d', '7 day activation'],
    lastSeen: ['last seen', 'last_seen', 'last active', 'last_active', 'last activity', 'last session', 'last visit'],
    retained30: ['retained 30d', 'retained_30d', '30 day retained', 'active day 30', 'retained']
  };
  function moeHeaderMap(header) {
    const h = header.map(x => String(x || '').trim().toLowerCase().replace(/\s+/g, ' '));
    const map = {};
    Object.entries(MOE_FIELDS).forEach(([k, names]) => {
      let i = h.findIndex(x => names.includes(x));
      if (i < 0) i = h.findIndex(x => names.some(n => n.length > 4 && x.includes(n)));
      if (i >= 0 && !Object.values(map).includes(i)) map[k] = i;
    });
    return map;
  }
  function toDate(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5));
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])); // dd/mm/yyyy (India)
    const d = new Date(s); return isNaN(d) ? null : d;
  }
  const truthy = v => { const s = String(v == null ? '' : v).trim().toLowerCase(); return ['true', 'yes', 'y', '1', 'complete', 'completed'].includes(s); };
  function organicTest(o) {
    const src = (o && o.organicSources) || ['google', 'bing', 'yahoo', 'duckduckgo', 'ecosia', 'yandex', 'baidu', 'organic', 'seo'];
    const paid = /\b(cpc|ppc|paid|ads?|display|cpm|retarget|sem)\b/i;
    const rx = new RegExp('\\b(' + src.map(esc).join('|') + ')\\b', 'i');
    return (source, medium) => {
      const s = String(source || ''), m = String(medium || '');
      if (/organic/i.test(m) || /organic search/i.test(s)) return true;
      if (paid.test(m) || paid.test(s)) return false;
      return rx.test(s) && (!m || /organic|referral|\(none\)|none/i.test(m));
    };
  }
  function userKind(v) { const s = String(v || '').toLowerCase(); return /employer|recruit|hr|company|organi[sz]er|corporate|client/.test(s) ? 'employer' : 'student'; }
  // Returns cohorts by channel (organic vs other) and user kind, with profile completion, 7-day activation
  // and 30-day retention. Users who signed up less than 7 / 30 days before the export are left out of
  // those rates (not yet measurable).
  function moeQuality(rows, opt = {}) {
    if (!rows || rows.length < 2) return { ok: false, error: 'The file has no rows.' };
    const header = rows[0], map = { ...moeHeaderMap(header), ...(opt.map || {}) };
    if (map.signup == null) return { ok: false, error: 'No signup date column found. Expected a column such as “Signup date”, “Created at” or “First seen”.', header, map };
    const isOrg = organicTest(opt);
    const asOf = opt.asOf ? new Date(opt.asOf + 'T00:00:00Z') : null;
    const users = [];
    let latest = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; if (!r || !r.length) continue;
      const sd = toDate(r[map.signup]); if (!sd) continue;
      const src = map.source != null ? r[map.source] : '', med = map.medium != null ? r[map.medium] : '';
      const pv = map.profile != null ? r[map.profile] : null;
      let profile = null;
      if (pv != null && pv !== '') { const n = parseFloat(String(pv).replace('%', '')); profile = isFinite(n) && !/^(true|false|yes|no)$/i.test(String(pv).trim()) ? (n <= 1 && !String(pv).includes('%') ? n * 100 : n) >= (opt.profileThreshold || 80) : truthy(pv); }
      const fa = map.firstAction != null ? toDate(r[map.firstAction]) : null;
      const a7 = map.actions7 != null ? (parseFloat(r[map.actions7]) > 0 || truthy(r[map.actions7])) : null;
      const ls = map.lastSeen != null ? toDate(r[map.lastSeen]) : null;
      const r30 = map.retained30 != null ? truthy(r[map.retained30]) : null;
      if (ls && +ls > latest) latest = +ls;
      if (+sd > latest) latest = +sd;
      const landing = map.landing != null ? String(r[map.landing] || '') : '';
      users.push({ sd, organic: isOrg(src, med), src: String(src || '(not set)'), med: String(med || ''), kind: map.type != null ? userKind(r[map.type]) : 'student', profile, fa, a7, ls, r30, landing });
    }
    if (!users.length) return { ok: false, error: 'No rows had a readable signup date.', header, map };
    const ref = asOf || new Date(latest);
    const day = 864e5;
    const rate = (list, test, eligible) => { const e = list.filter(eligible); const known = e.map(test).filter(v => v != null); return known.length ? { n: known.length, rate: known.filter(Boolean).length / known.length * 100 } : null; };
    const metrics = list => ({
      users: list.length,
      profile: rate(list, u => u.profile, () => true),
      act7: rate(list, u => u.a7 != null ? u.a7 : u.fa ? (u.fa - u.sd) <= 7 * day : (map.firstAction != null ? false : null), u => ref - u.sd >= 7 * day),
      ret30: rate(list, u => u.r30 != null ? u.r30 : u.ls ? (u.ls - u.sd) >= 30 * day : null, u => ref - u.sd >= 30 * day)
    });
    const seg = (f) => metrics(users.filter(f));
    const months = new Map();
    users.forEach(u => { const k = u.sd.toISOString().slice(0, 7); if (!months.has(k)) months.set(k, []); months.get(k).push(u); });
    const cohorts = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([m, list]) => ({ month: m, organic: metrics(list.filter(u => u.organic)), other: metrics(list.filter(u => !u.organic)) }));
    const srcMap = new Map(); users.forEach(u => { const k = u.src.toLowerCase() + '|' + u.med.toLowerCase(); const o = srcMap.get(k) || { source: u.src, medium: u.med || '(not set)', users: 0, organic: u.organic }; o.users++; srcMap.set(k, o); });
    return {
      ok: true, map, header, asOf: ref.toISOString().slice(0, 10), total: users.length,
      start: new Date(Math.min(...users.map(u => +u.sd))).toISOString().slice(0, 10), end: new Date(Math.max(...users.map(u => +u.sd))).toISOString().slice(0, 10),
      seg: {
        organic: seg(u => u.organic), other: seg(u => !u.organic),
        orgStudent: seg(u => u.organic && u.kind === 'student'), orgEmployer: seg(u => u.organic && u.kind === 'employer'),
        othStudent: seg(u => !u.organic && u.kind === 'student'), othEmployer: seg(u => !u.organic && u.kind === 'employer')
      },
      cohorts, sources: [...srcMap.values()].sort((a, b) => b.users - a.users),
      has: { source: map.source != null || map.medium != null, type: map.type != null, profile: map.profile != null, act: map.firstAction != null || map.actions7 != null, ret: map.lastSeen != null || map.retained30 != null }
    };
  }

  // ── metric registry for the funnel dashboard (owner, source, definition, cadence) ──
  const METRICS = [
    { stage: 'Visibility', id: 'impr', label: 'Impressions', src: 'GSC', owner: 'SEO', cadence: 'Weekly', def: 'Times a unstop.com URL appeared in Google results (web search), whole property.' },
    { stage: 'Visibility', id: 'clicks', label: 'Clicks', src: 'GSC', owner: 'SEO', cadence: 'Weekly', def: 'Clicks from Google web search to unstop.com.' },
    { stage: 'Visibility', id: 'ctr', label: 'CTR', src: 'GSC', owner: 'SEO', cadence: 'Weekly', def: 'Clicks ÷ impressions.' },
    { stage: 'Visibility', id: 'pos', label: 'Average position', src: 'GSC', owner: 'SEO', cadence: 'Weekly', def: 'Impression-weighted average position.' },
    { stage: 'Visibility', id: 'nbClicks', label: 'Non-branded clicks', src: 'GSC', owner: 'SEO', cadence: 'Weekly', def: 'Clicks on queries not matching the brand terms (queries Google anonymises are excluded).' },
    { stage: 'Visibility', id: 'top10', label: 'Non-branded keywords in top 10', src: 'GSC', owner: 'SEO', cadence: 'Weekly', def: 'Non-branded queries with average position ≤ 10 (also top 3 and 11–20 on the Visibility screen).' },
    { stage: 'Visibility', id: 'p11', label: 'Keywords in positions 11–20', src: 'GSC', owner: 'SEO', cadence: 'Weekly', def: 'Non-branded quick-win candidates.' },
    { stage: 'Visibility', id: 'indexed', label: 'Pages getting impressions', src: 'GSC', owner: 'Technical SEO + Engineering', cadence: 'Weekly', def: 'URLs with at least one impression in the period (proxy for indexed and visible pages).' },
    { stage: 'Traffic', id: 'sessions', label: 'Organic sessions', src: 'GA4', owner: 'SEO + Analytics', cadence: 'Monthly', def: 'GA4 sessions with Default channel group = Organic Search.' },
    { stage: 'Traffic', id: 'newUsers', label: 'Organic new users', src: 'GA4', owner: 'SEO + Analytics', cadence: 'Monthly', def: 'First-time users whose session channel is Organic Search.' },
    { stage: 'Traffic', id: 'pathCov', label: 'Sessions on pages with a conversion path', src: 'GA4', owner: 'SEO + CRO/Product', cadence: 'Monthly', def: 'Share of organic landing sessions on URL clusters marked as having a clear conversion path (register, apply, post a job, book a demo); set in Funnel setup.' },
    { stage: 'Signups', id: 'stu', label: 'Organic student signups', src: 'GA4', owner: 'SEO + Product Analytics', cadence: 'Monthly', def: 'Student signup events (Funnel setup) in organic sessions.' },
    { stage: 'Signups', id: 'emp', label: 'Organic employer signups', src: 'GA4', owner: 'SEO + Product Analytics', cadence: 'Monthly', def: 'Employer / recruiter signup events in organic sessions.' },
    { stage: 'Signups', id: 'cvr', label: 'Signup conversion rate', src: 'GA4', owner: 'SEO + Product Analytics', cadence: 'Monthly', def: 'Organic signups ÷ organic sessions.' },
    { stage: 'Signups', id: 'cps', label: 'Cost per organic signup', src: 'Cost input', owner: 'SEO Lead + Finance', cadence: 'Monthly', def: 'Monthly SEO cost (Funnel setup) ÷ organic signups for a 30-day period.' },
    { stage: 'Signups', id: 'moeSignups', label: 'Organic signups (MoEngage)', src: 'MoEngage', owner: 'Product Analytics + SEO', cadence: 'Monthly', def: 'Signups attributed to organic search in MoEngage (live dashboard chart mapped on Signup quality). A second view of signups that does not depend on GA4 events.' },
    { stage: 'Signups', id: 'profile', label: 'Profile completion (organic)', src: 'MoEngage', owner: 'Product Analytics + SEO', cadence: 'Monthly cohort', def: 'Organic signups whose profile completion is at or above the threshold.' },
    { stage: 'Signups', id: 'act7', label: '7-day activation (organic)', src: 'MoEngage', owner: 'Product Analytics + SEO', cadence: 'Monthly cohort', def: 'First registration or application within 7 days of signup.' },
    { stage: 'Signups', id: 'ret30', label: '30-day retention (organic)', src: 'MoEngage', owner: 'Product Analytics + SEO', cadence: 'Monthly cohort', def: 'Seen again 30 or more days after signup.' },
    { stage: 'Engagement', id: 'engRate', label: 'Engagement rate', src: 'GA4', owner: 'SEO + Analytics', cadence: 'Monthly', def: 'Engaged organic sessions ÷ organic sessions.' },
    { stage: 'Engagement', id: 'pps', label: 'Pages per session', src: 'GA4', owner: 'SEO + Analytics', cadence: 'Monthly', def: 'Views ÷ organic sessions.' },
    { stage: 'Engagement', id: 'returning', label: 'Returning users share', src: 'GA4', owner: 'SEO + Analytics', cadence: 'Monthly', def: 'Organic active users who are returning (GA4 new vs returning; not a strict 30-day window).' },
    { stage: 'Engagement', id: 'opp', label: 'Register / apply actions', src: 'GA4', owner: 'SEO + Product Analytics', cadence: 'Monthly', def: 'Opportunity register / apply events in organic sessions.' },
    { stage: 'Engagement', id: 'prodClick', label: 'Blog → product clicks', src: 'GA4', owner: 'Content SEO + Analytics', cadence: 'Monthly', def: 'Product-click events in organic sessions that landed on Blog & guides.' },
    { stage: 'Leads', id: 'demo', label: 'Organic demo requests', src: 'GA4', owner: 'B2B SEO + Demand Gen + Analytics', cadence: 'Monthly', def: 'Demo-request events in organic sessions.' },
    { stage: 'Leads', id: 'contact', label: 'Organic contact submissions', src: 'GA4', owner: 'B2B SEO + Demand Gen + Analytics', cadence: 'Monthly', def: 'Contact-form events in organic sessions.' },
    { stage: 'Leads', id: 'pricing', label: 'Organic pricing-page sessions', src: 'GA4', owner: 'B2B SEO + Demand Gen', cadence: 'Monthly', def: 'Organic sessions that viewed a pricing path.' },
    { stage: 'Leads', id: 'aiSessions', label: 'AI assistant referral sessions', src: 'GA4', owner: 'SEO + Analytics', cadence: 'Monthly', def: 'Sessions referred by ChatGPT, Perplexity, Gemini, Copilot, Claude and similar.' },
    { stage: 'Pipeline & revenue', id: 'mql', label: 'MQLs, pipeline, closed revenue', src: 'CRM', owner: 'CRM Ops + Finance + Demand Gen', cadence: 'Monthly / Quarterly', def: 'Next phase: needs the CRM export joined on lead ID.', later: true }
  ];

  const api = { DEFAULT_TYPES, CORE, DEFAULT_CLUSTERS, DEFAULT_SECTIONS, DEFAULT_PATH_SECTIONS, makeSectioner, parseSections, sectionsText, sectionRegex, sectionExclude, sectionModel, sectionsFromRows, makeClassifier, makeClusterer, typeRegex, parseTypes, typesText, parseClusters, clustersText, pathOnly,
    visibility, rankBuckets, strikingDistance, clusters, weekly, sitemapTypes, ga4Requests, gaRows, ga4Model, aiName, shiftYear, joinChain, topSignupPages, nonBrandedSignupShare,
    moeHeaderMap, moeQuality, organicTest, toDate, METRICS, chg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.UN = api;
})(typeof window !== 'undefined' ? window : globalThis);
