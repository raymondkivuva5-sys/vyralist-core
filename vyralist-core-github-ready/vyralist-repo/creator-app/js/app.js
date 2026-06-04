/* ============================================================
   APP.JS — Main controller: boot, DB layer (load + write),
   utilities (relTime, fmtDate, formatCountdown), and the
   DOMContentLoaded dynamic-container bootstrap.
   ============================================================ */

/* ── Push notifications (web stub — native only via Capacitor) ── */
async function initPushNotifications() {
  /* Web browsers use the Notification API instead of Capacitor.
     For now this is a no-op on web; native push can be added later. */
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

/* ── App entry point — called after successful auth ─────── */
function _enterApp() {
  enterApp();
  loadAllData();
  initPushNotifications();
  _subscribePitchStatus();
}
// Signal that _enterApp is now defined. Use a flag so late listeners
// (e.g. OAuth SIGNED_IN arriving after this script runs) can call it
// immediately without relying on a one-shot CustomEvent that may have
// already fired.
window._enterAppReady = true;
window.dispatchEvent(new Event('_enterAppReady'));

/* ── Load all DB data — critical path first, deferred on tab-activation ── */
// Bug 6 fix: must be window property so supabase.js SIGNED_OUT handler can reset flags
window._tabLoaded = { campaigns: false, payouts: false, notifications: false, messages: false };
const _tabLoaded = window._tabLoaded; // local alias keeps all existing references working

async function loadAllData() {
  // Critical path: Tasks + Applications load immediately
  try {
    await Promise.all([
      dbLoadTasks(),
      dbLoadApplications(),
    ]);
  } catch (e) { console.warn('[DB] loadAllData critical error:', e.message); }
  _subscribeNotifications();
  _subscribeTasks();
  // Deferred: load remaining data only when their tab is first activated
  _deferNonCriticalLoads();
}

function _deferNonCriticalLoads() {
  // Load Campaigns when offers tab is activated
  _onTabActivate('offers', async () => {
    if (_tabLoaded.campaigns) return;
    _tabLoaded.campaigns = true;
    try { await Promise.all([dbLoadCampaigns(), dbLoadVideos()]); } catch (e) { console.warn('[DB] deferred campaigns/videos:', e.message); }
  });
  // Load Payouts + Referrals when earnings tab is activated
  _onTabActivate('earnings', async () => {
    if (_tabLoaded.payouts) return;
    _tabLoaded.payouts = true;
    try { await Promise.all([dbLoadPayouts(), dbLoadReferrals()]); } catch (e) { console.warn('[DB] deferred payouts/referrals:', e.message); }
  });
  // Notifications are now handled via popup — no panel tab
  // Load conversations when messages tab is activated — always refresh (no cache guard)
  _onTabActivate('messages', async () => {
    try {
      await dbLoadConversations();
    } catch (e) {
      console.error('[DB] conversations load failed. Have you run MIGRATION_messaging_rls.sql?', e.message);
    }
  });
}

function _onTabActivate(tabName, callback) {
  // Callbacks are fired inside showScreen() in nav.js, which is the real
  // entry point for all tab switches. window._tabActivateListeners is the
  // shared registry; showScreen reads it directly so no monkey-patching needed.
  if (!window._tabActivateListeners) window._tabActivateListeners = {};
  if (!window._tabActivateListeners[tabName]) window._tabActivateListeners[tabName] = [];
  window._tabActivateListeners[tabName].push(callback);
}

/* ══════════════════════════════════════════════════════════
   DB — TASKS
══════════════════════════════════════════════════════════ */
/* ── Signed video URL cache (55-min TTL) ─────────────────── */
const _signedUrlCache = new Map(); // key: storagePath → { url, expiresAt }

async function _getSignedVideoUrl(storagePath) {
  const cached = _signedUrlCache.get(storagePath);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const { data, error } = await window._supabase.storage.from('videos').createSignedUrl(storagePath, 3600);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'Failed to create signed URL');
  _signedUrlCache.set(storagePath, { url: data.signedUrl, expiresAt: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}


let _taskChannel   = null;   // Supabase realtime channel for tasks
let _taskTimerIv   = null;
let _shootTickerIv = null;
window._activeTask = null;
// Expose channels on window so the SIGNED_OUT handler in supabase.js can
// unsubscribe them without needing a direct reference to these variables.
Object.defineProperty(window, '_taskChannel',  { get: () => _taskChannel,  set: v => { _taskChannel  = v; } });
Object.defineProperty(window, '_notifChannel', { get: () => _notifChannel, set: v => { _notifChannel = v; } });

async function dbLoadTasks() {
  renderShootTabSkeleton(); // show skeletons immediately before fetch
  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) return;
  const { data, error } = await window._supabase
    .from('tasks')
    .select('*, campaigns(id, title, brand_name, description, reward_cash, reward_product, requires_shipping, video_length_sec, emoji, gradient_css, thumbnail_url, photos_required, organic_posting, org_reward_extra, brief_document_url)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[DB] tasks:', error.message); return; }
  window._db.tasks = data || [];
  renderShootTab();
  renderShootOverviewPreview();
  _startShootTicker();
}

async function _subscribeTasks() {
  if (_taskChannel) return;
  let retryDelay = 2000;
  const MAX_DELAY = 60000;
  async function _connect() {
    try {
      const { data: { user } } = await window._supabase.auth.getUser();
      if (!user) return;
      _taskChannel = window._supabase.channel('tasks:' + user.id)
        .on('postgres_changes', { event:'*', schema:'public', table:'tasks', filter:'user_id=eq.' + user.id },
          async () => { await dbLoadTasks(); })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') { retryDelay = 2000; } // reset backoff on success
          else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            _taskChannel = null;
            console.warn('[Realtime] task channel dropped, reconnecting in', retryDelay, 'ms');
            setTimeout(() => { _connect(); }, retryDelay);
            retryDelay = Math.min(retryDelay * 2, MAX_DELAY);
          }
        });
    } catch (e) {
      console.warn('[Realtime] task subscribe error:', e.message);
      _taskChannel = null;
      setTimeout(() => { _connect(); }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, MAX_DELAY);
    }
  }
  await _connect();
}

const _SHOOT_SKELETON = `<div style="padding:16px;border-radius:16px;background:#f5f5f5;margin-bottom:12px;animation:skeletonPulse 1.4s ease-in-out infinite;"><div style="height:14px;border-radius:7px;background:#e0e0e0;width:60%;margin-bottom:10px;"></div><div style="height:10px;border-radius:5px;background:#e8e8e8;width:40%;margin-bottom:8px;"></div><div style="height:10px;border-radius:5px;background:#e8e8e8;width:75%;"></div></div>`;

function renderShootTabSkeleton() {
  const listEl = document.getElementById('shoot-tasks-list');
  if (listEl) listEl.innerHTML = _SHOOT_SKELETON.repeat(3);
}

function renderShootTab() {
  const tasks  = window._db.tasks;
  const active = tasks.filter(t => !['approved','auto_approved'].includes(t.state));
  const listEl  = document.getElementById('shoot-tasks-list');
  const countEl = document.getElementById('shoot-count');
  if (countEl) countEl.textContent = active.length;
  if (!listEl) return;
  listEl.innerHTML = active.length
    ? active.map(t => shootTaskCard(t)).join('')
    : `<div style="padding:60px 32px;text-align:center;color:#999;"><div style="font-size:48px;margin-bottom:12px;">🎬</div><div style="font-size:16px;font-weight:600;color:#333;margin-bottom:6px;">No active tasks yet</div><div style="font-size:14px;line-height:1.6;">When a brand selects you, your tasks will appear here.</div></div>`;
}

