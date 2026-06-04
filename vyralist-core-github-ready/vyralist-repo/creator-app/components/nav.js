/* ============================================================
   NAV.JS — Screen switching, back stack, onboarding flow,
   bottom-nav active state, sub-screen routing.
   ============================================================ */

/*
 * TAB ORDER — must match the DOM order of nav-items so the sliding
 * pill can compute its translate offset by index.
 */
const NAV_TABS = ['tasks', 'offers', 'messages', 'portfolio', 'profile'];

/* ── Sliding pill background ─────────────────────────────── */
/*
 * Billo's nav has an absolutely-positioned pill that slides between
 * tabs using CSS transform: translateX(). It sits behind the icons and
 * labels and is driven purely by JS on each tab switch.
 *
 * Implementation:
 *   - One <div id="nav-sliding-pill"> is injected into #bottom-nav once.
 *   - On every showTab() call, _moveSlidingPill(tab) translates it to
 *     the centre of the newly active nav item.
 *   - CSS handles the easing (transition: transform .25s cubic-bezier).
 */
function _ensureSlidingPill() {
  if (document.getElementById('nav-sliding-pill')) return;
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  const pill = document.createElement('div');
  pill.id = 'nav-sliding-pill';
  pill.style.cssText =
    'position:absolute;top:50%;transform:translateY(-50%) translateX(0px);' +
    'height:36px;border-radius:18px;background:var(--brand-soft);' +
    'transition:transform .25s cubic-bezier(.4,0,.2,1),width .25s cubic-bezier(.4,0,.2,1);' +
    'pointer-events:none;z-index:0;';
  // Insert as first child so it renders behind nav items
  nav.insertBefore(pill, nav.firstChild);
}

function _moveSlidingPill(tab) {
  const pill = document.getElementById('nav-sliding-pill');
  const nav  = document.getElementById('bottom-nav');
  if (!pill || !nav) return;

  const navEl = document.getElementById('nav-' + tab);
  if (!navEl) { pill.style.display = 'none'; return; }

  pill.style.display = '';

  // Measure the nav item's centre relative to the nav bar
  const navRect  = nav.getBoundingClientRect();
  const itemRect = navEl.getBoundingClientRect();
  const itemCentreX = itemRect.left + itemRect.width / 2 - navRect.left;

  const pillWidth = Math.max(itemRect.width - 8, 44);
  pill.style.width = pillWidth + 'px';
  // translateX centres the pill under the item; translateY(-50%) keeps it vertically centred
  const translateX = itemCentreX - pillWidth / 2;
  pill.style.transform = 'translateY(-50%) translateX(' + translateX + 'px)';
}

/* ── showScreen() — canonical single entry point ─────────── */
/*
 * ALL tab switches must go through showScreen() so AppState.currentScreen
 * is always kept in sync. showTab() is now a thin alias that calls
 * showScreen() — call sites that still use showTab() continue to work.
 */
function showScreen(tab) {
  /* Clear inline styles openChat() injects on #screen-chat via cssText.
     Without this, display:flex in the inline style beats the CSS display:none
     from removing .active, leaving the chat screen rendered in the document
     flow and scrollable from every other screen. */
  const chatScreenEl = document.getElementById('screen-chat');
  if (chatScreenEl) chatScreenEl.style.cssText = '';

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const nav = document.getElementById('bottom-nav');
  if (nav) nav.style.display = 'flex';

  const screenEl = document.getElementById('screen-' + tab);
  if (screenEl) screenEl.classList.add('active');

  const navEl = document.getElementById('nav-' + tab);
  if (navEl) navEl.classList.add('active');

  // Keep AppState in sync — this is the fix for the bypass bug
  if (window.AppState) {
    AppState.previousScreen = AppState.currentScreen;
    AppState.currentScreen  = tab;
  }
  previousTab = currentTab;
  currentTab  = tab;

  /* ── Bug 1 fix: fire deferred-load listeners registered via _onTabActivate ── */
  if (window._tabActivateListeners?.[tab]) {
    window._tabActivateListeners[tab].forEach(fn => fn());
  }

  if (tab === 'messages') renderMessages();

  _ensureSlidingPill();
  _moveSlidingPill(tab);
  updateNavActiveStyle(tab);
  updateNavBadge();
}

/* showTab() — alias for showScreen() for full backwards compatibility */
function showTab(tab) {
  return showScreen(tab);
}

