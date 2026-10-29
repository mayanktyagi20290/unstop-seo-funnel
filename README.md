# Unstop SEO Funnel

Unstop's own copy of Clickwise with a full-funnel layer on top: Search Console visibility by page type,
GA4 organic traffic → signups → engagement → leads, and MoEngage signup quality. Built from the
"SEO Full Funnel Tracking Action Sheet". Everything runs in the browser; nothing is sent to a server.

## Unstop funnel screens (sidebar › Unstop funnel)

| Screen | Route | What it answers |
|---|---|---|
| B2E dashboard | `#b2e` | The employer side on one page in three columns (B2E, B2E (J&I), both): Search Console visibility (brand / non-brand, keyword buckets), GA4 traffic vs last year, demo / contact / employer signups / pricing visits, engagement, PageSpeed, plus the CRM rows still to come. **Copy for Google Sheets** puts exact numbers on the clipboard. Below the table: drop alerts (this week vs last week, with the likely reason), a 16-week trend for B2E vs B2E (J&I), every product (click one to list its landing pages), search topics split brand vs non-brand (counts open the keywords), quick wins in positions 11–20 with the ranking page and next step (one click adds a task to the Action board), and every employer landing page. |
| Folder dashboard | `#board?a=/internship&b=/jobs` | The same one-page dashboard for any folder: type a folder (and optionally a second one to compare) and every section follows it — Search Console visibility, keyword buckets, search topics, quick wins, drop alerts, weekly trend, GA4 traffic and signups, AI assistant traffic, sub-folders and all landing pages. No B2B sales-form leads. |
| Cluster trends | `#trends?by=week&m=students` | Every URL cluster over the last 12 weeks or 12 months: Search Console clicks (all and non-brand), impressions, GA4 organic sessions and student signups, each period against the one before, with the biggest moves up and down. Click a cluster for student signups by landing page, period by period. Copy for Google Sheets. |
| Journeys | `#journeys?f=/internship` | Organic visits that started in a folder or on a page: the page each student signup happened on, the opportunities they registered or applied for, the landing pages with signups and applications, pages viewed, and every GA4 event in those visits (to check event names). |
| Full funnel | `#funnel` | Visibility → Traffic → Signups → Engagement → Leads → Pipeline, every metric with source, owner, cadence, status (Live / Upload / Sample / Not connected / Next phase) and last refresh. Chain table by page type. First-review questions 1 and 2 (3 needs CRM). CSV export of all metrics |
| Section & page analysis | `#focus?c=<cluster>&f=<folder>` or `#focus?u=<path>` | One cluster, one folder inside it, or one landing page through the chain: Search Console (branded vs non-branded, top 3 / top 10 / 11–20, query clusters, quick wins, top queries), GA4 (sessions and new users vs last year, device, states, signups, CVR, register / apply, product clicks, demo + contact) and its landing pages. Picker at the top of every Unstop screen |
| Clusters: branded vs non-branded | `#urlclusters` | Every URL cluster (hackathons, competitions, internships, jobs, quizzes, fests, blog, resources, company pages, employers job board / B2B …) with exact branded vs non-branded clicks, impressions, CTR, position (one Search Console query set per cluster), anonymised clicks shown apart, top 3 / top 10 / 11–20 keyword counts with change, query clusters and quick wins inside each cluster. Rules editable in Funnel setup › URL clusters |
| Reviews | `#reviews?r=weekly|monthly|quarterly|first|attribution` | **Weekly**: leading indicators (impressions, clicks, non-branded clicks, position, top 3 / top 10 / 11–20, pages getting impressions, latest indexation) by page type. **Monthly**: traffic → signups → leads by page type (GA4 vs last year). **Quarterly**: CRM revenue and pipeline by quarter (first touch and in the journey), SEO cost, revenue ÷ cost, and stop / fix / continue / scale suggestions from the evidence. **First review**: the three questions for last month. **Attribution health**: 10 checks across GA4, MoEngage and the CRM (events present, sources captured, journey and first page, GA4 vs MoEngage and GA4 vs CRM reconciliation) with what to fix. Each review has a period bar (with Search Console connected, one click loads the right week / month / quarter for GSC and GA4) and a decisions-and-owners log (browser, CSV export) |
| Visibility by page type | `#visibility` | Share of voice vs the named competitors (default internshala.com, naukri.com, hackerearth.com, careers360.com) on the fixed keyword set from a rank-tracker export (long or wide format), by query cluster and keyword; indexed ÷ submitted per page type from sitemaps plus an upload of indexed counts per sitemap from Search Console's Pages report; GSC impressions, clicks, CTR, position per page type with branded / non-branded split; weekly trend per core type; keyword counts in top 3 / top 10 / 11–20 by page type and query cluster vs previous period; positions 11–20 quick wins; sitemaps vs URLs with impressions per type |
| User acquisition | `#acquisition` | Organic student and employer signups (YoY), student CVR (student-facing pages) and employer CVR (employer-facing pages), cost per student and per employer signup (monthly SEO cost × employer share from Funnel setup), and the quality check: profile completion, 7-day activation and 30-day retention of organic vs other channels with a clear verdict (worse on any measure = volume is not a win), students vs employers. Signups and CVR by cluster, folder, page type or landing page; organic vs other channels |
| Engagement | `#engagement` | Engaged sessions and engagement rate (YoY), pages per session, scroll depth on key pages (90% scroll events ÷ views; 25/50/75% too when a `percent_scrolled` custom dimension exists), return visits within 30 days (weekly cohorts of new organic users, weeks 1–4, vs the same weeks last year), share of organic users who click into an opportunity and who register or apply, and blog & guides → product pages (product page views whose referrer is a blog page ÷ blog views) by destination cluster and by blog page. Breakdown by cluster, folder, page type or landing page |
| Leads & revenue | `#leads` | Employer side. GA4: organic demo requests, contact submissions, pricing-page sessions, employer signups (YoY), where they land (cluster / folder / page), and assisted conversions: demo / contact / employer signups by users first brought by organic search who converted in an email, direct or paid session (GA4 first-user channel × session channel). CRM export (HubSpot, Salesforce, Zoho, LeadSquared column names recognised; stays in the tab): attribution coverage check, MQLs, pipeline and closed revenue with organic as first touch and, separately, organic in the journey, lead → MQL / opportunity / close and win rate against every other channel, by month and by first page seen. Answers first-review question 3 on Full funnel |
| Workstream scorecards | `#scorecards?w=…` | Overview plus one scorecard per workstream. **Technical SEO**: crawl errors by cluster (Screaming Frog / Sitebulb export), Core Web Vitals pass rate and page speed (PageSpeed Insights, mobile, field data, top page per cluster + key pages; optional API key in Funnel setup), indexation (URL Inspection sample per cluster); runs kept in the browser for week-on-week. **Content & programmatic**: publishing log joined with Search Console: published, indexed (getting impressions), traffic after 90 days, clicks per page, by template and month cohort. **Link building**: referring domains gained (Ahrefs / Semrush / Moz export), quality tiers, ranking movement and clicks on target pages. **Content refreshes**: Fix tracker entries measured before vs after at 28 / 56 / 90 days. **AI answers**: prompt-tracker export: mention and citation rate by engine (ChatGPT, Perplexity, Google AI Overviews, Gemini), trend, gaps by query, Unstop pages cited, plus GA4 AI referral sessions |
| GA4 organic | `#ga4` | Organic sessions and new users by page type, URL cluster, device, country and Indian state, plus page type × device and page type × state, all vs the same dates last year; share of organic sessions landing on clusters with a clear conversion path; student / employer signups and CVR; engagement; register/apply; blog → product clicks; demo / contact / pricing; organic vs other channels; AI assistant referrals; every event seen in organic sessions |
| Signup quality | `#quality` | MoEngage live dashboard charts mapped to funnel metrics, plus MoEngage user export: profile completion, 7-day activation, 30-day retention, organic vs other channels, student vs employer, monthly cohorts |
| Funnel setup | `#funnelsetup` | Page-type rules, query clusters, GA4 event names, pricing paths, AI sources, conversion-path page types, monthly SEO cost, MoEngage options, metric owners |

