// Tests for the Unstop funnel layer (unstop.js): page types, GSC regexes, ranking buckets, GA4 model, MoEngage.
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load(['engine.js', 'unstop.js']);
const U = W.UN, CW = W.CW;
const typeOf = U.makeClassifier();
const isB = CW.makeBrandTest(['unstop', 'dare2compete']);

test('page types: real Unstop URLs land in the right type', () => {
  const cases = {
    'https://unstop.com/': 'home', 'https://unstop.com/hackathons/crp-amazon-ml-challenge-2026-amazon-1743604': 'opp',
    'https://unstop.com/hackathons': 'opp', 'https://unstop.com/hackathons%20%20': 'opp', 'https://unstop.com/internship/data-analysis-internship': 'opp',
    'https://unstop.com/p/hul-lime-season-18-hindustan-unilever-limited-hul-1741647': 'opp', 'https://unstop.com/c/smart-hire-consultants-1019017': 'org',
    'https://unstop.com/blog/ssc-cgl-exam': 'blog', 'https://unstop.com/tcs-nqt-exam-pattern-sections-and-preparation-guide': 'blog',
    'https://unstop.com/employers/ai-sourcing-agent': 'emp', 'https://unstop.com/talent-report-2026': 'emp', 'https://unstop.com/auth/login': 'util',
    'https://unstop.com/practice/coding': 'prod', 'https://unstop.com/competitions?x=1': 'opp', 'https://unstop.com/cultural-events/x': 'opp',
    'https://unstop.com/campus-ambassador-program': 'opp', 'https://unstop.com/hackathons-guide': 'other'
  };
  Object.entries(cases).forEach(([u, t]) => assert.equal(typeOf(u), t, u));
});
test('page types: "/c" does not swallow /courses or /compete', () => {
  assert.equal(typeOf('https://unstop.com/courses/python'), 'prod');
  assert.equal(typeOf('https://unstop.com/compete'), 'opp');
});
test('GSC regex per type agrees with the classifier on real paths', () => {
  const urls = ['https://unstop.com/hackathons/x-1', 'https://unstop.com/c/abc', 'https://unstop.com/courses/a', 'https://unstop.com/blog/a', 'https://unstop.com/employers/hire-sde', 'https://unstop.com/', 'https://unstop.com/a-b-c-d-e', 'https://unstop.com/talent-report-2026'];
  U.DEFAULT_TYPES.forEach(t => {
    const rx = new RegExp(U.typeRegex(t, null));
    urls.forEach(u => assert.equal(rx.test(u), typeOf(u) === t.id, t.id + ' ' + u));
  });
});
test('parseTypes round-trips the editable text and keeps ids', () => {
  const t = U.parseTypes(U.typesText(U.DEFAULT_TYPES));
  assert.equal(JSON.stringify(t.map(x => x.id)), JSON.stringify(U.DEFAULT_TYPES.map(x => x.id)));
  const custom = U.parseTypes('Jobs: /jobs, /job\nOpportunity & competition: /hackathons');
  const f = U.makeClassifier(custom);
  assert.equal(f('https://unstop.com/jobs/a'), 'jobs');
  assert.equal(f('https://unstop.com/hackathons/a'), 'opp');
});
test('clusters: first match wins, whole words only', () => {
  const c = U.makeClusterer();
  assert.equal(c('amazon ml challenge 2026'), 'Hackathons');
  assert.equal(c('tcs nqt previous year question papers'), 'Exam & placement prep');
  assert.equal(c('best ats for startups'), 'Employer / hiring solutions');
  assert.equal(c('internshala'), 'Other');
});
test('visibility: branded share from query × page rows, totals from pages', () => {
  const A = { P: [{ p: 'https://unstop.com/hackathons/a', clicks: 100, impr: 1000, pos: 5 }, { p: 'https://unstop.com/blog/b', clicks: 50, impr: 2000, pos: 8 }] };
  const D = { QP: [{ q: 'unstop hackathon', p: 'https://unstop.com/hackathons/a', clicks: 30, impr: 100, pos: 1 }, { q: 'hackathon 2026', p: 'https://unstop.com/hackathons/a', clicks: 60, impr: 800, pos: 6 }], prevP: [{ p: 'https://unstop.com/hackathons/a', clicks: 80, impr: 900, pos: 6 }] };
  const v = U.visibility(A, D, typeOf, isB);
  const opp = v.rows.find(r => r.id === 'opp');
  assert.equal(opp.clicks, 100);
  assert.ok(Math.abs(opp.bShareC - 30 / 90) < 1e-9);
  assert.ok(Math.abs(opp.estNB.clicks - 100 * 60 / 90) < 1e-9);
  assert.equal(Math.round(opp.dClicks), 25);
  assert.equal(v.rows[0].id, 'opp'); // core order
});
test('rank buckets: each query once, under its top page type', () => {
  const A = { Q: [{ q: 'hackathon', impr: 100, pos: 2 }, { q: 'ssc cgl exam', impr: 50, pos: 12 }, { q: 'unstop', impr: 900, pos: 1 }, { q: 'orphan', impr: 5, pos: 8 }] };
  const D = { QP: [{ q: 'hackathon', p: 'https://unstop.com/hackathons', impr: 90 }, { q: 'hackathon', p: 'https://unstop.com/blog/x', impr: 10 }, { q: 'ssc cgl exam', p: 'https://unstop.com/blog/ssc-cgl-exam', impr: 50 }, { q: 'unstop', p: 'https://unstop.com/', impr: 900 }], prevQ: [{ q: 'hackathon', impr: 10, pos: 15 }] };
  const r = U.rankBuckets(A, D, typeOf, isB, U.makeClusterer());
  const g = k => r.byType.find(x => x.key === k);
  assert.equal(g('opp').n.top3, 1); assert.equal(g('opp').pn.p11, 1);
  assert.equal(g('blog').n.p11, 1); assert.equal(g('blog').n.top10, 0);
  assert.equal(g('home').b.top3, 1);
  assert.equal(g('unmapped').n.top10, 1);
  assert.equal(r.total.n.top10, 2);
});
test('weekly: Monday weeks, partial flagged', () => {
  const rows = []; for (let i = 0; i < 10; i++) rows.push({ d: `2026-10-${String(5 + i).padStart(2, '0')}`, clicks: 10, impr: 100, pos: 5 });
  const w = U.weekly(rows);
  assert.equal(w.length, 2); assert.equal(w[0].w, '2026-10-05'); assert.equal(w[0].clicks, 70); assert.equal(w[0].partial, false); assert.equal(w[1].partial, true);
});
test('GA4 model: events by landing page type, YoY and channels', () => {
  const rep = (dims, mets, rows) => ({ dimensionHeaders: dims.map(name => ({ name })), metricHeaders: mets.map(name => ({ name })), rows: rows.map(r => ({ dimensionValues: r[0].map(value => ({ value })), metricValues: r[1].map(v => ({ value: String(v) })) })) });
  const raw = {
    landing: rep(['landingPage', 'dateRange'], ['sessions', 'newUsers', 'engagedSessions', 'screenPageViews', 'userEngagementDuration', 'keyEvents'], [[['/hackathons/a', 'cur'], [100, 60, 50, 200, 0, 3]], [['/blog/b', 'cur'], [50, 40, 20, 60, 0, 0]], [['/hackathons/a', 'yoy'], [80, 50, 40, 150, 0, 0]]]),
    events: rep(['landingPage', 'eventName'], ['eventCount', 'totalUsers'], [[['/hackathons/a', 'sign_up'], [5, 5]], [['/hackathons/a', 'register'], [12, 10]], [['/blog/b', 'select_content'], [7, 6]], [['/blog/b', 'signup_email_verified'], [2, 2]]]),
    channels: rep(['sessionDefaultChannelGroup'], ['sessions', 'newUsers', 'engagedSessions', 'keyEvents'], [[['Organic Search'], [150, 100, 70, 3]]]),
    channelEvents: rep(['sessionDefaultChannelGroup', 'eventName'], ['eventCount'], [[['Organic Search', 'sign_up'], [5]]]),
    ai: rep(['sessionSource', 'landingPage', 'dateRange'], ['sessions', 'engagedSessions', 'keyEvents', 'newUsers'], [[['chatgpt.com', '/blog/b', 'cur'], [4, 3, 0, 2]], [['chat.openai.com', '/', 'yoy'], [1, 1, 0, 1]]])
  };
  const M = U.ga4Model(raw, typeOf, { studentSignup: ['sign_up', 'signup_email_verified'], opportunityAction: ['register'], productClick: ['select_content'] });
  assert.equal(M.total.sessions, 150); assert.equal(Math.round(M.dSessions), 88);
  const opp = M.types.find(t => t.id === 'opp'), blog = M.types.find(t => t.id === 'blog');
  assert.equal(opp.stu, 5); assert.equal(opp.opp, 12); assert.equal(blog.prodClick, 7); assert.equal(blog.stu, 2);
  assert.equal(M.ai[0].source, 'ChatGPT'); assert.equal(M.ai[0].sessions, 4); assert.equal(M.ai[0].ySessions, 1);
  assert.equal(M.channels[0].stu, 5);
  assert.equal(U.topSignupPages(M)[0].path, '/hackathons/a');
});
test('GA4 requests: two named date ranges, organic filter, valid limits', () => {
  const R = U.ga4Requests({ start: '2026-09-20', end: '2026-10-20', aiSources: ['chatgpt'], pricingPaths: ['/pricing'] });
  assert.equal(R.landing.dateRanges[1].startDate, '2025-09-20');
  assert.ok(Object.values(R).every(b => b.limit <= 250000 && b.dateRanges.length <= 4));
  assert.equal(R.landing.dimensionFilter.filter.stringFilter.value, 'Organic Search');
});
test('non-branded signup share estimate uses each page’s GSC click mix', () => {
  const ga = { pages: [{ path: '/hackathons/a', signups: 10 }, { path: '/x', signups: 5 }] };
  const D = { QP: [{ q: 'unstop', p: 'https://unstop.com/hackathons/a', clicks: 25 }, { q: 'hackathon', p: 'https://unstop.com/hackathons/a', clicks: 75 }] };
  const r = U.nonBrandedSignupShare(ga, D, isB);
  assert.equal(r.share, 75); assert.equal(r.unmatched, 5); assert.ok(Math.abs(r.coverage - 66.666) < 0.01);
});
test('MoEngage: organic vs other, eligibility windows, dd/mm dates', () => {
  const rows = [['User ID', 'Created At', 'UTM Source', 'UTM Medium', 'User Type', 'Profile Completion %', 'First Registration Date', 'Last Seen'],
    ['1', '01/09/2026', 'google', 'organic', 'Student', '90', '03/09/2026', '20/10/2026'],
    ['2', '02/09/2026', 'google', 'cpc', 'Student', '40', '', '02/09/2026'],
    ['3', '15/10/2026', 'bing', '', 'Recruiter', '100', '16/10/2026', '20/10/2026'],
    ['4', '05/09/2026', 'google', 'organic', 'Student', '50', '30/09/2026', '10/09/2026']];
  const r = U.moeQuality(rows, {});
  assert.ok(r.ok);
  assert.equal(r.seg.organic.users, 3); assert.equal(r.seg.other.users, 1);
  assert.equal(r.seg.organic.profile.rate.toFixed(1), '66.7');
  assert.equal(r.seg.organic.act7.n, 2); assert.equal(r.seg.organic.act7.rate, 50); // user 3 signed up < 7 days before the export
  assert.equal(r.seg.organic.ret30.n, 2); assert.equal(r.seg.organic.ret30.rate, 50);
  assert.equal(r.seg.orgEmployer.users, 1);
});
test('MoEngage: clear error without a signup date column', () => {
  const r = U.moeQuality([['id', 'name'], ['1', 'a']], {});
  assert.equal(r.ok, false); assert.ok(/signup date/i.test(r.error));
});
test('sitemaps map to page types by file name', () => {
  const r = U.sitemapTypes([{ path: 'https://unstop.com/sitemap-c.xml', contents: [{ submitted: '10' }] }, { path: 'https://unstop.com/sitemap-hackathons-2.xml' }, { path: 'https://unstop.com/sitemap-misc.xml' }], typeOf);
  assert.equal(JSON.stringify(r.map(x => x.type)), JSON.stringify(['org', 'opp', null])); assert.equal(r[0].submitted, 10);
});

