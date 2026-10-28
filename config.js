// ──────────────────────────────────────────────────────────────
// Unstop SEO configuration — edit these before deploying.
// ──────────────────────────────────────────────────────────────
window.CW_CONFIG = {
  appName: 'Unstop SEO',

  // OAuth 2.0 Web client ID from Google Cloud Console
  // (APIs & Services › Credentials). Add your site's origin, e.g.
  // https://yourdomain.com, under "Authorized JavaScript origins".
  // Enable "Google Search Console API" in the same project.
  googleClientId: '303461488867-0bmr9c2749ebh6n8uvkmes7q1bfguopo.apps.googleusercontent.com',

  // Rows pulled per dimension through the API (GSC returns 25,000 per page).
  maxRows: 100000,

  // Rows pulled for the query × page report used by cannibalisation.
  maxQueryPageRows: 25000,

  // Default URL fragments treated as non-SEO pages (login, account, cart…).
  defaultExcludes: ['/login', '/signin', '/sign-in', '/signup', '/register', '/account', '/cart', '/checkout', '/auth/'],

  // URL words that suggest a dashboard, account or other utility page. Matching pages are
  // set aside from title-rewrite advice with the reason shown, and users can include them again.
  // ── Unstop full-funnel settings (defaults; editable in the app under Funnel setup) ──
  unstop: {
    // Search Console property used by default in the property picker
    defaultProperty: 'sc-domain:unstop.com',
    // Searches containing any of these count as branded
    brandTerms: ['unstop', 'un stop', 'unstop.com', 'dare2compete', 'dare 2 compete', 'd2c'],
    // GA4 property ID (numbers only, from GA4 Admin › Property details). Can also be chosen after sign-in.
    ga4PropertyId: '254253801',
    // B2B Form Leads Google Sheet (sales-form leads, used as the CRM for B2E). Read-only.
    salesSheet: '1OGpQV0MR0y5MV1Ronb59VBrIW1hhhn6rPlHMxYg6Yho',
    // GA4 event names. After connecting GA4 the app lists every event seen in organic sessions so these can be corrected.
    events: {
      studentSignup: ['sign_up', 'signup_complete', 'signup_email_verified'],
      employerSignup: ['employer_sign_up', 'recruiter_signup'],
      demoRequest: ['book_demo', 'demo_request', 'generate_lead'],
      // not GA4's automatic form_submit: it fires on every form (search, login, registration)
      contactSubmit: ['contact_form_submit', 'contact_submit'],
      opportunityAction: ['register', 'apply', 'opportunity_register', 'apply_now'],
      productClick: ['select_content', 'opportunity_click', 'cta_click'],
      oppClick: ['opportunity_click', 'view_opportunity', 'select_item', 'opportunity_view'],
      scroll: ['scroll']
    },
    // Page paths treated as the employer pricing page
    pricingPaths: ['/saas-pricing', '/employers/pricing', '/pricing'],
    // Sources counted as AI assistants / answer engines in GA4 referral traffic
    aiSources: ['chatgpt', 'openai', 'perplexity', 'gemini', 'bard', 'copilot', 'claude', 'deepseek', 'meta.ai', 'you.com', 'phind', 'grok']
  },

  utilityHints: ['dashboard', 'admin', 'panel', 'account', 'accounts', 'my-account', 'profile', 'settings', 'login', 'logout', 'signin', 'sign-in', 'signup', 'sign-up', 'register', 'auth', 'cart', 'checkout', 'billing', 'inbox', 'notifications', 'wp-admin', 'preview']
};
