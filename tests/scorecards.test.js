// Tests for the workstream scorecards (scorecards.js).
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load(['engine.js', 'unstop.js', 'scorecards.js']);
const S = W.UN_SC, U = W.UN, so = U.makeSectioner();

test('PageSpeed: field data decides the Core Web Vitals pass', () => {
  const j = { loadingExperience: { overall_category: 'FAST', metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100 }, INTERACTION_TO_NEXT_PAINT: { percentile: 150 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 } } }, lighthouseResult: { categories: { performance: { score: 0.71 } }, audits: { 'largest-contentful-paint': { numericValue: 3200 } } } };
  const r = S.psiParse('https://unstop.com/', j);
  assert.equal(r.pass, true); assert.equal(r.perf, 71); assert.equal(r.field.cls, 0.05);
  const lab = S.psiParse('https://unstop.com/x', { lighthouseResult: { categories: { performance: { score: 0.4 } }, audits: {} } });
  assert.equal(lab.pass, null);
  const sum = S.cwvSummary([r, lab, { url: 'z', error: 'quota' }]);
  assert.equal(sum.passRate, 100); assert.equal(sum.withField, 1); assert.equal(sum.failed, 1);
  assert.ok(/strategy=mobile/.test(S.psiUrl('https://unstop.com/', '')));
});
test('crawl export: errors by cluster, HTML only', () => {
  const rows = [['Address', 'Content Type', 'Status Code', 'Indexability', 'Response Time'], ['https://unstop.com/jobs/a-1', 'text/html', '404', 'Non-Indexable', '0.5'], ['https://unstop.com/jobs/b-2', 'text/html', '200', 'Indexable', '0.7'], ['https://unstop.com/x.css', 'text/css', '404', '', '0.1'], ['https://unstop.com/blog/x', 'text/html', '200', 'Non-Indexable', '0.3']];
  const m = S.crawlModel(rows, so);
  assert.equal(m.ok, true); assert.equal(m.urls, 3); assert.equal(m.errors4, 1); assert.equal(m.nonIndexable, 1);
  assert.equal(m.clusters.find(c => c.id === 'jobs').errorRate, 50);
});
test('publishing log: indexed = impressions, traffic after 90 days, clicks per page', () => {
  const rows = [['URL', 'Publish date', 'Template'], ['https://unstop.com/internship/a-internship', '2026-05-01', 'Programmatic'], ['https://unstop.com/internship/b-internship', '2026-05-02', 'Programmatic'], ['https://unstop.com/blog/new', '2026-10-01', 'Blog']];
  const P = [{ p: 'https://unstop.com/internship/a-internship', clicks: 30, impr: 900 }, { p: 'https://unstop.com/blog/new', clicks: 0, impr: 40 }];
  const m = S.publishingModel(rows, P, so, '2026-10-24');
  assert.equal(m.total.published, 3); assert.equal(m.total.visible, 2); assert.equal(m.total.old, 2); assert.equal(m.total.traffic90, 1); assert.equal(m.total.perPage, 10);
  assert.equal(m.byTemplate.find(t => t.key === 'Programmatic').traffic90Rate, 50);
});
test('links: one row per domain, quality tiers, ranking movement on target pages', () => {
  const rows = [['Referring domain', 'Domain rating', 'First seen', 'Target URL', 'Link type'], ['www.news.com', '70', '2026-09-02', 'https://unstop.com/employers/ats-software', 'dofollow'], ['news.com', '72', '2026-08-01', 'https://unstop.com/employers', 'dofollow'], ['blog.in', '12', '2026-10-01', 'https://unstop.com/employers/ats-software', 'nofollow']];
  const A = { P: [{ p: 'https://unstop.com/employers/ats-software', clicks: 50, pos: 8 }] }, D = { prevP: [{ p: 'https://unstop.com/employers/ats-software', clicks: 40, pos: 11 }] };
  const m = S.linksModel(rows, A, D, so);
  assert.equal(m.domains, 2); assert.equal(m.follow, 1); assert.equal(m.tiers[0].domains, 1);
  const t = m.targets.find(x => x.path === '/employers/ats-software'); assert.equal(t.domains, 2); assert.equal(t.posChange, 3); assert.equal(m.improved, 1);
});
test('AI answers: engines normalised, mention and citation rates, gaps first', () => {
  const rows = [['Query', 'Engine', 'Mentioned', 'Cited', 'Cited URL', 'Date'], ['q1', 'chatgpt-4o', 'yes', 'no', '', '2026-10-01'], ['q1', 'Google AI Overview', 'no', 'no', '', '2026-10-01'], ['q2', 'perplexity', 'no', 'yes', 'https://unstop.com/hackathons', '2026-10-01']];
  const m = S.aiModel(rows);
  assert.equal(m.ok, true); assert.ok(Math.abs(m.total.mention - 200 / 3) < 1e-9); assert.ok(Math.abs(m.total.cite - 100 / 3) < 1e-9);
  assert.equal(S.engineName('Google AI Overview'), 'Google AI Overviews'); assert.equal(m.urls[0].path, '/hackathons');
  assert.equal(m.queries[0].q, 'q1');
});

test('share of voice: long and wide rank-tracker formats, fixed keyword set, change between checks', () => {
  const comps = ['internshala.com', 'naukri.com', 'hackerearth.com', 'careers360.com'];
  const rows = [['Keyword', 'Volume', 'Domain', 'Position', 'Date'], ['hackathons', '9000', 'unstop.com', '2', '2026-10-01'], ['hackathons', '9000', 'hackerearth.com', '1', '2026-10-01'], ['internship', '50000', 'internshala.com', '1', '2026-10-01'], ['internship', '50000', 'www.unstop.com', '8', '2026-10-01'], ['hackathons', '9000', 'unstop.com', '4', '2026-09-01'], ['jobs', '100', 'unstop.com', '1', '2026-10-01']];
  const m = S.sovModel(rows, { competitors: comps, keywords: ['hackathons', 'internship', 'tcs nqt'] });
  assert.equal(m.ok, true); assert.equal(m.latest, '2026-10-01'); assert.equal(m.cur.keywords, 2); assert.equal(m.missing.join(), 'tcs nqt');
  const me = m.cur.per.find(x => x.own), ish = m.cur.per.find(x => x.domain === 'internshala.com');
  assert.ok(ish.sov > me.sov); assert.equal(me.top10, 2); assert.ok(me.dSov < 0);
  assert.equal(m.kwRows.find(r => r.kw === 'internship').gap, 7);
  const w = S.sovModel([['Keyword', 'Search Volume', 'unstop.com', 'internshala.com Position'], ['internship', '50000', '8', '1']], { competitors: ['internshala.com'] });
  assert.equal(w.ok, true); assert.ok(w.cur.per.find(x => x.domain === 'internshala.com').sov > 80);
});
report('scorecards');