test('URL clusters: user-named folders land in their own cluster and roll up to page types', () => {
  const f = U.makeSectioner();
  const cases = { 'https://unstop.com/internship': ['internships', 'opp'], 'https://unstop.com/job': ['jobs', 'opp'], 'https://unstop.com/hackathons': ['hackathons', 'opp'],
    'https://unstop.com/competitions/x-1': ['competitions', 'opp'], 'https://unstop.com/blog/x': ['blog', 'blog'], 'https://unstop.com/resources': ['resources', 'blog'],
    'https://unstop.com/employers/hire-java-developers': ['empjobboard', 'emp'], 'https://unstop.com/employers/ats-software': ['empb2b', 'emp'], 'https://unstop.com/saas-pricing': ['empb2b', 'emp'],
    'https://unstop.com/c/tcs-1': ['orgpages', 'org'], 'https://unstop.com/tcs-nqt-exam-pattern-sections-and-preparation-guide': ['blog', 'blog'], 'https://unstop.com/': ['home', 'home'] };
  Object.entries(cases).forEach(([u, [id, t]]) => { assert.equal(f(u), id, u); assert.equal(f.typeOf(f(u)), t, u); });
});
test('URL clusters: text round-trip keeps ids, names and page types', () => {
  const p = U.parseSections(U.sectionsText());
  assert.equal(p.length, U.DEFAULT_SECTIONS.length);
  p.forEach((x, i) => { assert.equal(x.id, U.DEFAULT_SECTIONS[i].id); assert.equal(x.type, U.DEFAULT_SECTIONS[i].type); assert.equal(x.rules.join(), U.DEFAULT_SECTIONS[i].rules.join()); });
  const c = U.parseSections('Placements | Opportunity & competition: /placements\nMisc: /misc');
  assert.equal(c[0].type, 'opp'); assert.equal(c[1].type, 'other');
});
test('URL cluster regex matches the folder but not look-alike folders', () => {
  const rx = new RegExp(U.sectionRegex(U.DEFAULT_SECTIONS.find(x => x.id === 'jobs')));
  assert.ok(rx.test('https://unstop.com/jobs/x-1')); assert.ok(rx.test('https://unstop.com/job')); assert.ok(!rx.test('https://unstop.com/jobsearch'));
});
test('cluster model: exact branded / non-branded / anonymised and ranking buckets', () => {
  const m = U.sectionModel({ tot: { clicks: 100, impressions: 1000, position: 5 }, b: { clicks: 60, impressions: 300, position: 1.5 }, nb: { clicks: 30, impressions: 600, position: 8 },
    queries: [{ q: 'unstop internship', clicks: 60, impr: 300, pos: 1.2 }, { q: 'summer internship 2026', clicks: 20, impr: 300, pos: 2 }, { q: 'data analyst internship', clicks: 9, impr: 200, pos: 8 }, { q: 'internship for freshers', clicks: 1, impr: 100, pos: 14 }],
    prevTot: { clicks: 80, impressions: 900, position: 6 }, prevB: { clicks: 50, impressions: 300, position: 1.5 }, prevNb: { clicks: 25, impressions: 500, position: 9 },
    prevQueries: [{ q: 'summer internship 2026', clicks: 5, impr: 100, pos: 12 }] }, isB, U.makeClusterer());
  assert.equal(m.anon.clicks, 10); assert.equal(m.bShare.toFixed(1), '66.7');
  assert.equal(m.buckets.n.top3, 1); assert.equal(m.buckets.n.top10, 2); assert.equal(m.buckets.n.p11, 1); assert.equal(m.buckets.b.top3, 1);
  assert.equal(m.prevBuckets.n.p11, 1); assert.equal(m.d.nbClicks, 20);
  assert.equal(m.quick[0].q, 'internship for freshers');
  assert.equal(m.byQueryCluster[0].name, 'Internships');
});