function renderShootOverviewPreview() {
  const tasks   = window._db.tasks;
  const active  = tasks.filter(t => !['approved','auto_approved','submitted'].includes(t.state));
  const section = document.getElementById('overview-shoot-section');
  const preview = document.getElementById('overview-shoot-preview');
  if (!section || !preview) return;
  if (!active.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  preview.innerHTML = shootTaskCard(active[0]);
}

function _startShootTicker() {
  if (_shootTickerIv) clearInterval(_shootTickerIv);
  const TERMINAL = ['approved','auto_approved','submitted'];
  const TIMED    = ['selected','selected_digital','filming','revision'];
  _shootTickerIv = setInterval(() => {
    const tasks = window._db?.tasks || [];
    const hasActiveTimed = tasks.some(t => TIMED.includes(t.state) && !TERMINAL.includes(t.state));
    if (!hasActiveTimed) { clearInterval(_shootTickerIv); _shootTickerIv = null; return; }
    renderShootTab(); renderShootOverviewPreview();
  }, 1000);
}

function openTaskDetail(taskId) {
  const task = window._db.tasks.find(t => t.id === taskId);
  if (!task) return;
  window._activeTask = task;
  previousTab = currentTab;
  const c = task.campaigns || {};
  const shipping = task.requires_shipping ?? c.requires_shipping ?? false;

  document.getElementById('task-detail-brand').textContent = c.brand_name || 'Task';
  document.getElementById('task-detail-title').textContent = c.title || 'Campaign';
  const reward = c.reward_cash ? `$${parseFloat(c.reward_cash).toFixed(0)}${c.reward_product ? ' + free product' : ''}${c.photos_required ? ' + $40 (photos)' : ''}` : '';
  document.getElementById('task-detail-reward').textContent = reward;
  document.getElementById('task-detail-desc').textContent   = c.description || '';

  window._activeBriefUrl = c.brief_document_url || null;
  const briefRow   = document.getElementById('task-brief-doc-row');
  const briefLabel = document.getElementById('task-brief-doc-label');
  if (briefRow) {
    briefRow.style.display = c.brief_document_url ? 'block' : 'none';
    if (c.brief_document_url && briefLabel) {
      briefLabel.textContent = /docs\.google\.com|drive\.google\.com/i.test(c.brief_document_url) ? 'Google Doc — tap to view' : 'PDF brief — tap to view';
    }
  }

  const hero = document.getElementById('task-detail-hero');
  if (hero) {
    hero.style.background = c.gradient_css || 'linear-gradient(135deg,#6C3EF0,#A78BFA)';
    hero.innerHTML = c.thumbnail_url
      ? `<img src="${c.thumbnail_url}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;" onerror="this.style.display='none';"><span style="font-size:72px;position:relative;">${c.emoji||'🎬'}</span>`
      : `<span style="font-size:72px;">${c.emoji||'🎬'}</span>`;
  }

  const shipBadge = document.getElementById('task-detail-shipping-badge');
  if (shipBadge) {
    shipBadge.style.display = 'flex';
    document.getElementById('task-detail-shipping-text').textContent = shipping ? 'Shipping' : 'No shipping';
    shipBadge.style.color = shipping ? 'var(--brand)' : 'var(--text-2)';
  }

  ['task-state-shipping','task-state-filming','task-state-revision','task-state-submitted','task-state-approved','task-state-posting'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });

  const ctaEl = document.getElementById('task-detail-cta');
  const state  = task.state;
  if (state === 'selected' && shipping) {
    document.getElementById('task-state-shipping').style.display = 'block';
    _setShippingStep('pending'); ctaEl.innerHTML = ''; _startTaskDetailTimer();
  } else if (state === 'confirm') {
    document.getElementById('task-state-shipping').style.display = 'block';
    _setShippingStep('shipped');
    ctaEl.innerHTML = `<button class="btn-primary" onclick="dbConfirmProductReceived()">I've received my product ✓</button>`;
  } else if (['filming','selected_digital'].includes(state)) {
    document.getElementById('task-state-filming').style.display = 'block';
    ctaEl.innerHTML = `<button class="btn-primary" onclick="openTaskUpload()">Upload task video 🎬</button>`;
    _startTaskDetailTimer();
  } else if (state === 'revision') {
    document.getElementById('task-state-revision').style.display = 'block';
    ctaEl.innerHTML = `<button class="btn-primary" onclick="openTaskUpload()">Upload revised video 🎬</button>`;
    _startTaskDetailTimer();
  } else if (state === 'submitted') {
    document.getElementById('task-state-submitted').style.display = 'block';
    ctaEl.innerHTML = '';
  } else { ctaEl.innerHTML = ''; }

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-task-detail').classList.add('active');
}

function _setShippingStep(step) {
  const active = 'width:28px;height:28px;border-radius:50%;background:var(--brand);display:flex;align-items:center;justify-content:center;transition:all .3s;';
  const idle   = 'width:28px;height:28px;border-radius:50%;border:2px solid var(--border);background:white;display:flex;align-items:center;justify-content:center;transition:all .3s;';
  const lineOn = 'flex:1;height:2px;background:var(--brand);margin-bottom:14px;transition:background .3s;';
  const lineOff= 'flex:1;height:2px;background:var(--border);margin-bottom:14px;transition:background .3s;';
  const dc = document.getElementById('ship-dot-confirmed'), ds = document.getElementById('ship-dot-shipped');
  const l1 = document.getElementById('ship-line-1'), ls = document.getElementById('ship-label-shipped');
  const cp = document.getElementById('task-ship-content-pending'), cs = document.getElementById('task-ship-content-shipped');
  if (!dc || !ds) return;
  if (step === 'pending') {
    dc.style.cssText = active; ds.style.cssText = idle;
    if (l1) l1.style.cssText = lineOff;
    if (ls) { ls.textContent = 'Shipped'; ls.style.color = 'var(--text-3)'; }
    if (cp) cp.style.display = 'block'; if (cs) cs.style.display = 'none';
  } else if (step === 'shipped') {
    dc.style.cssText = active; ds.style.cssText = active;
    if (l1) l1.style.cssText = lineOn;
    if (ls) { ls.textContent = 'Shipped ✓'; ls.style.color = 'var(--brand)'; }
    if (cp) cp.style.display = 'none'; if (cs) cs.style.display = 'block';
  }
}

