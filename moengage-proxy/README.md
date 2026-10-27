# MoEngage proxy (Cloudflare Worker)

The Unstop SEO app is a static site, so a MoEngage API key placed in it would be readable by anyone.
This small Worker holds the key instead and passes through only three read-only calls of MoEngage's
Custom Dashboards API:

| Proxy path | MoEngage call |
|---|---|
| `GET /dashboards` | List Dashboards |
| `GET /dashboards/{id}/charts` | Get Dashboard Charts |
| `GET /dashboards/{id}/charts/{chartId}` | Get Chart Data (`?cache=false` recomputes) |

A request is answered only when it carries a Google access token that can open the Unstop Search
Console property (or the GA4 property, if `GA4_PROPERTY` is set). That is the token the app already
has after **Connect Search Console** or **Connect GA4**, so nobody outside the team gets MoEngage numbers.

## 1. Create the MoEngage API key
MoEngage › Settings › Account › APIs:
- copy the **Workspace ID** (App ID);
- create an API key with **Dashboard & Analyze** ticked;
- note the data centre: the number in your dashboard address, e.g. `dashboard-01.moengage.com` → `01`.

If MoEngage's API firewall (IP allow-list) is on for your workspace, Cloudflare's outbound IPs are not
fixed; ask MoEngage to exempt the Dashboard & Analyze key, or run the same code on a host with a fixed IP.

## 2. Deploy (free Cloudflare account is enough)
```
cd moengage-proxy
npx wrangler login
# edit wrangler.toml: MOE_DC, ALLOWED_ORIGINS, GSC_PROPERTY (and GA4_PROPERTY if wanted)
npx wrangler secret put MOE_WORKSPACE_ID
npx wrangler secret put MOE_API_KEY
npx wrangler deploy
```
Wrangler prints the address, e.g. `https://unstop-moengage-proxy.<account>.workers.dev`.
Open `<address>/health` from the app's page origin to check it answers (`configured: true`).

## 3. Connect in the app
Signup quality › MoEngage live › Connect MoEngage › **Through the Unstop proxy** › paste the address ›
Save and connect › choose the SEO dashboard › map charts to funnel metrics › Save mapping.

## Suggested MoEngage dashboard ("SEO funnel")
- **Sign-ups by source** (Session & Source or Behavior on the sign-up event, split by UTM source / medium) → *Organic signups*
- **Sign up → Profile completed** (Funnel, split by acquisition source) → *Profile completion*
- **Sign up → Registered / Applied within 7 days** (Funnel, 7-day window) → *7-day activation*
- **Retention of new signups** (Retention, split by source, Day 30) → *30-day retention*

Each chart keeps the date range and segment saved in MoEngage; set them to match the GSC/GA4 period
you review (for example last month).
