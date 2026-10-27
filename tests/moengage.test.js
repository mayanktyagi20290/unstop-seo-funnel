// Tests for MoEngage live chart parsing and metric mapping (moengage.js).
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const M = load(['moengage.js']).UN_MOE;

test('host picks the data centre and falls back to 01', () => {
  assert.equal(M.host('03'), 'https://api-03.moengage.com');
  assert.equal(M.host('101'), 'https://api-101.moengage.com');
  assert.equal(M.host('x'), 'https://api-01.moengage.com');
});
test('dashboards and charts envelopes', () => {
  const d = M.dashboards({ data: [{ _id: 'a1', name: 'SEO', owned_by: 'm@x' }, { _id: 'b2', name: 'Growth' }] });
  assert.equal(d.length, 2); assert.equal(d[0].id, 'a1'); assert.equal(d[1].name, 'Growth');
  const c = M.charts({ response_id: 'r', type: 'dashboard', data: { name: 'Acquisition Overview', chart_ids: [{ _id: 'c1', name: 'New Users by Day' }, { _id: 'c2', name: 'Sign-ups by Channel' }] } });
  assert.equal(c.name, 'Acquisition Overview'); assert.equal(c.charts.map(x => x.id).join(), 'c1,c2');
});
test('chart rows are flattened into a table with numeric columns detected', () => {
  const t = M.table({ data: { rows: [{ source: 'google / organic', metrics: { users: 120, conv: '0.42' } }, { source: 'facebook / cpc', metrics: { users: '80', conv: 0.3 } }] } });
  assert.equal(t.rows.length, 2);
  const cols = Object.fromEntries(t.columns.map(c => [c.key, c.numeric]));
  assert.equal(cols['metrics.users'], true); assert.equal(cols.source, false);
});
test('header-row grids are read too', () => {
  const t = M.table({ data: [['Day', 'Users'], ['Day 0', 100], ['Day 30', 22]] });
  assert.equal(t.rows.length, 2); assert.equal(t.rows[1].Users, 22);
});
test('pick filters rows by contains-any and aggregates', () => {
  const t = M.table({ data: [{ s: 'google organic', u: 100 }, { s: 'bing organic', u: 20 }, { s: 'paid cpc', u: 50 }] });
  assert.equal(M.pick(t, { column: 'u', agg: 'sum', filterCol: 's', filterText: 'organic' }).value, 120);
  assert.equal(M.pick(t, { column: 'u', agg: 'avg' }).value, 170 / 3);
  assert.equal(M.pick(t, { column: 'u', agg: 'last' }).value, 50);
  assert.equal(M.pick(t, { column: 'u', filterCol: 's', filterText: 'tiktok' }), null);
});
test('metrics: rates read as fractions become percentages, with comparison', () => {
  const t = M.table({ data: [{ ch: 'organic', r: 0.42 }, { ch: 'paid', r: 0.3 }] });
  const out = M.metrics({ ret30: { chart: 'c', column: 'r', agg: 'avg', filterCol: 'ch', filterText: 'organic', compareText: 'paid' }, profile: { chart: 'zz', column: 'r' } }, { c: t });
  assert.ok(Math.abs(out.ret30.value - 42) < 1e-9); assert.ok(Math.abs(out.ret30.compare - 30) < 1e-9);
  assert.equal(out.profile.missing, true);
  assert.equal(M.asRate(55, 'auto'), 55); assert.equal(M.asRate(0.5, 'no'), 0.5);
});
test('error text explains auth and firewall failures', () => {
  assert.ok(/Dashboard & Analyze/.test(M.errorText(401)));
  assert.ok(/proxy/.test(M.errorText(403, { message: 'IP not allowed' })));
});
report('moengage');