function _startTaskDetailTimer() {
  if (_taskTimerIv) clearInterval(_taskTimerIv);
  _taskTimerIv = setInterval(() => {
    if (!window._activeTask) return;
    const t = window._activeTask, now = Date.now(), state = t.state;
    const shipping = t.requires_shipping ?? t.campaigns?.requires_shipping ?? false;
    const timerBadge = document.getElementById('task-detail-timer-text');
    if (!timerBadge) return;
    if (state === 'selected' && shipping) {
      const ms  = t.shipping_deadline ? new Date(t.shipping_deadline) - now : 0;
      const pct = t.shipping_deadline ? Math.min(100, ((now - new Date(t.created_at)) / (new Date(t.shipping_deadline) - new Date(t.created_at))) * 100) : 0;
      timerBadge.textContent = ms > 0 ? formatCountdown(ms) + ' left' : 'Overdue';
      const cd  = document.getElementById('task-ship-countdown');
      const bar = document.getElementById('task-ship-bar');
      if (cd) cd.textContent = ms > 0 ? formatCountdown(ms) : 'Overdue';
      if (bar) bar.style.width = pct + '%';
    } else if (['filming','selected_digital'].includes(state)) {
      const ms   = t.filming_deadline ? new Date(t.filming_deadline) - now : 0;
      const total = 72 * 3600000, pct = Math.min(100, ((total - ms) / total) * 100);
      timerBadge.textContent = ms > 0 ? formatCountdown(ms) + ' left' : 'Overdue';
      const cd  = document.getElementById('task-film-countdown');
      const bar = document.getElementById('task-film-bar');
      if (cd)  cd.textContent  = ms > 0 ? formatCountdown(ms) : '00:00:00';
      if (bar) bar.style.width = pct + '%';
      if (cd && ms < 7200000) cd.style.color = '#EF4444';
    } else if (state === 'revision') {
      const ms   = t.revision_deadline ? new Date(t.revision_deadline) - now : 0;
      const total = 24 * 3600000, pct = Math.min(100, ((total - ms) / total) * 100);
      timerBadge.textContent = ms > 0 ? formatCountdown(ms) + ' left' : 'Overdue';
      const cd  = document.getElementById('task-revision-countdown');
      const bar = document.getElementById('task-revision-bar');
      if (cd)  cd.textContent  = ms > 0 ? formatCountdown(ms) : '00:00:00';
      if (bar) bar.style.width = pct + '%';
    }
  }, 1000);
}

async function dbConfirmProductReceived() {
  if (!window._activeTask) return;
  const shipping = window._activeTask.requires_shipping ?? window._activeTask.campaigns?.requires_shipping ?? false;
  const deadlineMs = shipping
    ? 5 * 24 * 3600 * 1000  // 5 days from product delivery for physical products
    : 72 * 3600000;          // 72h for digital tasks only
  const filmingDeadline = new Date(Date.now() + deadlineMs).toISOString();
  const { error } = await window._supabase.from('tasks').update({
    state: 'filming', filming_deadline: filmingDeadline, updated_at: new Date().toISOString(),
  }).eq('id', window._activeTask.id);
  if (error) { showToast(error.message, 'error'); return; }
  const label = shipping ? '5-day' : '72-hour';
  showToast(`Product confirmed! ${label} filming window started.`, 'success');
  await dbLoadTasks(); openTaskDetail(window._activeTask.id);
}

function openTaskUpload() {
  if (!window._activeTask) return;
  previousTab = 'task-detail';
  if (window._navStack) window._navStack.push('task-detail');
  const c = window._activeTask.campaigns || {};
  const reqSec = c.video_length_sec || 30;
  document.getElementById('upload-length-req').textContent = `Required: ${reqSec}s · Accepted: ${reqSec - 10}–${reqSec + 10}s`;
  const photoSec = document.getElementById('task-photo-section');
  if (photoSec) photoSec.style.display = c.photos_required ? 'block' : 'none';
  _initPhotoSlots();
  resetTaskUpload();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-task-upload').classList.add('active');
}

function resetTaskUpload() {
  document.getElementById('task-upload-zone-empty').style.display = 'flex';
  document.getElementById('task-upload-zone-done').style.display  = 'none';
  document.getElementById('task-duration-warning').style.display  = 'none';
  const btn = document.getElementById('task-submit-btn');
  if (btn) { btn.disabled = true; btn.style.opacity = '.5'; btn.style.cursor = 'not-allowed'; }
  const bar = document.getElementById('task-uvc-bar');
  if (bar) { bar.style.width = '0%'; bar.style.background = ''; }
  const fi = document.getElementById('task-video-file-input');
  if (fi) fi.value = '';
  window._pendingTaskFile = null; window._pendingTaskPath = null;
  window._pendingPhotoFiles = []; _initPhotoSlots();
}

async function handleTaskVideoSelect(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('task-upload-zone-empty').style.display = 'none';
  document.getElementById('task-upload-zone-done').style.display  = 'block';
  document.getElementById('task-uvc-filename').textContent = file.name;
  document.getElementById('task-uvc-size').textContent     = (file.size / (1024*1024)).toFixed(1) + ' MB';
  const bar = document.getElementById('task-uvc-bar'), pct = document.getElementById('task-uvc-pct');
  bar.style.width = '0%'; bar.style.background = ''; pct.textContent = '0%';
  let fakeP = 0;
  const iv = setInterval(() => {
    if (fakeP < 85) { fakeP += Math.floor(Math.random() * 8) + 3; fakeP = Math.min(fakeP, 85); bar.style.width = fakeP + '%'; pct.textContent = fakeP + '%'; }
  }, 300);
  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) { clearInterval(iv); showToast('Please log in again', 'error'); return; }
  const ext  = file.name.split('.').pop();
  const path = `${user.id}/${window._activeTask.id}/task.${ext}`;
  const { data: uploadData, error } = await window._supabase.storage.from('videos').upload(path, file, { upsert: true });
  clearInterval(iv);
  if (error) { bar.style.width = '0%'; pct.textContent = 'Failed'; showToast('Upload failed: ' + error.message, 'error'); return; }
  bar.style.width = '100%'; bar.style.background = 'var(--success)'; pct.textContent = '100%';
  document.getElementById('task-uvc-label').textContent = 'Upload complete ✓';
  document.getElementById('task-uvc-play').style.display = 'flex';
  window._pendingTaskFile = file; window._pendingTaskPath = uploadData.path;
  const url = URL.createObjectURL(file);
  const vid  = document.createElement('video');
  vid.preload = 'metadata';
  vid.onloadedmetadata = () => {
    URL.revokeObjectURL(url);
    const c = window._activeTask?.campaigns || {}, reqSec = c.video_length_sec || 30, dur = Math.round(vid.duration);
    const warn = document.getElementById('task-duration-warning');
    if (dur < reqSec - 10 || dur > reqSec + 10) {
      warn.style.display = 'block';
      warn.textContent = `⚠️ Your video is ${dur}s but must be between ${reqSec-10}s and ${reqSec+10}s. Please re-record and upload again.`;
      const btn = document.getElementById('task-submit-btn');
      if (btn) { btn.disabled = true; btn.style.opacity = '.5'; btn.style.cursor = 'not-allowed'; }
    } else { warn.style.display = 'none'; _recheckSubmitBtn(); }
  };
  vid.src = url;
}

