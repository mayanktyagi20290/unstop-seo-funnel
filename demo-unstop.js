// Sample data shaped like unstop.com: the real URL structure (hackathons, competitions, internships, jobs,
// quizzes, fests, company pages, blog, employers…) with generated, fictional numbers, opportunity names
// and company names. Deterministic. Lets every Unstop funnel screen be previewed without signing in.
(function () {
  'use strict';
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function build() {
    const R = rng(2026);
    const between = (a, b) => a + R() * (b - a);
    const pick = a => a[Math.floor(R() * a.length)];
    const host = 'https://unstop.com';
    const exp = window.CW.expCtr;
    const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let id = 1740000;
    const nid = () => (id += 137 + Math.floor(R() * 900));

    const pages = [];
    const page = (path, o) => { const p = { p: host + path, ...o }; pages.push(p); return p; };
    const QP = [];
    const push = (q, pg, pos, impr, ctrF = 1) => {
      pos = Math.max(1, Math.min(70, pos)); impr = Math.max(3, Math.round(impr));
      const ctr = Math.min(75, exp(pos) * ctrF * between(0.75, 1.25));
      const clicks = Math.round(impr * ctr / 100);
      QP.push({ q, p: pg.p, clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos });
    };
    const B = 2.4; // branded searches click through far more often

    // ── home and brand ──
    const home = page('/', {});
    [['unstop', 160000], ['unstop.com', 22000], ['unstop app', 9000], ['dare2compete', 7000], ['un stop', 5000], ['unstop website', 4200], ['unstop student', 2600]].forEach(([q, v]) => push(q, home, between(1, 1.3), v, B));
    const login = page('/auth/login', {});
    [['unstop login', 26000], ['unstop sign in', 6000], ['unstop register', 4000]].forEach(([q, v]) => push(q, login, between(1, 1.4), v, B));

    // ── listing hubs with their own branded and non-branded searches ──
    const hub = (path, branded, generic) => {
      const pg = page(path, {});
      branded.forEach(([q, v]) => push(q, pg, between(1, 1.8), v, B));
      generic.forEach(([q, v, pos]) => push(q, pg, pos != null ? pos + between(-1, 1) : between(2, 14), v));
      return pg;
    };
    hub('/hackathons', [['unstop hackathon', 18000], ['unstop hackathons', 9000], ['dare2compete hackathon', 1200]],
      [['hackathons', 90000, 2.4], ['hackathon 2026', 52000, 3.1], ['online hackathons', 26000, 2.2], ['hackathons in india', 30000, 4.5], ['hackathon for students', 22000, 3.6], ['ai hackathon', 18000, 9.5], ['hackathons for beginners', 9000, 12.5], ['coding competitions for college students', 8000, 14.8]]);
    hub('/competitions', [['unstop competitions', 9000], ['unstop case competition', 3000]],
      [['case study competition', 40000, 2.1], ['case competitions 2026', 26000, 3.4], ['competitions for college students', 30000, 5.8], ['business competitions', 14000, 6.9], ['marketing competitions', 9000, 7.4], ['ideathon', 12000, 11.5], ['essay writing competition 2026', 16000, 13.2]]);
    hub('/internship', [['unstop internship', 14000], ['unstop internships', 6000]],
      [['internship', 220000, 8.4], ['internships for students', 60000, 6.2], ['summer internship 2026', 48000, 5.1], ['online internship', 30000, 9.2], ['work from home internship', 26000, 12.1], ['internship for freshers', 22000, 13.6], ['paid internship', 18000, 16.4]]);
    hub('/internships', [['unstop internship portal', 2000]], [['internships in india', 30000, 10.2], ['remote internships', 14000, 15.5]]);
    hub('/jobs', [['unstop jobs', 9000]], [['jobs for freshers', 70000, 11.8], ['fresher jobs 2026', 38000, 9.1], ['off campus drive 2026', 42000, 6.3], ['graduate trainee jobs', 9000, 12.9]]);
    hub('/job', [], [['entry level jobs', 26000, 17.2], ['jobs for graduates', 18000, 18.5]]);
    hub('/quiz', [['unstop quiz', 5000]], [['online quiz competition', 22000, 3.2], ['quiz competition for students', 16000, 4.4], ['general knowledge quiz 2026', 30000, 12.4]]);
    hub('/college-fests', [['unstop fest', 1200]], [['college fests 2026', 26000, 2.6], ['techfest 2026', 30000, 4.9], ['cultural fest', 12000, 8.6], ['college fest events list', 6000, 12.2]]);
    hub('/scholarships', [], [['scholarships for students 2026', 36000, 11.6], ['scholarship for engineering students', 14000, 14.2], ['merit scholarship', 9000, 19.4]]);
    hub('/workshops-webinars', [], [['free webinars for students', 8000, 7.5], ['online workshops with certificate', 9000, 9.8]]);
    hub('/awards', [], [['student awards 2026', 3000, 9.1]]);
    hub('/campus-ambassador-program', [['unstop campus ambassador', 3000]], [['campus ambassador program', 26000, 3.2], ['campus ambassador internship', 12000, 4.1]]);
    hub('/all-opportunities', [['unstop opportunities', 1500]], [['opportunities for students', 6000, 9.4]]);
    hub('/practice', [['unstop practice', 2500]], [['coding practice', 18000, 12.6], ['coding questions for placement', 14000, 8.8], ['aptitude practice test', 12000, 10.4]]);
    hub('/courses', [], [['free courses with certificate', 30000, 19.5]]);
    hub('/resume-builder', [['unstop resume builder', 900]], [['resume builder free', 22000, 17.4], ['resume maker for freshers', 9000, 13.1]]);

    // ── opportunity detail pages ──
    const hackNames = ['national ai innovation challenge', 'campus code sprint', 'smart city build-a-thon', 'fintech build sprint', 'green energy hackathon', 'healthtech hack week', 'ml prediction challenge', 'web3 builders hackathon', 'women in tech hackathon', 'open source summer hack', 'agritech innovation hackathon', 'cyber defence ctf', 'genai product sprint', 'edtech ideas hackathon', 'mobility hackathon', 'data science league', 'iot makers challenge', 'game jam weekend', 'climate code challenge', 'robotics build off'];
    hackNames.forEach((n, i) => {
      const pg = page(`/hackathons/${slug(n)}-${nid()}`, {}), base = between(4000, 26000) / (1 + i * 0.12);
      push(n, pg, between(1, 3.5), base, 1.3); push(n + ' 2026', pg, between(1, 4), base * 0.5, 1.2); push(n + ' registration', pg, between(1, 4), base * 0.3, 1.1); push(n + ' results', pg, between(2, 9), base * 0.25, 0.8);
      push('unstop ' + n, pg, between(1, 2), base * 0.12, B);
    });
    const compNames = ['b-school case challenge', 'marketing strategy challenge', 'product management challenge', 'finance case competition', 'hr case competition', 'consulting case challenge', 'supply chain case study', 'business plan competition', 'social impact ideathon', 'brand manager challenge', 'national essay contest', 'poster design contest', 'debate championship', 'stock market simulation', 'business quiz league', 'analytics case challenge'];
    compNames.forEach((n, i) => {
      const pg = page(`/competitions/${slug(n)}-${nid()}`, {}), base = between(2500, 16000) / (1 + i * 0.1);
      push(n, pg, between(1, 4), base, 1.2); push(n + ' 2026', pg, between(1, 5), base * 0.4, 1.1); push(n + ' winners', pg, between(3, 12), base * 0.18, 0.8); push(n + ' round 1 questions', pg, between(6, 18), base * 0.1, 1);
      push('unstop ' + n, pg, between(1, 2), base * 0.08, B);
    });
    const roles = ['data analyst', 'marketing', 'web development', 'python', 'hr', 'finance', 'content writing', 'graphic design', 'ui ux', 'machine learning', 'business development', 'social media', 'sales', 'java', 'android', 'digital marketing'];
    roles.forEach((r, i) => {
      const pg = page(`/internship/${slug(r)}-internship`, {}), base = between(6000, 30000) / (1 + i * 0.08);
      push(r + ' internship', pg, between(4, 16), base); push(r + ' internship for freshers', pg, between(6, 18), base * 0.3); push(r + ' internship work from home', pg, between(9, 22), base * 0.25); push(r + ' internship stipend', pg, between(5, 15), base * 0.1, 0.8);
    });
    const firms = ['brightpath technologies', 'nova finserv', 'kestrel analytics', 'bluefin retail', 'orbit labs', 'meridian consulting', 'sparrow foods', 'tidewater logistics', 'quanta motors', 'ember media', 'lattice health', 'arcadia edtech', 'pinecrest bank', 'vector cloud', 'harbor energy', 'sable insurance', 'northstar pharma', 'copper telecom'];
    for (let i = 0; i < 40; i++) {
      const r = pick(roles), f = pick(firms), pg = page(`/internships/${slug(r)}-intern-${slug(f)}-${nid()}`, {}), base = between(300, 3000);
      push(`${f} ${r} internship`, pg, between(1, 5), base, 1.2); push(`${f} internship`, pg, between(2, 9), base * 0.6);
    }
    const jobRoles = ['software engineer fresher', 'graduate engineer trainee', 'business analyst fresher', 'sales executive', 'customer success associate', 'data engineer fresher', 'management trainee', 'associate consultant'];
    jobRoles.forEach((r, i) => {
      const pg = page(`/job/${slug(r)}-jobs`, {}), base = between(5000, 22000) / (1 + i * 0.1);
      push(r + ' jobs', pg, between(7, 19), base); push(r + ' jobs 2026', pg, between(8, 20), base * 0.4); push(r + ' salary', pg, between(12, 30), base * 0.2, 0.6);
    });
    for (let i = 0; i < 30; i++) {
      const r = pick(jobRoles), f = pick(firms), pg = page(`/jobs/${slug(r)}-${slug(f)}-${nid()}`, {}), base = between(300, 2500);
      push(`${f} ${r}`, pg, between(1, 6), base, 1.1); push(`${f} off campus drive 2026`, pg, between(2, 8), base * 0.8); push(`${f} careers`, pg, between(6, 16), base * 0.5, 0.7);
    }
    ['current affairs quiz', 'india gk quiz', 'tech trivia quiz', 'business brand quiz', 'sports quiz', 'finance literacy quiz'].forEach(n => { const pg = page(`/quiz/${slug(n)}-${nid()}`, {}), base = between(1500, 9000); push(n, pg, between(2, 9), base); push(n + ' 2026', pg, between(2, 10), base * 0.4); });
    ['national techfest', 'spring cultural fest', 'annual management fest', 'design and arts fest', 'robotics fest', 'literary fest', 'entrepreneurship summit', 'music and dance fest'].forEach(n => { const pg = page(`/college-fests/${slug(n)}-2026-${nid()}`, {}), base = between(1500, 8000); push(n + ' 2026', pg, between(1, 6), base, 1.1); push(n + ' events', pg, between(3, 12), base * 0.3); });
    ['women in stem scholarship', 'first generation learner scholarship', 'engineering merit scholarship', 'mba scholarship'].forEach(n => { const pg = page(`/scholarships/${slug(n)}-${nid()}`, {}), base = between(1500, 7000); push(n, pg, between(3, 12), base); push(n + ' 2026 eligibility', pg, between(5, 16), base * 0.4); });
    ['resume writing masterclass', 'excel for analysts workshop', 'product thinking webinar'].forEach(n => { const pg = page(`/workshops-webinars/${slug(n)}-${nid()}`, {}); push(n, pg, between(1, 5), between(400, 2500)); });
    ['young achiever awards', 'campus leader awards'].forEach(n => { const pg = page(`/awards/${slug(n)}-${nid()}`, {}); push(n + ' 2026', pg, between(1, 5), between(300, 1800)); });
    ['/p/', '/o/'].forEach(pre => { for (let i = 0; i < 4; i++) { const n = pick(hackNames.concat(compNames)), pg = page(`${pre}${slug(n)}-${nid()}`, {}); push(n + ' link', pg, between(2, 9), between(100, 800)); } });

    // ── company & college pages ──
    firms.forEach(f => { const pg = page(`/c/${slug(f)}-${nid()}`, {}), base = between(800, 6000); push(f + ' careers', pg, between(4, 14), base); push(f + ' internship', pg, between(5, 16), base * 0.6); push(f + ' hiring process', pg, between(6, 18), base * 0.4); push(f + ' reviews', pg, between(10, 26), base * 0.3, 0.6); });
    ['northfield institute of technology', 'riverside college of commerce', 'eastgate school of management', 'lakeside university', 'westbrook engineering college'].forEach(c => { const pg = page(`/c/${slug(c)}-${nid()}`, {}); push(c, pg, between(5, 15), between(800, 4000)); push(c + ' fest', pg, between(3, 10), between(300, 1500)); });

    // ── blog, articles, resources ──
    const blogTopics = ['tcs nqt exam pattern', 'infosys interview questions', 'ssc cgl syllabus', 'html interview questions', 'python projects for beginners', 'c programming questions', 'sql interview questions', 'resume format for freshers', 'cover letter for internship', 'aptitude questions with answers', 'java interview questions', 'operating system interview questions', 'group discussion topics', 'self introduction for interview', 'hr interview questions', 'data structures interview questions', 'accenture exam pattern', 'wipro elite nth syllabus', 'capgemini exam pattern', 'excel formulas list', 'dbms interview questions', 'computer networks interview questions', 'cat exam preparation', 'how to write an email for internship', 'case study interview tips', 'product manager interview questions', 'marketing interview questions', 'linkedin profile tips for students', 'salary negotiation tips for freshers', 'difference between c and c++'];
    page('/blog', {}); push('unstop blog', pages[pages.length - 1], between(1, 2), 2500, B);
    blogTopics.forEach((t, i) => {
      const pg = page(`/blog/${slug(t)}`, {}), base = between(15000, 90000) / (1 + i * 0.06);
      push(t, pg, between(2, 13), base, i % 4 === 1 ? 0.35 : 0.9); push(t + ' 2026', pg, between(3, 15), base * 0.3, 0.9); push(t + ' pdf', pg, between(6, 20), base * 0.15, 0.7); push(t + ' for freshers', pg, between(5, 18), base * 0.12);
      if (i % 5 === 0) push('unstop ' + t, pg, between(1, 3), base * 0.02, B);
    });
    ['tcs nqt exam pattern sections and preparation guide', 'top product based companies in india for freshers list', 'how to prepare for campus placements in final year', 'best certifications for computer science students 2026'].forEach(t => { const pg = page('/' + slug(t), {}), base = between(4000, 16000); push(t.split(' ').slice(0, 5).join(' '), pg, between(4, 16), base); });
    [['/resources', 'placement preparation resources'], ['/prep-zone', 'placement prep material'], ['/top-10-product-based-companies-for-freshers', 'top product based companies for freshers']].forEach(([p, q]) => { const pg = page(p, {}); push(q, pg, between(8, 22), between(3000, 12000)); });

    // ── employers: job board and B2B products ──
    const emp = (path, qs) => { const pg = page(path, {}); qs.forEach(([q, v, pos, f]) => push(q, pg, pos + between(-1.5, 1.5), v, f || 1)); return pg; };
    emp('/employers', [['unstop for employers', 1800, 1.2, B], ['unstop recruiter', 1200, 1.3, B], ['hiring platform for freshers', 6000, 14.5], ['campus hiring platform', 4000, 9.8]]);
    emp('/employers/ats-software', [['ats software', 22000, 24.5], ['applicant tracking system india', 6000, 16.2], ['free ats software', 4000, 19.8]]);
    emp('/employers/online-assessment-platform', [['online assessment platform', 9000, 13.4], ['pre employment assessment tools', 4000, 18.2], ['coding assessment platform', 3000, 15.6]]);
    emp('/employers/hackathon-hiring', [['hackathon hiring platform', 1500, 3.4], ['host a hackathon', 3000, 6.1], ['unstop host hackathon', 600, 1.1, B]]);
    emp('/employers/ai-interview', [['ai interview software', 5000, 21.4], ['ai video interview platform', 2500, 17.6]]);
    emp('/employers/campus-hiring', [['campus hiring solutions', 2500, 8.7], ['campus recruitment software', 3000, 12.3]]);
    emp('/saas-pricing', [['unstop pricing', 900, 1.1, B], ['unstop employer pricing', 300, 1.2, B]]);
    emp('/employers/hire-java-developers', [['hire java developers', 4000, 16.8], ['hire java freshers', 1500, 11.2]]);
    emp('/employers/hire-data-analysts', [['hire data analyst', 3000, 18.4], ['hire data analyst freshers', 900, 12.6]]);
    emp('/employers/hire-interns', [['hire interns', 6000, 9.6], ['post internship for free', 5000, 7.1], ['unstop post internship', 500, 1.2, B]]);
    emp('/employers/ai-sourcing-agent', [['ai sourcing tool', 2500, 22.1], ['ai recruiting agent', 1800, 19.6]]);
    emp('/employers/ai-sourcing-agent/jobs-internships-listings-jobboard', [['post jobs for free', 8000, 14.2], ['post internship online', 3500, 9.4]]);
    emp('/employers/ai-sourcing-agent/our-largest-early-talent-community', [['hire freshers india', 5000, 17.8], ['fresher hiring platform', 2200, 12.1]]);
    emp('/employers/hire-react-developers', [['hire react developers', 3500, 19.2], ['hire react js freshers', 900, 13.5]]);
    emp('/employers/employer-branding', [['employer branding platform', 2000, 11.6], ['campus employer branding', 900, 7.4]]);
    emp('/employers/ai-assessment-agent/aptitude-test', [['online aptitude test for hiring', 3000, 15.1], ['aptitude test platform', 1800, 18.3]]);
    emp('/talent-report-2026', [['unstop talent report', 700, 1.1, B], ['gen z hiring report 2026', 1500, 6.2]]);

    // long tail on opportunity, blog and company pages
    const tail = pages.filter(p => !/\/auth|\/saas-pricing|^https:\/\/unstop\.com\/$/.test(p.p));
    const mods = ['for students', 'in delhi', 'in bangalore', 'for btech students', 'with certificate', 'last date', 'eligibility', 'prize money', 'for 2nd year students', 'online free', 'near me', 'reddit'];
    for (let i = 0; i < 420; i++) { const pg = pick(tail); const base = QP.filter(r => r.p === pg.p)[0]; push((base ? base.q.replace(/^unstop /, '') : 'opportunities') + ' ' + pick(mods), pg, between(5, 40), between(40, 1200)); }

    // ── aggregate like Search Console ──
    const byQ = new Map(), byP = new Map();
    const add = (m, k, r) => { const o = m.get(k) || { clicks: 0, impr: 0, posW: 0 }; o.clicks += r.clicks; o.impr += r.impr; o.posW += r.pos * r.impr; m.set(k, o); };
    QP.forEach(r => { add(byQ, r.q, r); add(byP, r.p, r); });
    const fin = (m, key) => [...m.entries()].map(([k, o]) => ({ [key]: k, clicks: o.clicks, impr: o.impr, ctr: o.impr ? o.clicks / o.impr * 100 : 0, pos: o.posW / Math.max(1, o.impr) }));
    const Q = fin(byQ, 'q').sort((a, b) => b.clicks - a.clicks);
    const P = fin(byP, 'p').sort((a, b) => b.clicks - a.clicks);

    // previous period: a little lower overall; blog prep content and internships seasonal, ATS page slipping
    const season = p => /\/blog\//.test(p) ? between(0.7, 0.9) : /\/internship/.test(p) ? between(0.8, 0.95) : /ats-software|online-assessment/.test(p) ? between(1.3, 1.6) : between(0.85, 1.02);
    const prevP = P.map(r => { const f = season(r.p); const clicks = Math.round(r.clicks * f), impr = Math.round(r.impr * between(0.85, 1.05)); return { p: r.p, clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos: Math.max(1, r.pos + (f > 1.2 ? -between(2, 4) : between(-0.5, 1.2))) }; });
    const qPage = new Map(); QP.forEach(r => { if (!qPage.has(r.q)) qPage.set(r.q, r.p); });
    const prevQ = Q.map(r => { const f = season(qPage.get(r.q) || ''); const clicks = Math.round(r.clicks * f), impr = Math.round(r.impr * between(0.85, 1.08)); return { q: r.q, clicks, impr, ctr: impr ? clicks / impr * 100 : 0, pos: Math.max(1, r.pos + (f > 1.2 ? -between(2, 4) : between(-0.6, 1.4))) }; });

    // daily totals: page clicks plus the anonymised share Search Console keeps out of query rows
    const totalClicks = P.reduce((s, r) => s + r.clicks, 0) * 1.08, totalImpr = P.reduce((s, r) => s + r.impr, 0) * 1.15;
    const end = new Date(); end.setDate(end.getDate() - 3);
    const weights = []; let wsum = 0;
    for (let i = 0; i < 90; i++) {
      const dd = new Date(end); dd.setDate(end.getDate() - (89 - i));
      const dow = dd.getDay();
      const w = (0.88 + i / 90 * 0.24) * (dow === 0 ? 0.82 : dow === 6 ? 0.88 : 1.04) * between(0.93, 1.07);
      weights.push([dd.toISOString().slice(0, 10), w]); wsum += w;
    }
    const C = weights.map(([d, w]) => { const clicks = Math.round(totalClicks * w / wsum), impr = Math.round(totalImpr * w / wsum * between(0.96, 1.04)); return { d, clicks, impr, ctr: clicks / impr * 100, pos: between(7.5, 9) }; });
    const Dev = [['MOBILE', 0.78, 0.8], ['DESKTOP', 0.21, 0.19], ['TABLET', 0.01, 0.01]].map(([d, c, i]) => ({ d, clicks: Math.round(totalClicks * c), impr: Math.round(totalImpr * i), ctr: c / i * totalClicks / totalImpr * 100, pos: 0 }));
    return { site: 'unstop.com', siteUrl: 'sc-domain:unstop.com', source: 'demo', sampleOf: 'unstop', start: C[0].d, end: C[C.length - 1].d, days: 90, Q, P, C, Dev, QP, prevQ, prevP };
  }

  window.CW_DEMO = { ...(window.CW_DEMO || {}), unstop: build };
})();