/* ── Sub-screen (push onto nav stack) ─────────────────────── */
function showSubScreen(id) {
  const from = _activeScreenId() || currentTab || 'profile';
  window._navStack.push(from);
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  if (id === 'about')           restoreProfileTags();
  if (id === 'shipping')        _prefillShippingForm();
  if (id === 'video-pitch')     { if (typeof initVideoPitchScreen === 'function') initVideoPitchScreen(); }
  if (id === 'tutorial-video')  {
    const tv = document.getElementById('tutorial-bg-video');
    if (tv) { tv.pause(); tv.currentTime = 0; }
    const btn = document.getElementById('tv-play-btn');
    if (btn) btn.style.display = 'flex'; /* reset play button */
  }
}

/* ── Auth-only screen switch (no nav stack) ─────────────── */
function showOnlyScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');

  if (id === 'screen-login-existing') {
    const btn = document.getElementById('login-submit-btn');
    if (btn) { btn.textContent = 'Log in'; btn.disabled = false; }
    const email = document.getElementById('login-email');
    const pw    = document.getElementById('login-password');
    if (email) email.value = '';
    if (pw)    pw.value    = '';
  }
  if (id === 'screen-login') {
    const btn = document.getElementById('signup-submit-btn');
    if (btn) { btn.textContent = 'Sign up & start exploring'; btn.disabled = false; }
  }
}

/* ── Back button (pops nav stack) ────────────────────────── */
function goBack() {
  const stack = window._navStack || [];
  const top   = stack[stack.length - 1];

  if ((top === 'task-detail' || previousTab === 'task-detail') && window._activeTask) {
    stack.pop();
    openTaskDetail(window._activeTask.id);
    return;
  }

  const target   = stack.pop() || previousTab || 'profile';
  const mainTabs = ['tasks','offers','messages','portfolio','profile'];
  if (mainTabs.includes(target)) {
    showScreen(target);
  } else {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + target);
    if (el) el.classList.add('active');
    else showScreen('profile');
  }
}

/* ── Active screen ID helper ─────────────────────────────── */
function _activeScreenId() {
  const active = document.querySelector('.screen.active');
  return active ? active.id.replace(/^screen-/, '') : null;
}

/* ── Bottom-nav pill style for To-do tab ─────────────────── */
function updateNavActiveStyle(tab) {
  const tasksNav = document.getElementById('nav-tasks');
  if (!tasksNav) return;
  const iconWrap = tasksNav.querySelector('.nav-icon-wrap');
  tasksNav.style.flexDirection = '';
  if (iconWrap) {
    iconWrap.style.background    = '';
    iconWrap.style.borderRadius  = '';
    iconWrap.style.padding       = '';
    iconWrap.style.width         = '';
    iconWrap.style.height        = '';
  }
  if (tab === 'tasks') {
    tasksNav.style.flexDirection = 'row';
    if (iconWrap) {
      iconWrap.style.background    = 'var(--brand-soft)';
      iconWrap.style.borderRadius  = '16px';
      iconWrap.style.padding       = '6px 14px';
      iconWrap.style.width         = 'auto';
      iconWrap.style.height        = 'auto';
    }
  }
}

/* ── Message / notification nav badge ────────────────────── */
/*
 * Badge is driven by _msgReadState (populated by dbLoadConversations).
 * The hardcoded "2" in HTML is ignored — updateNavBadge() runs on
 * every showScreen() call and after every DB sync via syncUnreadCount().
 */
function updateNavBadge() {
  const badge = document.querySelector('#nav-messages .nav-badge');
  if (!badge) return;
  const unread = Object.values(window._msgReadState || {}).filter(v => !v).length;
  badge.textContent   = unread > 0 ? String(unread) : '';
  badge.style.display = unread > 0 ? '' : 'none';
}

/* ── Notification bell badge ─────────────────────────────── */
function updateNotifBadge() {
  const count     = (window._db.notifications || []).filter(n => !n.read).length;
  const bellBadge = document.getElementById('notif-badge');
  if (!bellBadge) return;
  if (count > 0) {
    bellBadge.textContent   = count > 99 ? '99+' : String(count);
    bellBadge.style.display = 'block';
  } else {
    bellBadge.style.display = 'none';
  }
}