async function dbSubmitTaskVideo() {
  if (!window._activeTask || !window._pendingTaskPath) { showToast('Please upload a video first', 'error'); return; }
  const btn = document.getElementById('task-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
  const { error } = await window._supabase.from('tasks').update({
    state: 'submitted', submitted_video_path: window._pendingTaskPath, updated_at: new Date().toISOString(),
  }).eq('id', window._activeTask.id);
  if (error) { showToast(error.message, 'error'); if (btn) { btn.disabled = false; btn.textContent = 'Submit video'; } return; }
  const { data: { user } } = await window._supabase.auth.getUser();
  if (user) {
    await window._supabase.from('videos').insert({
      user_id: user.id, task_id: window._activeTask.id, campaign_id: window._activeTask.campaign_id,
      storage_path: window._pendingTaskPath, status: 'under_review', submitted_at: new Date().toISOString(),
    });
  }
  window._pendingTaskPath = null; window._pendingTaskFile = null; window._pendingPhotoFiles = [];
  showToast('Video submitted! Awaiting brand review.', 'success');
  await dbLoadTasks(); openTaskDetail(window._activeTask.id);
}

function _initPhotoSlots() {
  window._pendingPhotoFiles = [];
  const grid = document.getElementById('photo-slots-grid');
  if (!grid) return;
  grid.innerHTML = [0,1,2,3].map(i => `
    <div id="photo-slot-${i}" onclick="document.getElementById('photo-input-${i}').click()" style="aspect-ratio:1;border:2px dashed var(--border);border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;cursor:pointer;background:var(--bg);overflow:hidden;">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      <span style="font-size:11px;color:var(--text-3);pointer-events:none;">Photo ${i+1}</span>
      <input type="file" id="photo-input-${i}" accept="image/*" style="display:none;" onchange="handlePhotoSelect(this,${i})">
    </div>`).join('');
}

function handlePhotoSelect(input, idx) {
  const file = input.files[0]; if (!file) return;
  if (!window._pendingPhotoFiles) window._pendingPhotoFiles = [];
  window._pendingPhotoFiles[idx] = file;
  const slot = document.getElementById('photo-slot-' + idx); if (!slot) return;
  const reader = new FileReader();
  reader.onload = e => {
    slot.style.border = '2px solid var(--brand)'; slot.style.padding = '0';
    slot.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;display:block;"><input type="file" id="photo-input-${idx}" accept="image/*" style="display:none;" onchange="handlePhotoSelect(this,${idx})">`;
    slot.onclick = () => document.getElementById('photo-input-' + idx).click();
    _updatePhotoCount();
  };
  reader.readAsDataURL(file);
}

function _updatePhotoCount() {
  const count = (window._pendingPhotoFiles || []).filter(Boolean).length;
  const lbl = document.getElementById('photo-count-label');
  if (lbl) lbl.textContent = `${count} of 4 photos selected`;
  _recheckSubmitBtn();
}

function _recheckSubmitBtn() {
  const btn = document.getElementById('task-submit-btn'); if (!btn) return;
  const hasVideo        = !!window._pendingTaskPath;
  const photosRequired  = !!(window._activeTask?.campaigns?.photos_required);
  const photoCount      = (window._pendingPhotoFiles || []).filter(Boolean).length;
  const ready           = hasVideo && (!photosRequired || photoCount >= 4);
  btn.disabled = !ready; btn.style.opacity = ready ? '1' : '.5'; btn.style.cursor = ready ? 'pointer' : 'not-allowed';
}

/* ══════════════════════════════════════════════════════════
   DB — PAYOUTS / REFERRALS / NOTIFICATIONS / VIDEOS
══════════════════════════════════════════════════════════ */
async function dbLoadPayouts() {
  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) return;
  const { data, error } = await window._supabase.from('payouts').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
  if (error) { console.warn('[DB] payouts:', error.message); return; }
  window._db.payouts = data || [];
  renderEarningsScreen(); renderPortfolioEarnings();
}

async function dbLoadReferrals() {
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;
    const [payoutsRes, profileRes] = await Promise.all([
      window._supabase.from('payouts').select('*').eq('user_id', user.id).eq('type','referral').order('created_at', { ascending: false }),
      window._supabase.from('profiles').select('referral_code, referrals_count, referrals_completed').eq('id', user.id).single(),
    ]);
    window._db.referrals = payoutsRes.data || [];
    if (profileRes.data?.referral_code) { const el = document.getElementById('referral-code-display'); if (el) el.textContent = profileRes.data.referral_code; }
    renderReferralStats(profileRes.data);
  } catch (e) { console.warn('[Referral] dbLoadReferrals:', e.message); }
}

function renderReferralStats(profile) {
  const rows = window._db.referrals;
  const joined    = profile?.referrals_count     ?? rows.length;
  const completed = profile?.referrals_completed ?? rows.filter(r => r.status === 'paid').length;
  const earned    = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const el1 = document.getElementById('ref-stat-friends'),   el2 = document.getElementById('ref-stat-completed'), el3 = document.getElementById('ref-stat-earned');
  if (el1) el1.textContent = joined; if (el2) el2.textContent = completed; if (el3) el3.textContent = `$${earned.toFixed(0)}`;
  if (rows.length) renderEarningsScreen();
}

/* dbLoadNotifications removed — popup handles this */

/* dbMarkNotifRead removed */

/* dbMarkAllNotifsRead removed */

async function dbInsertNotification(userId, type, title, body) {
  await window._supabase.from('notifications').insert({ user_id: userId, type, title, body, read: false });
}

let _notifChannel = null;
async function _subscribeNotifications() {
  if (_notifChannel) return;
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;
    _notifChannel = window._supabase.channel('notifications:' + user.id)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications', filter:'user_id=eq.' + user.id },
        (payload) => {
          const n = payload.new;
          /* Suppress brand-side notifications that creators should not see */
          if (n.type === 'campaign_published' || (n.title || '').toLowerCase().includes('campaign published')) return;
          showToast('🔔 ' + (n.title || 'New notification'));
          // Re-trigger popup check for the new item
          if (typeof checkAndShowNotifPopup === 'function') checkAndShowNotifPopup();
        })
      .subscribe();

    // Also subscribe to new conversations (e.g. admin sends a message)
    window._supabase.channel('conversations:' + user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations', filter: 'creator_id=eq.' + user.id },
        () => {
          window._tabLoaded.messages = false;
          if (typeof dbLoadConversations === 'function') {
            dbLoadConversations().then(() => {
              if (typeof renderMessages === 'function') renderMessages();
              updateMsgBadge();
            }).catch(() => {});
          }
        })
      .subscribe();

  } catch (e) { console.warn('[Realtime] notification subscribe error:', e.message); }
}

async function dbLoadVideos() {
  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) return;
  const { data, error } = await window._supabase.from('videos')
    .select('*, campaigns(brand_name, title, emoji, gradient_css, thumbnail_url)')
    .eq('user_id', user.id).order('submitted_at', { ascending: false });
  if (error) { console.warn('[DB] videos:', error.message); return; }
  window._db.videos = data || [];
  window.videoData = (data || []).map(v => ({
    id: v.id, title: v.campaigns?.title || v.title || 'Video',
    date: v.submitted_at?.slice(0,10) || v.created_at?.slice(0,10),
    deadline: v.deadline, onTime: v.on_time, rating: v.rating,
    emoji: v.campaigns?.emoji || v.emoji || '🎬',
    bg: v.campaigns?.gradient_css || 'linear-gradient(135deg,#6C3EF0,#A78BFA)',
    thumbnailUrl: v.campaigns?.thumbnail_url || null,
    storagePath: v.storage_path || null,
  }));
  if (typeof renderProfileStats === 'function') renderProfileStats();
  if (typeof renderPortfolioEarnings === 'function') renderPortfolioEarnings();
}

