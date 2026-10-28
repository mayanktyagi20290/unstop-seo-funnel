// Unstop SEO › B2B sales-form leads (the "B2B Form Leads" Google Sheet, used as the CRM for B2E).
// Each lead's email domain is classed as official (company), campus (college / university), personal
// (Gmail and other free mail) or internal (unstop.com), and tied to the page the form was filled on.
// Names are kept (in this tab only) so a count can be opened into its leads; email addresses and phone
// numbers are read only to dedupe and get the domain, then dropped.
(function (root) {
  'use strict';
  const FREE = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'ymail.com', 'rocketmail.com', 'outlook.com', 'outlook.in', 'hotmail.com', 'hotmail.co.in', 'live.com', 'live.in', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'rediffmail.com', 'rediff.com', 'protonmail.com', 'proton.me', 'pm.me', 'zoho.com', 'zohomail.in', 'zohomail.com', 'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'yandex.ru', 'tutanota.com', 'inbox.com', 'fastmail.com', 'hey.com', 'duck.com', 'mailinator.com', 'yopmail.com', 'tempmail.com', '10minutemail.com', 'qq.com', '163.com', 'sify.com', 'indiatimes.com', 'in.com']);
  const INTERNAL = ['unstop.com', 'dare2compete.com'];
  const CAMPUS_TLD = /(\.|^)(ac|edu)(\.[a-z]{2,3})?$|\.edu$|\.ac\.[a-z]{2}$/;
  const CAMPUS_WORD = /(^|[.-])(iit|nit|iiit|iim|iiser|bits|vit|srm|amity|manipal|kiit|lpu|nmims|symbiosis|christ|university|univ|college|institute|inst|polytechnic|vidyalaya|vidyapeeth|vidyapith|academy|school|campus|student|students|study|alumni)([.-]|$)|university|college|institute|vidyalaya|polytechnic/;
  const STUDENT_TYPES = /college student|school student|student|fresher/i;
  function emailKind(domain, usertype) {
    const d = String(domain || '').trim().toLowerCase().replace(/^.*@/, '').replace(/^www\./, '');
    if (!d || !d.includes('.')) return 'unknown';
    if (INTERNAL.some(x => d === x || d.endsWith('.' + x))) return 'internal';
    if (FREE.has(d)) return 'personal';
    if (CAMPUS_TLD.test(d) || CAMPUS_WORD.test(d)) return 'campus';
    // a non-free domain used by someone who signed up as a student is almost always their college
    if (STUDENT_TYPES.test(String(usertype || ''))) return 'campus';
    return 'official';
  }
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  function parseDay(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && isFinite(v)) { const d = new Date(Math.round((v - 25569) * 864e5)); return isNaN(d) ? null : d.toISOString().slice(0, 10); } // spreadsheet serial
    const s = String(v).trim();
    const mon = w => MONTHS[String(w).slice(0, 3).toLowerCase()];
    let m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/); if (m && mon(m[1]) != null) return new Date(Date.UTC(+m[3], mon(m[1]), +m[2])).toISOString().slice(0, 10);
    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/); if (m && mon(m[2]) != null) return new Date(Date.UTC(+m[3], mon(m[2]), +m[1])).toISOString().slice(0, 10);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])).toISOString().slice(0, 10);
    const d = new Date(s); return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  // the page path the form was filled on ("undefined/employers" and bare paths are repaired)
  function pagePath(link) {
    let s = String(link || '').trim();
    if (!s || s === 'undefined' || s === 'null') return '';
    s = s.replace(/^undefined(?=\/)/, '');
    try { const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://unstop.com' + (s.startsWith('/') ? '' : '/') + s); return (u.pathname.replace(/\/+$/, '') || '/').toLowerCase(); } catch (e) { return ''; }
  }
  // channel values in the sheet grouped into sources
  function sourceOf(ch) {
    const c = String(ch || '').trim(), l = c.toLowerCase();
    if (!c || /organic|seo/.test(l)) return 'Organic search';
    if (/^jni.*ads|jnigads/.test(l)) return 'J&I Google Ads';
    if (/^jni/.test(l)) return 'J&I campaigns';
    if (/g?ads|cpc|ppc|paid|adwords|google_ads|meta|facebook|fb_|instagram|linkedin_ads/.test(l)) return 'Paid ads';
    if (/banner/.test(l)) return 'Unstop site banners';
    if (/mail|newsletter|moengage|push|whatsapp|sms/.test(l)) return 'Email / messaging';
    if (/linkedin|twitter|youtube|social/.test(l)) return 'Social';
    return 'Other (short links, referrals)';
  }
  const norm = x => String(x || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const FIELDS = { name: ['name', 'full name', 'lead name'], email: ['email', 'email id', 'email address', 'work email'], domain: ['email domain', 'domain'], usertype: ['usertype', 'user type', 'type of user', 'persona'], type: ['type', 'form', 'form type'], created: ['created_at', 'created at', 'created', 'date', 'submitted at', 'timestamp'], link: ['link', 'page', 'page url', 'url', 'landing page', 'source page'], channel: ['channel', 'source', 'utm_source', 'utm source', 'lead source'], status: ['user status', 'status', 'new / existing'] };
  function headerMap(h) {
    const H = h.map(norm), map = {}, used = new Set();
    Object.entries(FIELDS).forEach(([k, names]) => { const i = H.findIndex((x, j) => !used.has(j) && names.includes(x)); if (i >= 0) { map[k] = i; used.add(i); } });
    return map;
  }
  // sheets: [{ name, rows: [[header…], [row…]] }]. Rows from several tabs are merged and deduped.
  function salesModel(sheets) {
    const seen = new Set(), leads = [], info = [];
    (sheets || []).forEach(sh => {
      const rows = (sh.rows || []).filter(r => r && r.some(c => String(c).trim() !== ''));
      if (rows.length < 2) { info.push({ name: sh.name, rows: 0, used: 0, skipped: 'empty' }); return; }
      const map = headerMap(rows[0]);
      if (map.created == null || map.link == null || (map.email == null && map.domain == null)) { info.push({ name: sh.name, rows: rows.length - 1, used: 0, skipped: 'needs created_at, link and email or email domain columns' }); return; }
      let used = 0, dup = 0;
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i], get = k => map[k] == null ? '' : r[map[k]];
        const email = String(get('email') || '').trim().toLowerCase();
        const domain = String(get('domain') || email.split('@')[1] || '').trim().toLowerCase();
        const day = parseDay(get('created'));
        const key = [norm(get('name')) || email, String(get('created')).trim(), String(get('link')).trim()].join('|');
        if (seen.has(key)) { dup++; continue; } seen.add(key);
        const ch = String(get('channel') || '').trim();
        const usertype = String(get('usertype') || '').trim();
        leads.push({ name: String(get('name') || '').trim().slice(0, 80), day, month: day ? day.slice(0, 7) : null, path: pagePath(get('link')), domain, kind: emailKind(domain, usertype), usertype, status: String(get('status') || '').trim(), channel: ch || 'Organic', source: sourceOf(ch), organic: !ch || /organic|seo/i.test(ch) });
        used++;
      }
      info.push({ name: sh.name, rows: rows.length - 1, used, dup });
    });
    // one class per domain: a non-free domain that students mostly sign up with is a campus domain
    const dm = new Map(); leads.forEach(l => { if (l.kind !== 'official' && l.kind !== 'campus') return; const o = dm.get(l.domain) || { n: 0, st: 0, campusName: false }; o.n++; if (STUDENT_TYPES.test(l.usertype)) o.st++; if (CAMPUS_TLD.test(l.domain) || CAMPUS_WORD.test(l.domain)) o.campusName = true; dm.set(l.domain, o); });
    leads.forEach(l => { const o = dm.get(l.domain); if (!o) return; l.kind = o.campusName || o.st / o.n >= 0.5 ? 'campus' : 'official'; });
    if (!leads.length) return { ok: false, error: 'No lead rows found. The sheet needs created_at, link and email (or Email Domain) columns.', sheets: info };
    const days = leads.map(l => l.day).filter(Boolean).sort();
    return { ok: true, leads, sheets: info, min: days[0] || null, max: days[days.length - 1] || null, channels: [...new Set(leads.map(l => l.channel))] };
  }
  const blank = () => ({ total: 0, official: 0, campus: 0, personal: 0, internal: 0, unknown: 0, newU: 0, existing: 0 });
  function tally(list) {
    const o = blank();
    (list || []).forEach(l => { o[l.kind] = (o[l.kind] || 0) + 1; if (l.kind !== 'internal') { o.total++; if (/new/i.test(l.status)) o.newU++; else if (/exist/i.test(l.status)) o.existing++; } });
    o.officialShare = o.total ? o.official / o.total * 100 : null;
    return o;
  }
  const api = { sourceOf, emailKind, parseDay, pagePath, salesModel, tally, FREE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.UN_SALES = api;
})(typeof window !== 'undefined' ? window : globalThis);