Files: `unstop.js` (pure logic, tested in `tests/unstop.test.js`), `moengage.js` (MoEngage chart parsing and mapping), `unstop-view.js` (screens), `unstop.css`, `moengage-proxy/` (Cloudflare Worker), Unstop defaults in `config.js › unstop`. Browser storage keys use the `un:` prefix so this app never mixes settings with Clickwise on the same github.io origin.

## Top-bar section filter (like Clickwise)

The top bar's **All pages · Change** button narrows the whole app to a section: pick an Unstop cluster (e.g. *Opportunity › Internships*) or a folder inside it (*Opportunity › Internships › /internship*), or type any folder or page. With Search Console connected every report is re-pulled with that page filter (plus an exclusion for narrower clusters, so `/employers` never includes `/employers/hire-*`). On sample data the same filter is applied in the browser.

Clusters are named *Group › Cluster* (Opportunity › Hackathons, Opportunity › Internships, Opportunity › Jobs, College & company › Company & college pages, Content › Blog, B2E (J&I) for the AI sourcing agent, hire-* and free job posting pages, B2E for every other employer product page…), and page tables show the cluster and the folder rule each URL matched.

## Sample data

"Try it with sample data" (or `app.html?demo`) opens an Unstop-shaped sample: unstop.com's real URL structure (hackathons, competitions, internships, jobs, quizzes, fests, company pages, blog, employers job board / B2B, `/saas-pricing`…) with generated numbers, opportunity names and company names (`demo-unstop.js`). GA4, the MoEngage user export and a MoEngage dashboard are filled with sample numbers automatically, so every funnel screen and the cluster split can be shown without signing in. Everything is marked **Sample**. `app.html?demo=trailcraft` keeps Clickwise's original sample site (used by the base browser tests).