async function dbInsertVideo(applicationId, storagePath, campaignId) {
  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) return;
  await window._supabase.from('videos').upsert({
    user_id: user.id, application_id: applicationId, campaign_id: campaignId,
    storage_path: storagePath, status: 'under_review', submitted_at: new Date().toISOString(),
  }, { onConflict: 'application_id' });
}

/* ══════════════════════════════════════════════════════════
   EARNINGS + PORTFOLIO RENDERS
══════════════════════════════════════════════════════════ */
function _nextPayoutDate() {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  if (d < 13) return new Date(y, m, 13);
  if (d < 26) return new Date(y, m, 26);
  return new Date(y, m + 1, 13);
}

function renderEarningsScreen() {
  let listEl = document.getElementById('earnings-list-dynamic');
  /* Auto-create target if fixes.js hasn't run yet */
  if (!listEl) {
    const screen = document.getElementById('screen-earning-details');
    if (!screen) return;
    const body = screen.querySelector('.scroll-body') || screen;
    listEl = document.createElement('div');
    listEl.id = 'earnings-list-dynamic';
    listEl.style.cssText = 'padding:0 16px;';
    body.appendChild(listEl);
  }
  const rows = [...(window._db.payouts||[]), ...(window._db.referrals||[])].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  if (!rows.length) { listEl.innerHTML = `<div style="padding:60px 32px;text-align:center;color:#999;"><div style="font-size:48px;margin-bottom:12px;">💸</div><div style="font-size:16px;font-weight:600;color:#333;margin-bottom:6px;">No earnings yet</div><div style="font-size:14px;line-height:1.6;">Complete your first campaign to start earning.</div></div>`; return; }
  listEl.innerHTML = rows.map((p, i) => {
    const status = p.status || 'pending', isPayout = status === 'paid', isCleared = status === 'cleared';
    const label  = isPayout ? `✓ Paid | ${fmtDate(p.approved_at||p.created_at)}` : isCleared ? `● Cleared | ${fmtDate(p.clears_at||p.created_at)}` : `● Pending | ${fmtDate(p.created_at)}`;
    const cls    = isPayout ? 'payout' : isCleared ? 'cleared' : 'earning';
    const amtCls = isPayout ? 'earning-amount-pos' : 'earning-amount-pend';
    const statusNote = !isPayout && !isCleared ? `<div class="detail-row"><span>Status:</span><span style="color:#F59E0B;font-weight:700;">Awaiting brand approval</span></div>` : isCleared ? `<div class="detail-row"><span>Status:</span><span style="color:#3B82F6;font-weight:700;">Queued for next payout</span></div>` : '';
    return `<div class="earning-item" style="${i===rows.length-1?'border-bottom:none;':''}">
      <div class="earning-row" onclick="toggleEarning(this)">
        <div><div class="earning-badge ${cls}">${label}</div><div class="earning-title">${isPayout ? 'Vyralist → Your account' : (p.type==='referral' ? 'Referral bonus' : (p.campaign_title||'Campaign'))}</div>${p.campaign_title&&!isPayout&&p.type!=='referral'?`<div class="earning-sub">${p.campaign_title}</div>`:''}</div>
        <div style="text-align:right;flex-shrink:0;"><div class="${amtCls}">+$${Number(p.amount||0).toFixed(0)}</div><span class="see-toggle" style="color:var(--brand);font-size:12px;font-weight:600;cursor:pointer;">See more</span></div>
      </div>
      <div class="earning-detail hidden"><div class="detail-row"><span>Transaction ID:</span><span>${p.reference||'—'}</span></div>${statusNote}${p.created_at?`<div class="detail-row"><span>Earned at:</span><span>${fmtDate(p.created_at)}</span></div>`:''} ${p.clears_at?`<div class="detail-row"><span>Clears at:</span><span>${fmtDate(p.clears_at)}</span></div>`:''} ${p.approved_at?`<div class="detail-row"><span>Paid out at:</span><span>${fmtDate(p.approved_at)}</span></div>`:''}</div>
    </div>`;
  }).join('');
}