/* ── To-do tab sub-tabs ──────────────────────────────────── */
function switchTodoTab(tab, el) {
  document.querySelectorAll('.todo-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  document.getElementById('todo-overview').style.display  = tab === 'overview' ? 'block' : 'none';
  document.getElementById('todo-shoot').style.display     = tab === 'shoot'    ? 'block' : 'none';
  document.getElementById('todo-applied').style.display   = tab === 'applied'  ? 'block' : 'none';
  document.getElementById('todo-completed').style.display = tab === 'completed'? 'block' : 'none';
}

/* ── Onboarding flow ─────────────────────────────────────── */
let currentOnboardSlide = 0;

function goOnboard() {
  currentOnboardSlide = 0;
  renderOnboardSlide(0);
  showOnlyScreen('screen-onboard');
}

function goSignup() {
  localStorage.setItem('vyralist_onboarded', '1');
  showOnlyScreen('screen-splash');
}

function onboardNext(slideIndex) {
  currentOnboardSlide = slideIndex;
  renderOnboardSlide(slideIndex);
}

function onboardBack() {
  if (currentOnboardSlide === 0) {
    showOnlyScreen('screen-splash');
  } else {
    currentOnboardSlide--;
    renderOnboardSlide(currentOnboardSlide);
  }
}

function renderOnboardSlide(idx) {
  for (let i = 0; i < 4; i++) {
    const el = document.getElementById('onboard-slide-' + i);
    if (el) el.style.display = 'none';
  }
  const target = document.getElementById('onboard-slide-' + idx);
  if (target) target.style.display = 'flex';
  const backBtn = document.getElementById('onboard-back-btn');
  if (backBtn) backBtn.style.visibility = idx === 0 ? 'hidden' : 'visible';
}

/* ── Enter app after auth ─────────────────────────────────── */
function enterApp() {
  showOnlyScreen('screen-tasks');
  document.getElementById('bottom-nav').style.display = 'flex';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navTasks = document.getElementById('nav-tasks');
  if (navTasks) navTasks.classList.add('active');
  // Sync AppState on initial entry
  if (window.AppState) {
    AppState.currentScreen  = 'tasks';
    AppState.previousScreen = null;
  }
  currentTab  = 'tasks';
  previousTab = 'tasks';
  _ensureSlidingPill();
  _moveSlidingPill('tasks');
  updateNavActiveStyle('tasks');
  updateNavBadge();
  if (typeof renderProfileStats === 'function') renderProfileStats();
  loadProfile();
}

/* ── Misc UI helpers ─────────────────────────────────────── */
function toggleAccordion(header) {
  const body = header.nextElementSibling;
  const icon = header.querySelector('.acc-icon');
  body.classList.toggle('hidden');
  icon.classList.toggle('closed');
}

function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  const colors = { default: '#1a1a2e', success: '#065F46', error: '#991B1B' };
  toast.style.cssText = `background:${colors[type]||colors.default};color:white;padding:12px 20px;border-radius:22px;font-size:13px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,.25);opacity:0;transform:translateY(12px);transition:all .3s;pointer-events:all;text-align:center;`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '1'; toast.style.transform = 'none'; }, 10);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(-8px)'; setTimeout(() => toast.remove(), 300); }, 2800);
}

function toggleSwitch(el) {
  el.classList.toggle('on');
  showToast(el.classList.contains('on') ? 'Enabled' : 'Disabled');
}

function showDeleteModal() { document.getElementById('modal-delete').classList.add('open'); }
function closeModal(id)    { document.getElementById(id).classList.remove('open'); }

function selectPaymentMethod(el) {
  document.querySelectorAll('.payment-method-card').forEach(c => {
    c.classList.remove('selected');
    c.querySelector('.pm-check').style.stroke = 'transparent';
  });
  el.classList.add('selected');
  el.querySelector('.pm-check').style.stroke = 'var(--brand)';
  showToast('Payment method selected');
}

function copyUserId() {
  const el = document.getElementById('user-id-display');
  const id = el ? el.textContent : '410213';
  navigator.clipboard.writeText(id).catch(() => {});
  showToast('User ID copied!');
}

function goBackFromDetail() { goBack(); }
function goBackFromChat()   { showScreen(chatPreviousScreen || 'messages'); }

/* ── Pill repositioning on resize ────────────────────────── */
/*
 * If the viewport is resized (e.g. rotation), pill position needs
 * to be recalculated from fresh measurements.
 */
window.addEventListener('resize', function() {
  const tab = (window.AppState && AppState.currentScreen) || currentTab;
  if (tab && NAV_TABS.includes(tab)) _moveSlidingPill(tab);
});
