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
report('unstop');