function renderPortfolioEarnings() {
  const rows    = window._db.payouts;
  const total   = rows.reduce((s, p) => s + (Number(p.amount)||0), 0);
  const pending = rows.filter(p => p.status==='pending').reduce((s,p) => s+(Number(p.amount)||0), 0);
  const cleared = rows.filter(p => p.status==='cleared').reduce((s,p) => s+(Number(p.amount)||0), 0);
  const amountEl = document.querySelector('.portfolio-earnings-amount'); if (amountEl) amountEl.textContent = `$${total.toFixed(0)}`;
  const pendingEl = document.getElementById('portfolio-pending-label');
  if (pendingEl) { const parts=[]; if(pending>0) parts.push(`Pending: $${pending.toFixed(0)}`); if(cleared>0) parts.push(`Cleared: $${cleared.toFixed(0)}`); pendingEl.textContent=parts.join(' · '); }
  const nextDate  = _nextPayoutDate(), nextLabel = `Next payout: ${nextDate.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;
  const portPill  = document.getElementById('portfolio-next-payout'); if (portPill) { portPill.textContent = nextLabel; portPill.style.display = (cleared>0||pending>0)?'block':'none'; }
  const detailPill = document.getElementById('earnings-next-payout-pill'); if (detailPill) { detailPill.textContent = nextLabel; detailPill.style.display = 'inline-block'; }
  const barsArea  = document.querySelector('.chart-bars-area'), labelsRow = document.querySelector('.chart-labels-row');
  if (!barsArea || !labelsRow) return;
  const months = [], now = new Date();
  for (let i=6;i>=0;i--) { const d=new Date(now.getFullYear(),now.getMonth()-i,1); months.push({key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,lbl:d.toLocaleDateString('en-US',{month:'short'}),year:d.getFullYear(),isNewYear:d.getMonth()===0,total:0}); }
  rows.forEach(p => { const m=months.find(x=>x.key===p.created_at?.slice(0,7)); if(m) m.total+=Number(p.amount)||0; });
  const maxTotal = Math.max(...months.map(m=>m.total),1);
  barsArea.innerHTML = months.map((m,i) => { const pct=Math.round((m.total/maxTotal)*100),tipId=`tip-${i}`; return `<div class="chart-col"><div class="chart-tooltip" id="${tipId}">$${m.total.toFixed(0)}</div><div class="chart-bar" style="height:${pct||2}%;${pct===0?'opacity:.15;':''}" data-amount="$${m.total.toFixed(0)}" data-tip="${tipId}" onmousedown="showBarTip(this)" onmouseup="hideBarTip(this)" onmouseleave="hideBarTip(this)" ontouchstart="showBarTip(this)" ontouchend="hideBarTip(this)"></div></div>`; }).join('');
  labelsRow.innerHTML = months.map(m => `<div class="chart-label">${m.lbl}${m.isNewYear?`<br><span style="font-size:9px;">${m.year}</span>`:''}</div>`).join('');
}

function renderTaskCampaignData() {
  if (!window.TASK_CAMPAIGNS) return;
  window._db.campaigns.forEach(c => {
    const key = c.slug || c.id; if (!key) return;
    if (!window.TASK_CAMPAIGNS[key]) {
      window.TASK_CAMPAIGNS[key] = {
        name: `${c.brand_name} – ${c.title}`, reward: c.reward_usd ? `$${c.reward_usd}${c.reward_product?' + free product':''}` : '',
        requiresShipping: c.requires_shipping, emoji: c.emoji||'🎬', dbId: c.id,
        organic_posting: c.organic_posting??false, orgRewardExtra: c.org_reward_extra?`+$${c.org_reward_extra}`:'',
        photos_required: c.photos_required??false, photoRewardExtra: c.photos_required?'+$40':'',
        brief_document_url: c.brief_document_url||'',
      };
    }
  });
}

/* ══════════════════════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════════════════════ */
function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime(), m = Math.floor(diff/60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h/24); if (d < 7) return `${d}d ago`;
  return fmtDate(iso);
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
}

function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  if (ms < 60000) return Math.floor(ms / 1000) + 's';
  const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000), s = Math.floor((ms%60000)/1000);
  if (h >= 24) { const d=Math.floor(h/24); return d+'d '+String(h%24).padStart(2,'0')+'h'; }
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}

/* ── Form helpers (date picker, gender, shipping region) ── */
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS   = ['S','M','T','W','T','F','S'];
let dpYear=2000, dpMonth=2, dpDay=null, dpTempYear=2000, dpTempMonth=2, dpTempDay=null;

function openDatePicker() { dpTempYear=dpYear;dpTempMonth=dpMonth;dpTempDay=dpDay; renderDpGrid(); document.getElementById('date-picker-overlay').classList.add('open'); }
function closeDatePickerOutside(e) { if (e.target===document.getElementById('date-picker-overlay')) closeDatePicker(); }
function closeDatePicker() { document.getElementById('date-picker-overlay').classList.remove('open'); }
function confirmDate() {
  if (!dpTempDay) { closeDatePicker(); return; }
  dpYear=dpTempYear; dpMonth=dpTempMonth; dpDay=dpTempDay;
  const d=new Date(dpYear,dpMonth,dpDay), label=d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  const t1=document.getElementById('dob-text'); if(t1){t1.textContent=label;t1.style.color='#0F0F0F';}
  closeDatePicker();
}
function renderDpGrid() {
  document.getElementById('dp-month-text').textContent = MONTHS[dpTempMonth];
  document.getElementById('dp-year-text').textContent  = dpTempYear;
  const grid = document.getElementById('dp-grid'); if (!grid) return;
  const firstDay = new Date(dpTempYear, dpTempMonth, 1).getDay();
  const daysInMonth = new Date(dpTempYear, dpTempMonth+1, 0).getDate();
  let html = DAYS.map(d=>`<div class="cal-day-name">${d}</div>`).join('');
  for (let i=0;i<firstDay;i++) html += `<div class="cal-day empty"></div>`;
  for (let d=1;d<=daysInMonth;d++) {
    const sel = d===dpTempDay ? 'selected' : '';
    html += `<div class="cal-day ${sel}" onclick="dpSelectDay(${d})">${d}</div>`;
  }
  grid.innerHTML = html;
  document.getElementById('dp-display').textContent = dpTempDay ? new Date(dpTempYear,dpTempMonth,dpTempDay).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '–';
}
function dpNav(dir) { dpTempMonth+=dir; if(dpTempMonth<0){dpTempMonth=11;dpTempYear--;} else if(dpTempMonth>11){dpTempMonth=0;dpTempYear++;} renderDpGrid(); }
function dpSelectDay(d) { dpTempDay=d; renderDpGrid(); }
function toggleMonthPicker() { const el=document.getElementById('dp-month-picker'); if(el) el.style.display=el.style.display==='none'?'block':'none'; }
function toggleYearPicker(e) { e.stopPropagation(); const el=document.getElementById('dp-year-picker'); if(!el) return; if(el.style.display==='block'){el.style.display='none';return;} const list=document.getElementById('dp-year-list'); if(list){const cy=new Date().getFullYear();list.innerHTML='';for(let y=cy;y>=1940;y--){const d=document.createElement('div');d.style.cssText='padding:10px 20px;font-size:15px;cursor:pointer;text-align:center;scroll-snap-align:start;';d.textContent=y;if(y===dpTempYear)d.style.fontWeight='700';d.onclick=()=>dpSelectYear(y);list.appendChild(d);}} el.style.display='block'; }
function dpSelectMonth(m) { dpTempMonth=m; document.getElementById('dp-month-picker').style.display='none'; renderDpGrid(); }
function dpSelectYear(y)  { dpTempYear=y;  document.getElementById('dp-year-picker').style.display='none';  renderDpGrid(); }

function selectGender(el, val) {
  document.querySelectorAll('.gender-chip,.gender-pill').forEach(g => g.classList.remove('selected','active'));
  el.classList.add('selected','active');
}

function toggleRefDropdown() { const d=document.getElementById('ref-dropdown'); if(d) d.style.display=d.style.display==='none'?'block':'none'; }
function selectRef(val) { const t=document.getElementById('ref-text'); if(t){t.textContent=val;t.style.color='var(--text)';} const d=document.getElementById('ref-dropdown'); if(d) d.style.display='none'; }

function onSignupCountryChange(val) { /* country-specific UI if needed */ }

const _SHIPPING_REGIONS = { CA:['Alberta','British Columbia','Manitoba','New Brunswick','Newfoundland and Labrador','Northwest Territories','Nova Scotia','Nunavut','Ontario','Prince Edward Island','Quebec','Saskatchewan','Yukon'], US:['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'], GB:['England','Scotland','Wales','Northern Ireland'], AU:['New South Wales','Victoria','Queensland','South Australia','Western Australia','Tasmania','Australian Capital Territory','Northern Territory'] };

function onShippingCountryChange(val) {
  const regionEl = document.getElementById('ship-region'); if (!regionEl) return;
  const regions = _SHIPPING_REGIONS[val] || [];
  regionEl.innerHTML = regions.length ? `<option value="">Select region…</option>` + regions.map(r=>`<option value="${r}">${r}</option>`).join('') : `<option value="">N/A</option>`;
}

function formatShipPhone(input) {
  let v = input.value.replace(/\D/g,'').slice(0,10);
  if (v.length>=7) v=v.replace(/(\d{3})(\d{3})(\d{4})/,'($1) $2-$3');
  else if (v.length>=4) v=v.replace(/(\d{3})(\d+)/,'($1) $2');
  else if (v.length>0) v='('+v;
  input.value=v;
}

/* ══════════════════════════════════════════════════════════
   YEAR IN REVIEW (Billo v5.25) — Annual recap screen
══════════════════════════════════════════════════════════ */
function openYearRecap() {
  const year   = new Date().getFullYear() - 1; // show previous year's recap
  const payouts = (window._db.payouts || []).filter(p => p.created_at?.startsWith(String(year)));
  const videos  = (window._db.videos  || []).filter(v => (v.submitted_at || v.created_at)?.startsWith(String(year)));

  const totalEarned  = payouts.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const videosCount  = videos.length;

  // Top brands by frequency
  const brandMap = {};
  videos.forEach(v => {
    const brand = v.campaigns?.brand_name || 'Unknown';
    brandMap[brand] = (brandMap[brand] || 0) + 1;
  });
  const topBrands = Object.entries(brandMap).sort((a, b) => b[1] - a[1]).slice(0, 3);

  // Best rating
  const rated     = videos.filter(v => v.rating != null);
  const bestRating = rated.length ? Math.max(...rated.map(v => v.rating)) : null;

  // Build recap screen HTML
  const el = document.getElementById('screen-year-recap');
  if (!el) return;

  el.innerHTML = `
    <div style="min-height:100vh;background:linear-gradient(160deg,#6C3EF0 0%,#A78BFA 50%,#F0ABFC 100%);padding:0 0 60px;color:#fff;">
      <div style="display:flex;align-items:center;padding:56px 20px 0;">
        <button onclick="closeYearRecap()" style="background:rgba(255,255,255,.18);border:none;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;margin-right:12px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span style="font-size:17px;font-weight:700;letter-spacing:.2px;">${year} Year in Review</span>
      </div>

      <div style="text-align:center;padding:40px 24px 0;">
        <div style="font-size:52px;font-weight:800;letter-spacing:-2px;">$${totalEarned.toFixed(0)}</div>
        <div style="font-size:16px;opacity:.85;margin-top:4px;">Total earned in ${year}</div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:32px 20px 0;">
        <div style="background:rgba(255,255,255,.18);border-radius:18px;padding:20px;text-align:center;">
          <div style="font-size:36px;font-weight:800;">${videosCount}</div>
          <div style="font-size:13px;opacity:.85;margin-top:4px;">Videos completed</div>
        </div>
        <div style="background:rgba(255,255,255,.18);border-radius:18px;padding:20px;text-align:center;">
          <div style="font-size:36px;font-weight:800;">${bestRating != null ? bestRating.toFixed(1) + '⭐' : '—'}</div>
          <div style="font-size:13px;opacity:.85;margin-top:4px;">Best rating</div>
        </div>
      </div>

      ${topBrands.length ? `
      <div style="margin:24px 20px 0;background:rgba(255,255,255,.18);border-radius:18px;padding:20px;">
        <div style="font-size:14px;font-weight:700;opacity:.85;margin-bottom:14px;text-transform:uppercase;letter-spacing:.6px;">Top brands</div>
        ${topBrands.map(([brand, count], i) => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;${i < topBrands.length-1 ? 'border-bottom:1px solid rgba(255,255,255,.15);' : ''}">
            <span style="font-size:15px;font-weight:600;">${brand}</span>
            <span style="font-size:13px;opacity:.8;">${count} video${count !== 1 ? 's' : ''}</span>
          </div>`).join('')}
      </div>` : ''}

      <div style="margin:32px 20px 0;text-align:center;font-size:22px;font-weight:700;line-height:1.4;">
        ${totalEarned > 0 ? `You crushed it in ${year}! 🎉<br><span style="font-size:15px;font-weight:400;opacity:.85;">Keep the momentum going.</span>` : `Get your first campaign in ${new Date().getFullYear()} 🚀`}
      </div>
    </div>`;

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  el.classList.add('active');
}