test('GA4: page type × device, × state, URL clusters and conversion-path coverage, all with last year', () => {
  const mk = (dims, mets, rows) => ({ dimensionHeaders: dims.map(name => ({ name })), metricHeaders: mets.map(name => ({ name })), rows: rows.map(r => ({ dimensionValues: r[0].map(value => ({ value })), metricValues: r[1].map(v => ({ value: String(v) })) })) });
  const raw = {
    landing: mk(['landingPage', 'dateRange'], ['sessions', 'newUsers', 'engagedSessions', 'screenPageViews', 'userEngagementDuration', 'keyEvents'], [[['/hackathons/x-1', 'cur'], [600, 300, 400, 900, 1, 0]], [['/hackathons/x-1', 'yoy'], [400, 200, 0, 0, 0, 0]], [['/blog/a', 'cur'], [400, 300, 200, 500, 1, 0]], [['/blog/a', 'yoy'], [500, 350, 0, 0, 0, 0]]]),
    landingDevice: mk(['landingPage', 'deviceCategory', 'dateRange'], ['sessions', 'newUsers'], [[['/hackathons/x-1', 'mobile', 'cur'], [500, 250]], [['/hackathons/x-1', 'mobile', 'yoy'], [250, 120]], [['/blog/a', 'desktop', 'cur'], [100, 80]]]),
    landingRegion: mk(['landingPage', 'region', 'dateRange'], ['sessions', 'newUsers'], [[['/hackathons/x-1', 'Delhi', 'cur'], [200, 100]], [['/hackathons/x-1', 'Delhi', 'yoy'], [100, 50]]])
  };
  const M = U.ga4Model(raw, typeOf, {}, { sectionOf: U.makeSectioner(), pathSections: U.DEFAULT_PATH_SECTIONS });
  const md = M.typeDevice.find(r => r.type === 'opp' && r.key === 'mobile'); assert.equal(md.sessions, 500); assert.equal(md.dSessions, 100);
  const dl = M.typeRegion.find(r => r.type === 'opp' && r.key === 'Delhi'); assert.equal(dl.dSessions, 100);
  assert.equal(M.pathCov.share, 60); assert.equal(M.pathCov.yShare.toFixed(1), '44.4');
  const hk = M.sections.find(x => x.id === 'hackathons'); assert.equal(hk.path, true); assert.equal(hk.dSessions, 50);
  assert.equal(M.sections.find(x => x.id === 'blog').path, false);
});

test('quality verdict: any measure where organic is worse means volume alone is not a win', () => {
  const ok = U.qualityVerdict({ profile: { organic: 58, other: 41 }, ret30: { organic: 21, other: 20.5 } });
  assert.equal(ok.ok, true); assert.equal(ok.rows[1].state, 'level');
  const bad = U.qualityVerdict({ ret30: { organic: 12, other: 18 }, act7: { organic: 40, other: 30 } });
  assert.equal(bad.ok, false); assert.equal(bad.worse, 1);
  assert.equal(U.qualityVerdict({}), null);
});
report('unstop');