## Turning on GA4

Sign-in asks for Search Console **and** Analytics (both read-only) in one pop-up. In the Google Cloud project that owns the OAuth client in `config.js`:
1. APIs & Services › Library › enable **Google Analytics Data API** and **Google Analytics Admin API** (the Admin API only lists properties; without it, type the property ID).
2. OAuth consent screen › Data access › add scope `https://www.googleapis.com/auth/analytics.readonly`.
3. Hosting on `mayanktyagi20290.github.io` is the same origin as Clickwise, so the existing client ID works.

Event names default to `sign_up`, `signup_complete`, `signup_email_verified` and similar. After the first load the GA4 screen lists every event in organic sessions; set the right names in Funnel setup.

## MoEngage

Two ways, both on **Signup quality** (`#quality`):

1. **MoEngage live** — reads charts from a MoEngage custom dashboard (Custom Dashboards API) and maps them to funnel metrics: organic signups, profile completion, 7-day activation, 30-day retention, each with an optional comparison (e.g. organic vs paid). Mapped values show as **Live** on Full funnel and load in the background on every visit. Connect through the Cloudflare Worker in `moengage-proxy/` (key stays on the server; only people who can open Unstop's Search Console or GA4 get data — see `moengage-proxy/README.md`), or directly from the browser with a key kept for that tab only (works only if MoEngage accepts browser calls). Logic in `moengage.js`, tested in `tests/moengage.test.js`.
2. **User export** — a CSV / XLSX from Segments › Export for the deeper cohort view (organic vs other, student vs employer, monthly cohorts). Columns are matched loosely; "Download column template" shows the expected set.

---

# Clickwise base (unchanged features)

Search Console intelligence: ranks SEO, AEO and GEO fixes by the clicks they could add.
Generic for any website — no site-specific logic.

## Files

| File | What it is |
|---|---|
| `index.html` + `landing.css` | Marketing site (hero, features, AI search, pricing, FAQ) |
| `app.html` | The audit tool |
| `styles.css` | Shared design tokens + app styles (light/dark) |
| `config.js` | **Edit this**: app name, Google OAuth client ID, row limits, utility-page hints |
| `engine.js` | Analysis engine (pure functions) |
| `content.js` | Content assistant: topic clusters, content gaps, page improvements, internal links, crawler link exports, briefs (pure functions) |
| `content-view.js` | Content & links screen |
| `titles.js` | Title & meta audit: reads a crawler page export and checks titles, descriptions and H1s against each page's searches (pure functions) |
| `fixes.js` | Fix tracker: before/after windows, measurement against daily noise and the site's own change (pure functions) |
| `fixes-view.js` | Fix tracker screen |
| `opportunities.js` | Opportunity engine: one ranked list with evidence, impact, confidence, effort and warnings (pure functions) |
| `filters.js` | Goal builder engine: validated filter specs, plain-English parser with clarifying questions and data checks, safe text matching (pure functions) |
| `workflows.js` | One-click workflow templates and their runners (pure functions) |
| `views.js` | Report screens and shared table/chart helpers |
| `priority.js` | Growth Priority Score: merges signals about the same issue, scores them on five weighted components, risk path, calibration from measured results (pure functions) |
| `tasks.js` | Task model for the action and measurement loop: statuses, validation, baselines, confounders (pure functions) |
| `tasks-view.js` | Priorities (with the impact × effort matrix), opportunity detail and Action board screens |
| `forecast.js` | Growth forecast and target: observed baseline, de-duplicated opportunity, three scenarios with method, assumptions and confidence; target validation, progress and evidence-based suggestion (pure functions) |
| `explain.js` | Action explanations: why it matters, Search Console and crawler evidence, affected searches and URLs, implementation steps, impact, confidence, effort (pure functions) |
| `command.js` | SEO Growth Command Center at the top of the dashboard |
| `timing.js` / `timing-view.js` | Statistics & Trends › Best day & time (`#stats?tab=timing`): weekday analyzer, recent hourly performance, calendar, spikes and drops, page/search insights, recommendations |
| `stats.js` / `stats-view.js` | Statistics & Trends (`#stats`): totals, WoW/MoM/YoY, weekly/monthly/quarterly trends, winners & losers, rule-based insights and recommendations, CSV report |
| `copilot.js` | Ask Clickwise: maps plain-language questions to existing analyses and answers with evidence (deterministic, no AI model) |
| `surfaces.js` / `surfaces-view.js` | Discover, Google News, Last 24 hours and Indexing |
| `genai.js` / `genai-view.js` | Generative AI report: reads the export of Search Console's Generative AI performance report (no API yet) and joins it with the Performance data (pure functions + screen) |
| `automation.js` | Goal builder, Workflows and workflow-result screens |
| `app.js` | Onboarding, file import, Google sign-in, API pulls, routing |
| `demo.js` | Sample data for a fictional site |
| `privacy.html`, `terms.html` | Needed for Google OAuth verification — review before launch |

## Try it locally

```
python3 -m http.server 8080
```
Open `http://localhost:8080` → "See it on sample data", or `app.html?demo`.

## Turn on "Connect Search Console"

1. Google Cloud Console → new project → enable **Google Search Console API**.
2. OAuth consent screen → External → add scope `.../auth/webmasters.readonly`, your domain, privacy and terms URLs.
3. Credentials → OAuth client ID → Web application → Authorized JavaScript origins: `http://localhost:8080` and your live domain.
4. Paste the client ID into `config.js` (`googleClientId`).
5. Until Google verifies the app, add testers under "Test users" (max 100). Submit for verification (`webmasters.readonly` is a sensitive scope: needs a demo video and a verified domain).

## Deploy

Any static host works: GitHub Pages, Netlify, Vercel, Cloudflare Pages. Use your own domain (Google won't verify a `github.io` origin for branding).

## Analysing one folder or page

With Search Console connected, type a folder (`/blog/`) or a full URL in **Only a folder or page** on the property screen; tick **Exactly this page** for a single URL. Clickwise sends Google a page filter (built and escaped by the app), so every query, page, daily total and comparison covers only that part of the site. For uploads, set the Page filter in Search Console before exporting; Clickwise reads the export's Filters sheet and shows the scope in the top bar.

## Reports

- **Command Center** (dashboard top) — data source (live / uploaded / sample), period and comparison, freshness and coverage; a dismissible **Start here** guide for the first session; **Do today** (five highest-priority open opportunities, the first featured above the fold, each with what it adds to the forecast and a **Why and how** panel: reason, sourced evidence, affected searches and pages, steps, impact, confidence, effort, link to the detail); **Create task** saves in place without leaving the dashboard; **Growth target** keeping four numbers apart — observed clicks now, your target with a deadline, the opportunity found, and the forecast (conservative / expected / optimistic, with its method, assumptions, what was left out and confidence) — progress only once data after the target date is loaded, and a suggested target only when the evidence supports one; **Risks**; **What's working**; **Did our changes work?** (measured change in clicks a month next to the estimate made at creation). Metric definitions are tooltips. Implemented changes are marked on the trend chart
- **Priorities** — every opportunity once, ranked by the Growth Priority Score, with a separate risk list. Filter by priority, category, effort, intent, section and task status. Each row opens a detail page: the issue with current vs previous metrics, evidence (including merged signals), action, estimate and its method, score breakdown and confidence reasons, and **Create task**
- **Action board** — tasks from opportunities or by hand: owner, due date, planned → in progress → implemented → validated (or dropped), what was actually changed and when, baseline captured at creation, observation window of 14/28/56/90 days. Implemented tasks are measured with the fix tracker method and list other changes in the same windows as possible causes; a task can only be validated once it has a measured result. Download / restore a JSON backup
- **Statistics & Trends** (`#stats`, its own page) — date range (7 days, 28 days, 3, 6, 12, 16 months, custom; presets end on the last day of final data and are shortened, with a note, when the history is shorter), weekly / monthly / quarterly views, KPI cards (clicks, impressions, CTR, average position, ranking queries, top-10 rankings) against the previous period and the same dates last year, last complete week / month / year-on-year cards, traffic and ranking trend charts (ranking-query counts per month on request), monthly summary and weekly breakdown, page and search winners & losers (changes within normal variation left out; rows missing from a capped list marked uncertain), insights that keep observed facts apart from possible explanations, recommendations linking to existing reports, and a CSV report. Totals come from daily rows: CTR = clicks ÷ impressions, position weighted by impressions, which matches Search Console's own totals for the same dates. Comparisons appear only when the comparison period is fully inside the history; partial weeks and months are marked and not compared. With Search Console it reads up to 16 months; an upload has only the dates it contains; the sample site's earlier months are generated and labelled as such. Selection is kept in the URL, so links and reloads keep it
- **Best day & time** (Statistics & Trends tab, `#stats?tab=timing`; Google Search Console only) — **Best day of the week** from the last 8–12 complete Monday–Sunday weeks: each week is normalised (a day's share of that week), medians and per-week ranks are used, and a day is called the clear winner only if it beat the runner-up in 75%+ of weeks, so growth or one spike cannot decide it; weekday table (average and median clicks, impressions, CTR = clicks ÷ impressions, impression-weighted position, weeks above average); weekdays vs weekends (typical/median days). **Recent hourly performance** from the Search Analytics API (`dimensions: hour`, `dataState: hourly_all`, about the last 10 days): hour-by-hour chart in the viewer's time zone, last 24 hours vs the 24 before, preliminary hours (from `first_incomplete_hour`) shown lighter, and an hour-of-day chart labelled as descriptive for the few days observed. Optional, off by default: keep final hourly totals in the browser so hour-of-day patterns build up beyond 10 days (site totals only; deleted with Forget this site). **Daily calendar** (five equal groups by clicks), weekly and monthly trends, best and weakest dates, spikes and drops (each day against its weekday share × the level of the surrounding days, so gradual trends are not flagged), last 28 days vs the 28 before. **Pages and searches**: top pages per weekday (date × page rows, top 50,000), searches gaining/losing, high-impression low-CTR pages (vs this site's pages at a similar position), ranking improvements/declines, recent spikes (last 7 days vs the 28 before). Recommendations are rule-based and never suggest publishing at a given day or hour. Without Search Console, hourly and date × page views say they are unavailable and the daily analysis still runs
- **Ask Clickwise** (`#ask`) — answers questions such as “Where am I losing organic clicks?”, “Which five pages should I improve first?”, “Find keywords close to page one”, “Which pages have CTR improvement potential?”, “Which SEO actions remain incomplete?” and “What changed after our last content update?” with the evidence, affected URLs, actions and report links, and states what the data cannot answer. Other requests go to the Goal builder. The dashboard box sends questions here and filter-style requests to the Goal builder
- **Overview** — headline monthly click potential, non-brand KPIs vs previous period, top 3 actions, trend, brand split, sections
- **All opportunities** — every recommendation in one ranked list: the search or page, what was measured (and against which period), why it was picked, an estimated impact range, a confidence level with every reason behind it, the suggested action and its effort, and data warnings. Filter by type, confidence, effort and impact; export to CSV
- **Content & links** — topics (searches grouped by shared words and, with Search Console connected, by the page they rank with), content gaps (topics with enough impressions where nothing reaches page one, only the homepage ranks, impressions are split across pages about the topic or between the matching page and unrelated ones, or question searches go unanswered), pages to improve (searches each page ranks 4–20 for), internal links (sources already rank on page one for the same topic; anchor text is the target's own search) and briefs drafted by fixed rules from real searches. Upload a crawler's link export (Screaming Frog All Inlinks, or any CSV with source and destination columns) to drop links that already exist; it stays in memory. Nothing is invented: every URL, search and number comes from the data, and impressions are the site's own, not market demand. Without query-page data (an export) it falls back to searches alone and folder-based link sources, and says so
- **Titles & metas** (Content & links tab) — upload a crawler page export (Screaming Frog › Internal › HTML, or any CSV with URL and title columns). Every crawled page is checked for a missing, short or cut-off title (pixel width when the crawler gives it), missing or cut-off meta descriptions, duplicate titles and descriptions, missing H1, non-200 or non-indexable pages that still get impressions, and — with Search Console connected — whether the title contains the search that brings most of the page's impressions. A starting-point title is the page's main search in title case with its existing brand suffix; nothing else is added. Pages are ordered by impressions; Titles to rewrite shows each page's current title. The same upload box takes a link export
- **Fix tracker** — one list with the Action board: tasks marked Implemented appear here automatically, and a change logged in both places is measured once. Log the day a change went live (one page, or the whole site); Clickwise compares up to 28 days before with the same number after, leaving out the change day. A result is "Worked" or "fell clearly" only when the change in daily clicks is at least two standard errors and at least 10% beyond the site's own change over the same days; smaller moves are "leaning" or "no clear change". With Search Console it fetches that page's daily data and shows which searches gained or lost clicks; sample data uses generated daily page numbers; an export can only measure whole-site changes. "Track this fix" on any item in All opportunities fills it in. The list is kept in the browser; results are never stored
- **Branded report** (Workflows › Opportunity report, or Print) — a white-label summary for clients: your agency name, contact line, logo and colour, the client's name and logo, and your notes. Page one holds the headline numbers (with change against the previous period when loaded), what changed, where the growth is, the top 5 medium- or high-confidence actions (same list and numbers as All opportunities) and results of tracked fixes; an optional second page lists declines, searches closest to the top 3, content gaps, internal links and the title audit. Saves as an A4 PDF from the browser's print dialog. Agency branding is kept once for all clients, client branding per site, both in this browser; logos are redrawn on a canvas as small PNGs (only pixels are kept). "Made with Clickwise" can be turned off
- **Action plan** — every recommendation ranked by clicks/month, printable
- **Almost page one** — non-brand queries at positions 4–20, gain if moved to top 3 / top 7
- **Titles to rewrite** — page-one pages/queries under benchmark CTR, with each page's top searches (API)
- **Competing pages** — exact query × page cannibalisation (API) or stem-based estimate (file)
- **Losing ground** — page/query decay vs previous period with likely cause; gaining pages. Works with Search Console connected, with an Excel export made using Date › Compare, or with two exports (this period and the previous one) uploaded together
- **Generative AI report** (`#genai`) — impressions of your pages in AI Overviews, AI Mode and Discover AI features, from the report's export (Search Console has no API for it yet; a link opens the report for the current property and folder). Joined with the Performance data: each page's AI share of its impressions and the AI share by day (only when both cover the same dates), and page-one pages with real demand that never appear in AI features (only when the export is complete and the dates match, within the export's page filter). Countries and devices. Drop the export onto the tab (or choose it); with “Remember this report in this browser” ticked it reopens inside Clickwise next time, and Forget this site removes it. Google offers no API and does not allow its pages inside other sites, so downloading the export is the one step outside Clickwise. The sample site has generated sample data
- **AEO & GEO signals** — AI Overview suspects, question/conversational/comparison/freshness queries, position-one holders, readiness score
- **Workflows** — one-click templates: quick wins, branded vs non-branded, positions 4–20, high-impression low-CTR pages, traffic declines, questions, page types, location keywords, cannibalisation candidates, internal-link targets, ignored searches, opportunity report. Each lists the data it needs, its thresholds and its output; saved per site in the browser
- **Goal builder** (`#filters`) — describe an SEO task in plain English (“which pages should I fix first”, “quick wins in the blog folder”, “internship keywords in Delhi with more than 1,000 impressions and position 5 to 15”). A deterministic parser turns it into conditions shown as chips; click a chip to change it with normal controls, remove it, or add more. Opportunity goals (quick wins, titles to rewrite, competing pages, answer boxes, losing clicks, early warnings, confidence, estimated clicks a month, top N) use the opportunity engine, so numbers match All opportunities. When a request is ambiguous it asks a short question with one-click answers (a number with no metric, an unrecognised word, searches or pages); when the loaded data cannot answer part of it (one device, searchers' location, a different date range, a comparison period, which page ranks for a search) it says so and offers the alternative instead of dropping it silently. Contradictory conditions are refused. The preview shows the count, how each condition narrows the list, and the first 10 rows; **Run workflow** executes it and reports status; **Save workflow** keeps it under Workflows with its run history. Every text value is matched as plain text; an optional Advanced panel shows how to recreate the filter in Search Console
- **Queries / Pages / Site clusters / Search intent**

Old `#regex` links redirect to the Goal builder.

## Tests

```
npm install                 # once: test tools only, nothing is needed to deploy
npx playwright install chromium   # once, if Chromium is not installed
npm test                    # = node tests/run.js  (unit, regression, browser)
npm run test:fast           # unit + regression only, no browser
```

- `tests/unit.test.js` — metrics, monthly scaling, brand matching, CTR calibration, outlier caps, results-page flags, de-duplication, sitelink and utility pages, parser, validation, special characters.
- `tests/opportunities.test.js` — opportunity engine: growth total equals the headline, each search counted once, recovery maths, confidence rules and determinism, period scaling, row-limit bounds, early warnings, ranking-page evidence, data warnings, empty data.
- `tests/goals.test.js` — Goal builder: supported requests (including the brief's example), opportunity goals matching the engine, clarifying questions, data the loaded analysis cannot answer, contradictions and invalid goals, literal text matching, preview vs run, run records, saved goals, comparison scaling.
- `tests/content.test.js` — content assistant: clustering rules, determinism and speed (100,000 searches), each gap rule, page improvements, link sources and anchors, no invented URLs or anchors, crawler exports (Screaming Frog, tab/semicolon, quotes, BOM, wrong files), export-only mode, briefs from real searches, totals unchanged, Goal builder and links workflow.
- `tests/fixes.test.js` — fix tracker: validation, windows, clear rise and fall, a site-wide rise not credited to the fix, noise not reported as a result, too early and too little traffic, missing days as zero, whole-site fixes, query shifts, sample daily data.
- `tests/titles.test.js` — title & meta audit: Screaming Frog and minimal CSVs, wrong files, main search missing from the title, length (characters and pixels), missing pieces, duplicates, non-indexable pages, suggestions from the real main search, ordering, no invented URLs, export-only mode.
- `tests/regression.test.js` — an anonymised real 3-month export: site totals, coverage, non-brand figures and estimate sanity checks. The fixture holds a real site's numbers, so it is **gitignored** and the suite skips without it. Create one locally with `node tools/anonymize-export.js <export.xlsx> <brand> tests/fixtures/real-export-anon.json`.
- `tests/forecast.test.js` — forecast and target: recoverable vs demand, noise and row-limit declines; growth and recovery on the same page counted once; contributions add up to the forecast; scenario order; empty data; target validation, progress and feasibility edge cases; suggestion rules; explanations for every opportunity type, with crawler evidence; the shared change log; task storage round trip.
- `tests/genai.test.js` — Generative AI report: export parsing (Excel serial dates, CSV, duplicates), refusing the Performance export, page-filter scope, shares only for matching dates, URL forms, pages not shown in AI features (row limit and filter respected), the Search Console deep link, deterministic sample.
- `tests/browser.test.js` — Playwright: the Command Center workflow (top action above the fold, explanations, inline Create task persisting after reload, target validation and persistence, guide, Fix tracker sync, impact × effort matrix), every screen and workflow on sample data, mobile width, Excel and CSV upload, set-aside pages, print, CSV export safety, Forget this site.
- `tools/anonymize-export.js` turns any Performance export into a fixture (numbers kept; query words, URLs and brand replaced).

Scheduled workflows, email alerts and an AI fallback for the filter parser need the backend below; nothing in the app pretends otherwise.

## How estimates work

All opportunity figures are clicks per month, shown as a low–high range. Expected CTR at each position is the site's own impression-weighted CTR where it has at least 30 non-branded queries and 10 clicks (never below 20% of the benchmark), and an industry benchmark elsewhere (never higher than the position above). A query keeps its own click rate relative to its position, so searches answered on the results page are not projected to a full top-3 CTR, and are flagged. No single query may contribute more than 10% of a list. The headline counts each query once; page estimates overlap query estimates and are never added to it. Pages that look like branded sitelinks or utility pages are set aside with the reason, and users can include them again.

**Forecast.** Observed baseline = monthly clicks from the loaded period's daily totals (all searches). Opportunity = growth (each search once, its largest estimate) + recovery (recoverable page declines only). Not every decline is recoverable: a fall in impressions while rank held (likely lower demand), a drop within normal variation (under 2 × √previous clicks) and a page missing from an export at its row limit are shown but never counted. When a growth search mostly ranks on a declining page, the overlap is taken off that page's recovery so the clicks are counted once. Conservative = low ends of High and Medium confidence items; expected = their mid-points plus Low items' low ends; optimistic = every high end. Seasonality, demand changes and Google updates are not modelled, and every scenario assumes the work is done. Each Do today item shows its contribution after overlaps; the contributions add up to the optimistic total.

**Targets.** A target needs a monthly click number above today's baseline and a date 14 days to two years away. Progress uses data that ends after the target was set (the last 28 days as a monthly rate) against the share of time used. A target is suggested only with real dates, 28+ days of data and at least three High or Medium confidence opportunities adding 3% or more; otherwise the reason is shown.

**Comparing periods.** When the previous period has a different length, its clicks and impressions are scaled to this period's length before comparing (CTR and position are rates and are not scaled). When a list reached its row limit (1,000 rows in an export), a page or search missing from it is not assumed to have zero clicks: it is counted at the smallest row in that list and marked "upper bound". Pages that lost a quarter of their clicks count as declining; smaller moves in position, impressions or CTR show as early warnings. Recovery estimates assume 30–80% of lost clicks return.

**Confidence.** Every opportunity starts at 50 and gains or loses points for fixed reasons, all shown next to it: days of data; how many clicks were expected at its position (≥100: +20, ≥30: +10, ≥10: 0, fewer: −15, because a CTR gap measured on a few clicks is mostly noise); whether expected CTR comes from the site's own clicks or a benchmark; a likely results-page feature; a capped estimate; for declines, whether the drop is larger than normal variation (about √n clicks), whether periods differ in length, and whether the current figure is only an upper bound. 70+ is High, 45–69 Medium, below 45 Low. Causes that are inferred rather than measured (an answer box or AI Overview guessed from CTR; competing pages guessed from wording) are capped at Medium and Low. The Quick wins workflow and the printed report use the same scores.

## Growth Priority Score

Built on the opportunity engine. **Merging:** items about the same search (e.g. almost page one, low CTR and a decline for one query) become one opportunity led by the item with the largest estimate; a page's title estimate joins the low-CTR search it mostly ranks for (≥50% of impressions); a search's decline joins its ranking page's decline. Content gaps and internal links stay separate (different fixes). Nothing is dropped: merged items appear as evidence.

**Score (0–100)** = Σ (weight ÷ total weight × component) × 100, then × a calibration factor. Components, each 0–1:

| Component | Default weight | How it is measured |
|---|---|---|
| Impact | 40 | Mid-point of the monthly click estimate, log scale against the largest in the list; 0 for checks without an estimate |
| Confidence | 25 | The opportunity's confidence score ÷ 100 |
| Relevance | 15 | 1 inside a priority section or term you set, 0.3 outside; 0.5 for all when none are set. No conversion data is assumed |
| Time to impact | 10 | By type: title/snippet 0.9, technical fix of a vanished page 0.9, internal links 0.7, page-one ranking 0.6, answer box 0.6, refresh 0.5, merge 0.45, page two 0.35, new content 0.2 |
| Effort | 10 | Low 1, Medium 0.6, High 0.25 |

P1 ≥ 60, P2 ≥ 42, P3 below. Weights, priority sections and terms are set per site on the Priorities screen; each row says what lifted or held it back. **Calibration:** once a category has 3+ tasks measured over their full window, its scores are multiplied by 0.7 + 0.6 × the smoothed share of changes that improved clicks ((improved + 1) ÷ (measured + 2)), so ×0.7 to ×1.3. **Risk path:** declines (critical when a page with 20+ clicks vanished, otherwise by confidence), early warnings and failed URL inspections on pages with clicks are listed separately, whatever their growth score.

## What is stored, and what would need a backend

Everything runs in the browser. Search data is never stored; the access token stays in memory and the scope is read-only (`webmasters.readonly`). Stored per site in localStorage: settings, a Generative AI report export only when you tick “Remember”, saved goals and workflows, tracked fixes, tasks (with baselines and final verdicts), priority weights/sections/terms and the growth target. "Forget this site" deletes them all.

Needs a server (not built): tasks shared between people or devices, scheduled monitoring and alerts, history beyond Search Console's 16 months, measuring results without reconnecting, GA4 or other conversion data for business relevance, and monitoring of AI answers (AI visibility here is inferred from CTR and labelled as such).

## Deployment steps

1. `npm install && npx playwright install chromium && npm test` — all suites must pass.
2. Bump the `?v=` number on every script and stylesheet in `app.html` when files change (cache busting).
3. Commit and push to `main`; GitHub Pages serves the repository root. No build step.
4. Open `app.html?demo` on the live site and check Command Center, Priorities, a detail page, the Action board and Ask Clickwise.

## Roadmap (paid tier)

Backend (e.g. Next.js + Supabase) for refresh tokens and daily sync → history beyond 16 months, weekly email digest, GA4 join, multi-property, team seats, white-label PDF, billing (Razorpay / Stripe).