function closeYearRecap() {
  document.getElementById('screen-year-recap')?.classList.remove('active');
  showTab('profile');
}


document.addEventListener('DOMContentLoaded', () => {
  const hscroll = document.querySelector('.offers-hscroll-row');
  if (hscroll && !document.getElementById('offers-suggested-dynamic')) { const d=document.createElement('div'); d.id='offers-suggested-dynamic'; hscroll.prepend(d); }
  const grid = document.querySelector('.offers-grid-row');
  if (grid && !document.getElementById('offers-new-dynamic')) { const d=document.createElement('div'); d.id='offers-new-dynamic'; d.style.cssText='display:contents'; grid.prepend(d); }
  const campaignList = document.getElementById('campaign-list');
  if (campaignList && !document.getElementById('campaign-list-dynamic')) { const d=document.createElement('div'); d.id='campaign-list-dynamic'; campaignList.prepend(d); }
  const appliedTab = document.getElementById('todo-applied');
  if (appliedTab && !document.getElementById('todo-applied-dynamic')) { const d=document.createElement('div'); d.id='todo-applied-dynamic'; appliedTab.prepend(d); }
  const completedTab = document.getElementById('todo-completed');
  if (completedTab && !document.getElementById('todo-completed-dynamic')) { const d=document.createElement('div'); d.id='todo-completed-dynamic'; completedTab.prepend(d); }
  const earningParent = document.querySelector('#screen-earning-details .scroll-body');
  if (earningParent && !document.getElementById('earnings-list-dynamic')) {
    const d=document.createElement('div'); d.id='earnings-list-dynamic';
    const banner=earningParent.querySelector('div');
    if (banner?.nextSibling) earningParent.insertBefore(d, banner.nextSibling); else earningParent.appendChild(d);
  }
  // Year Recap screen container (Billo v5.25)
  if (!document.getElementById('screen-year-recap')) {
    const recap = document.createElement('div');
    recap.id = 'screen-year-recap';
    recap.className = 'screen';
    recap.style.cssText = 'position:fixed;inset:0;z-index:999;overflow-y:auto;';
    document.body.appendChild(recap);
  }
  // Skeleton pulse keyframe (injected once)
  if (!document.getElementById('skeleton-style')) {
    const style = document.createElement('style');
    style.id = 'skeleton-style';
    style.textContent = '@keyframes skeletonPulse{0%,100%{opacity:1}50%{opacity:.45}}';
    document.head.appendChild(style);
  }
  if (!document.getElementById('toast-container')) {
    const tc=document.createElement('div'); tc.id='toast-container';
    tc.style.cssText='position:fixed;bottom:calc(var(--nav-h, 72px) + 8px);left:50%;transform:translateX(-50%);z-index:9998;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;width:90%;max-width:380px;';
    document.body.appendChild(tc);
  }
});

/* ── Realtime pitch status listener ─────────────────────── */
/* Listens for changes to the current user's pitch_status in
   the profiles table and updates the UI in real time.        */
