/* ============================================================
   STATE.JS — Centralised app state, DB cache, and constants
   All modules read/write these shared objects.
   Loaded first so every subsequent script can reference them.
   ============================================================ */

/* ── App-level UI state ─────────────────────────────────── */
window.AppState = {
  user:          null,   // Supabase Auth user object
  profile:       null,   // profiles table row

  /* Navigation */
  currentScreen: 'tasks',
  currentTab:    'tasks',
  previousTab:   'tasks',
  navStack:      [],

  /* DB cache — single source of truth.
     All reads should reference AppState, not window._db directly.
     dbLoad* functions write here AND keep window._db in sync for
     legacy call-sites that haven't been migrated yet.            */
  campaigns:    [],
  tasks:        [],
  applications: [],

  /* Computed UI state */
  unreadMessageCount: 0,   // derived from _msgReadState on every write

  /* Set of campaign IDs the creator has dismissed ("Not interested").
     Seeded from localStorage on init; written back on every dismiss.
     Mirrors Billo's billo_hidden_campaigns persistence key.        */
  hiddenCampaigns: new Set(),
};

/* ── Database row cache (legacy alias — kept for back-compat) */
window._db = {
  campaigns:    [],   // always === AppState.campaigns
  applications: [],   // always === AppState.applications
  tasks:        [],   // always === AppState.tasks
  payouts:      [],
  referrals:    [],
  notifications:[],
  videos:       [],
};

/* ── Seed hiddenCampaigns from localStorage ─────────────── */
(function _seedHiddenCampaigns() {
  try {
    const raw = localStorage.getItem('vyralist_hidden_campaigns');
    if (raw) {
      const ids = JSON.parse(raw);
      if (Array.isArray(ids)) AppState.hiddenCampaigns = new Set(ids);
    }
  } catch (e) {
    AppState.hiddenCampaigns = new Set();
  }
})();

/* ── Recompute unreadMessageCount from _msgReadState ────── */
function syncUnreadCount() {
  const count = Object.values(window._msgReadState || {}).filter(v => !v).length;
  AppState.unreadMessageCount = count;
  /* Update nav badge live — mirrors Billo badge derivation from state */
  if (typeof updateNavBadge === 'function') updateNavBadge();
}

/* ── Profile completeness signals ────────────────────────── */
window._profileSignals = {
  hasName:     false,
  hasTags:     false,
  hasShipping: false,
  hasPaypal:   false,
  hasPitch:    false,
  hasPhoto:    false,   // set true by handleAvatarUpload on success
};

/* ── Video data store (local demo + merged DB data) ─────── */
window.videoData = [];

/* ── Task campaign definitions ───────────────────────────
   Hardcoded entries are the permanent fallbacks (pitch, and
   any mock campaign used in development). Real campaigns are
   merged in by renderTaskCampaignData() after every
   dbLoadCampaigns() call, so live DB data always wins.      */
window.TASK_CAMPAIGNS = {
  java: {
    name:              'Tim Hortons – Lifestyle Coffee Reel',
    reward:            '$30 + free product',
    requiresShipping:  true,
    emoji:             '☕',
    organic_posting:   true,
    orgRewardExtra:    '+$15',
    photos_required:   true,
    photoRewardExtra:  '+$40',
    brief_document_url:'https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF1.pdf',
  },
  rogers: {
    name:              'Rogers – Mobile App Demo 30s',
    reward:            '$45',
    requiresShipping:  false,
    emoji:             '📱',
    organic_posting:   false,
    orgRewardExtra:    '',
    photos_required:   false,
    photoRewardExtra:  '',
    brief_document_url:'',
  },
  pitch: {
    name:              'Upload your video pitch',
    reward:            '',
    requiresShipping:  false,
    emoji:             '🎬',
    organic_posting:   false,
    orgRewardExtra:    '',
    photos_required:   false,
    photoRewardExtra:  '',
    brief_document_url:'',
  },
};

/* ── Sync AppState cache ← _db (called by every dbLoad*) ──
   Keeps AppState.campaigns / tasks / applications in step
   with window._db without duplicating fetch logic.          */
function syncAppStateCache() {
  AppState.campaigns    = window._db.campaigns;
  AppState.tasks        = window._db.tasks;
  AppState.applications = window._db.applications;
}

/* ── Pending apply context (screening flow) ─────────────── */
window._pendingApply = null;

/* ── Pending upload refs ─────────────────────────────────── */
window._pendingTaskFile   = null;
window._pendingTaskPath   = null;
window._pendingPhotoFiles = [];

/* ── Message read-state (populated from DB via dbLoadConversations) ── */
window._msgReadState = {};
/* Unread count starts at 0; syncUnreadCount() updates it after DB load */
AppState.unreadMessageCount = 0;

/* ── Active chat conversation id ──────────────────────────── */
window._activeChatId = null;

/* ── Misc runtime flags ──────────────────────────────────── */
window._selectedOrgPlatform = null;
window._activeBriefUrl      = null;

/* ── Pagination / navigation state ──────────────────────── */
window._navStack  = [];
/* currentTab / previousTab as window properties so all scripts share
   the same binding without relying on let-in-global-scope semantics.
   AppState.currentTab / previousTab are kept in sync by showScreen(). */
window.currentTab  = 'tasks';
window.previousTab = 'tasks';
