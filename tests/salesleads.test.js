// Tests for the B2B sales-form leads model (salesleads.js).
'use strict';
const { load, test, assert, report } = require('./lib/harness');
const W = load(['salesleads.js']);
const S = W.UN_SALES;

test('email domains: official, campus, personal, internal', () => {
  assert.equal(S.emailKind('gmail.com'), 'personal');
  assert.equal(S.emailKind('Yahoo.co.in'), 'personal');
  assert.equal(S.emailKind('unstop.com'), 'internal');
  assert.equal(S.emailKind('iitg.ac.in'), 'campus');
  assert.equal(S.emailKind('nitt.edu'), 'campus');
  assert.equal(S.emailKind('adityauniversity.in'), 'campus');
  assert.equal(S.emailKind('tcs.com', 'Working Professionals'), 'official');
  assert.equal(S.emailKind('snsct.org', 'College Students'), 'campus');
  assert.equal(S.emailKind(''), 'unknown');
});
test('dates and pages from the sheet', () => {
  assert.equal(S.parseDay('April 1, 2025, 8:44 AM'), '2025-04-01');
  assert.equal(S.parseDay('Sept 3, 2026'), '2026-09-03');
  assert.equal(S.parseDay('2026-10-14 09:00'), '2026-10-14');
  assert.equal(S.pagePath('undefined/employers'), '/employers');
  assert.equal(S.pagePath('https://unstop.com/Employers/hire-react-developers/?x=1'), '/employers/hire-react-developers');
  assert.equal(S.pagePath(''), '');
});
test('two tabs merged, duplicates dropped, one class per domain, emails and phones not kept', () => {
  const a = [['name', 'usertype', 'type', 'created_at', 'link', 'Channel', 'User Status', 'Email Domain'],
    ['A One', 'Working Professionals', 'salesForm', 'October 14, 2026, 5:54 PM', 'https://unstop.com/employers', 'Organic', 'New User', 'acme.com'],
    ['B Two', 'College Students', 'salesForm', 'October 2, 2026, 1:00 PM', 'https://unstop.com/employers/hire-react-developers', 'Organic', 'Existing User', 'gmail.com'],
    ['C Three', 'College Students', 'salesForm', 'October 3, 2026, 1:00 PM', 'https://unstop.com/contact-us', 'Organic', 'New User', 'snsct.org'],
    ['D Four', 'Working Professionals', 'salesForm', 'October 4, 2026, 1:00 PM', 'https://unstop.com/contact-us', 'Organic', 'New User', 'snsct.org']];
  const b = [['name', 'email', 'phone', 'usertype', 'type', 'created_at', 'link', 'Channel', 'User Status'],
    ['A One', 'a@acme.com', '99', 'Working Professionals', 'salesForm', 'October 14, 2026, 5:54 PM', 'https://unstop.com/employers', 'Organic', 'New User'],
    ['E Five', 'e@unstop.com', '98', 'Working Professionals', 'salesForm', 'October 20, 2026, 5:54 PM', 'https://unstop.com/employers', 'jnigads210', 'New User']];
  const m = S.salesModel([{ name: 'Last 18 Months Data', rows: a }, { name: 'from oct 14', rows: b }]);
  assert.equal(m.ok, true); assert.equal(m.leads.length, 5); assert.equal(m.sheets[1].dup, 1);
  assert.equal(m.min, '2026-10-02'); assert.equal(m.max, '2026-10-20');
  const snsct = m.leads.filter(l => l.domain === 'snsct.org'); assert.ok(snsct.every(l => l.kind === 'campus'));
  const e = m.leads.find(l => l.domain === 'unstop.com'); assert.equal(e.kind, 'internal'); assert.equal(e.organic, false);
  assert.ok(m.leads.every(l => !('email' in l) && !('phone' in l))); assert.equal(m.leads[0].name, 'A One');
  const t = S.tally(m.leads); assert.equal(t.total, 4); assert.equal(t.internal, 1); assert.equal(t.official, 1); assert.equal(t.campus, 2); assert.equal(t.personal, 1); assert.equal(t.officialShare, 25);
});
test('sheet without the needed columns is reported, not guessed', () => {
  const m = S.salesModel([{ name: 'x', rows: [['foo', 'bar'], ['1', '2']] }]);
  assert.equal(m.ok, false); assert.ok(/created_at/.test(m.sheets[0].skipped));
});
report('salesleads');