async function _subscribePitchStatus() {
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;

    // Check current status on load
    const { data: profile } = await window._supabase
      .from('profiles').select('pitch_status, pitch_denial_reason, pitch_submitted_at').eq('id', user.id).single();

    /* Only fire the toast if the user hasn't seen this notification yet.
       The localStorage key is reset when _resetPitchForReupload() clears the status. */
    const _seenKey = 'vy_pitch_notif_seen_' + user.id;
    const _seenStatus = localStorage.getItem(_seenKey);

    if (profile?.pitch_status === 'approved') {
      // Suppress toast on page load — only show it on a real-time status change.
      // _seenStatus is null on first load of a new device/domain, so we always suppress
      // the initial load toast and only fire it via the realtime/polling path below.
      window._skipToast = true;
      _showPitchResult('approved', '');
      window._skipToast = false;
    } else if (profile?.pitch_status === 'denied') {
      window._skipToast = true;
      _showPitchResult('denied', profile.pitch_denial_reason || '');
      window._skipToast = false;
    } else if (profile?.pitch_status === 'pending' && profile?.pitch_submitted_at) {
      // Restore the pending banner and countdown timer for already-submitted pitches
      _restorePitchPending(profile.pitch_submitted_at);
    }

    // Listen for realtime updates
    window._supabase
      .channel('pitch-status-' + user.id)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${user.id}`,
      }, (payload) => {
        const status = payload.new?.pitch_status;
        const reason = payload.new?.pitch_denial_reason || '';
        if (status === _lastKnownStatus) return; // ignore updates that didn't change pitch_status
        _lastKnownStatus = status;
        if (status === 'approved') {
          _showPitchResult('approved', reason);
        } else if (status === 'denied') {
          _showPitchResult('denied', reason);
        }
      })
      .subscribe();

    // Polling fallback — checks every 30 seconds in case realtime is not enabled
    let _lastKnownStatus = profile?.pitch_status || 'none';
    setInterval(async () => {
      try {
        const { data: latest } = await window._supabase
          .from('profiles').select('pitch_status, pitch_denial_reason').eq('id', user.id).single();
        if (!latest) return;
        if (latest.pitch_status !== _lastKnownStatus) {
          _lastKnownStatus = latest.pitch_status;
          if (latest.pitch_status === 'approved') {
            _showPitchResult('approved', '');
          } else if (latest.pitch_status === 'denied') {
            _showPitchResult('denied', latest.pitch_denial_reason || '');
          }
        }
      } catch (_) {}
    }, 30000);

  } catch (e) {
    console.warn('[Pitch] subscribe error:', e.message);
  }
}

async function _showPitchResult(status, reason) {
  const banner = document.getElementById('pitch-pending-banner');
  if (!banner) return;

  // Track status globally so renderCampaign can use it
  window._pitchStatus = status;

  // Clear the pending countdown if active
  if (window._pitchCountdownInterval) { clearInterval(window._pitchCountdownInterval); window._pitchCountdownInterval = null; }
  window._pitchSubmitted = false;

  // Reset messages tab guard so admin DM is fetched fresh, and reload now if already visited
  if (window._tabLoaded) { window._tabLoaded.messages = false; }
  if (typeof dbLoadConversations === 'function') {
    dbLoadConversations().then(() => {
      if (typeof renderMessages === 'function') renderMessages();
    }).catch(() => {});
  }

  if (status === 'approved') {
    banner.style.background = '#F0FDF4';
    banner.style.border = '1.5px solid #86EFAC';
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:36px;height:36px;background:#DCFCE7;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px;">🎉</div>
        <div>
          <div style="font-size:14px;font-weight:700;color:#15803D;">Pitch Approved!</div>
          <div style="font-size:12px;color:#888;margin-top:1px;">You're in! Check your offers for campaigns.</div>
        </div>
      </div>`;
    if (!window._skipToast) showToast('🎉 Your pitch was approved!', 'success');
    /* Mark as seen so this toast never fires again on refresh */
    try {
      const uid = (await window._supabase.auth.getUser())?.data?.user?.id || 'u';
      localStorage.setItem('vy_pitch_notif_seen_' + uid, 'approved');
    } catch(_) {}
  } else if (status === 'denied') {
    banner.style.background = '#FFF1F2';
    banner.style.border = '1.5px solid #FECDD3';
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:36px;height:36px;background:#FFE4E6;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px;">😔</div>
        <div style="flex:1;">
          <div style="font-size:14px;font-weight:700;color:#BE123C;">Pitch Not Approved</div>
          <div style="font-size:12px;color:#888;margin-top:1px;">${reason || 'Please try again with a new video.'}</div>
        </div>
      </div>
      <button onclick="_resetPitchForReupload()" style="margin-top:10px;width:100%;padding:10px;background:#BE123C;color:white;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;">
        Re-upload pitch
      </button>`;
    if (!window._skipToast) showToast('Your pitch was not approved. Please re-upload.', 'error');
    try {
      const uid = (await window._supabase.auth.getUser())?.data?.user?.id || 'u';
      localStorage.setItem('vy_pitch_notif_seen_' + uid, 'denied');
    } catch(_) {}
  }
}

/* Restores the pending banner + countdown timer when the creator has
   already submitted a pitch in a previous session (status = 'pending').
   submittedAt is the ISO string stored in pitch_submitted_at.           */
function _restorePitchPending(submittedAt) {
  const uploadSection = document.getElementById('pitch-upload-section');
  const banner        = document.getElementById('pitch-pending-banner');
  const ctaBtn        = document.getElementById('detail-cta-btn');

  if (uploadSection) uploadSection.style.display = 'none';
  if (ctaBtn)        ctaBtn.style.display = 'none';
  if (banner)        banner.style.display = 'flex';

  // Calculate deadline from original submission time (48-hour review window)
  const submittedMs = new Date(submittedAt).getTime();
  window._pitchDeadline = submittedMs + 48 * 60 * 60 * 1000;

  // Also update detail.js module-level vars so renderCampaign doesn't hide banner
  if (typeof pitchSubmitted !== 'undefined') {
    try { pitchSubmitted = true; } catch(e) {}
  }
  window._pitchSubmitted = true;

  // Start/restart the countdown
  if (window._pitchCountdownInterval) clearInterval(window._pitchCountdownInterval);
  _updateRestoredCountdown();
  window._pitchCountdownInterval = setInterval(_updateRestoredCountdown, 1000);
}

function _updateRestoredCountdown() {
  const countdown = document.getElementById('pitch-countdown');
  const fill      = document.getElementById('pitch-progress-fill');
  if (!countdown) return;

  const remaining = window._pitchDeadline - Date.now();
  if (remaining <= 0) {
    clearInterval(window._pitchCountdownInterval);
    countdown.textContent = 'Reviewed!';
    if (fill) fill.style.width = '100%';
    return;
  }

  const totalMs = 48 * 60 * 60 * 1000;
  const elapsed = totalMs - remaining;
  const pct     = Math.min(100, Math.round((elapsed / totalMs) * 100));
  if (fill) fill.style.width = pct + '%';

  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  countdown.textContent =
    `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')} remaining`;
}

async function _resetPitchForReupload() {
  // Reset pitch_status in DB to 'none' so denied banner doesn't show on reload
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (user) {
      await window._supabase.from('profiles').update({
        pitch_status:        'none',
        pitch_video_url:     null,
        pitch_denial_reason: null,
        pitch_submitted_at:  null,
      }).eq('id', user.id);
      /* Clear the seen-flag so the next decision triggers the toast again */
      localStorage.removeItem('vy_pitch_notif_seen_' + user.id);
    }
  } catch (e) { console.warn('[Pitch] reset error:', e.message); }

  // Show upload zone and submit button again
  const uploadSection = document.getElementById('pitch-upload-section');
  const banner        = document.getElementById('pitch-pending-banner');
  const ctaBtn        = document.getElementById('detail-cta-btn');

  if (window._pitchCountdownInterval) { clearInterval(window._pitchCountdownInterval); window._pitchCountdownInterval = null; }
  window._pitchSubmitted = false;
  window._pitchStatus = 'none';

  if (uploadSection) { uploadSection.style.display = 'block'; }
  if (banner)        { banner.style.display = 'none'; }
  if (ctaBtn)        { ctaBtn.style.display = ''; ctaBtn.textContent = 'Submit pitch'; ctaBtn.disabled = false; }

  // Reset the upload zone to empty state
  const emptyZone = document.getElementById('upload-zone-empty');
  const doneZone  = document.getElementById('upload-zone-done');
  if (emptyZone) emptyZone.style.display = 'flex';
  if (doneZone)  doneZone.style.display  = 'none';

  const fileInput = document.getElementById('pitch-file-input');
  if (fileInput) fileInput.value = '';

  showToast('Upload a new video pitch!', 'success');
}
