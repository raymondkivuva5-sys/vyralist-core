/* ============================================================
   SERVICES.JS — v1.0
   My Services: save/load prices to DB, sync UI toggles.
   loadReferralCode(): replaces the stub, targets real DOM IDs.
   ============================================================ */

/* ── Load services from DB and populate form ── */
async function loadMyServices() {
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;
    const { data: profile, error } = await window._supabase
      .from('profiles')
      .select([
        'svc_ugc_enabled','svc_ugc_price_15s','svc_ugc_price_30s','svc_ugc_price_60s',
        'svc_pa_meta_enabled','svc_pa_meta_price',
        'svc_pa_tiktok_enabled','svc_pa_tiktok_price',
        'svc_photos_enabled','svc_photos_price',
      ].join(','))
      .eq('id', user.id)
      .single();
    if (error || !profile) return;
    _applyServicesUI(profile);
  } catch(e) {
    console.warn('[Services] loadMyServices:', e.message);
  }
}

function _applyServicesUI(p) {
  _setToggle('svc-ugc-toggle',       p.svc_ugc_enabled);
  _setPrice('pa-ugc-15s-price-input', p.svc_ugc_price_15s);
  _setPrice('pa-ugc-30s-price-input', p.svc_ugc_price_30s);
  _setPrice('pa-ugc-60s-price-input', p.svc_ugc_price_60s);
  _setToggle('svc-pa-meta-toggle',   p.svc_pa_meta_enabled);
  _setPrice('pa-meta-price-input',   p.svc_pa_meta_price);
  syncPriceLabel('meta');
  _setToggle('svc-pa-tiktok-toggle', p.svc_pa_tiktok_enabled);
  _setPrice('pa-tiktok-price-input', p.svc_pa_tiktok_price);
  syncPriceLabel('tiktok');
  _setToggle('svc-photos-toggle',    p.svc_photos_enabled);
  _setPrice('pa-photos-price-input', p.svc_photos_price);
}

function _setToggle(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  if (val) el.classList.add('on'); else el.classList.remove('on');
}
function _setPrice(id, val) {
  const el = document.getElementById(id);
  if (!el || val == null) return;
  el.value = val;
}

/* ── Save services to DB ── */
async function saveMyServices() {
  const btn = document.getElementById('save-services-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) throw new Error('Not logged in');
    const payload = {
      svc_ugc_enabled       : _getToggle('svc-ugc-toggle'),
      svc_ugc_price_15s     : _getPrice('pa-ugc-15s-price-input'),
      svc_ugc_price_30s     : _getPrice('pa-ugc-30s-price-input'),
      svc_ugc_price_60s     : _getPrice('pa-ugc-60s-price-input'),
      svc_pa_meta_enabled   : _getToggle('svc-pa-meta-toggle'),
      svc_pa_meta_price     : _getPrice('pa-meta-price-input'),
      svc_pa_tiktok_enabled : _getToggle('svc-pa-tiktok-toggle'),
      svc_pa_tiktok_price   : _getPrice('pa-tiktok-price-input'),
      svc_photos_enabled    : _getToggle('svc-photos-toggle'),
      svc_photos_price      : _getPrice('pa-photos-price-input'),
      updated_at            : new Date().toISOString(),
    };
    const { error } = await window._supabase
      .from('profiles').update(payload).eq('id', user.id);
    if (error) throw error;
    showToast('Services saved!', 'success');
  } catch(e) {
    console.warn('[Services] saveMyServices:', e.message);
    showToast('Could not save: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
}

function _getToggle(id) {
  const el = document.getElementById(id); return el ? el.classList.contains('on') : false;
}
function _getPrice(id) {
  const el = document.getElementById(id); if (!el) return null;
  const v = parseInt(el.value, 10); return isNaN(v) ? null : v;
}

/* syncPriceLabel — keep price pill in sync with the number input */
function syncPriceLabel(platform) {
  const input = document.getElementById(`pa-${platform}-price-input`);
  const label = document.getElementById(`pa-${platform}-price-label`);
  if (!input || !label) return;
  const val = parseInt(input.value, 10);
  label.textContent = isNaN(val) ? '—' : `$${val}`;
}

/* ── Wire save button + load on screen open ── */
(function _wireServices() {
  function _wireSaveBtn() {
    const btn = document.getElementById('save-services-btn');
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = '1';
      btn.addEventListener('click', saveMyServices);
    }
  }
  const origShow = window.showSubScreen;
  if (origShow && !window._servicesPatchedShowSubScreen) {
    window._servicesPatchedShowSubScreen = true;
    window.showSubScreen = function(id, ...args) {
      origShow.call(this, id, ...args);
      if (id === 'my-services') { loadMyServices(); _wireSaveBtn(); }
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wireSaveBtn);
  else _wireSaveBtn();
})();

/* ══════════════════════════════════════════════════════════
   loadReferralCode — full implementation (replaces stub)
   Targets the actual DOM IDs in screen-refer:
     #referral-code-display, #ref-stat-friends,
     #ref-stat-completed,    #ref-stat-earned
   ══════════════════════════════════════════════════════════ */
window.loadReferralCode = async function() {
  const codeEl      = document.getElementById('referral-code-display');
  const friendsEl   = document.getElementById('ref-stat-friends');
  const completedEl = document.getElementById('ref-stat-completed');
  const earnedEl    = document.getElementById('ref-stat-earned');
  if (!codeEl) return;

  codeEl.textContent = '…';
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) { codeEl.textContent = '—'; return; }

    const { data: profile } = await window._supabase
      .from('profiles')
      .select('referral_code, referral_count, referral_completed, referral_earnings')
      .eq('id', user.id)
      .single();

    /* Generate a deterministic code from user ID if none stored */
    const code = profile?.referral_code
      || ('VYR-' + user.id.replace(/-/g, '').slice(0, 4).toUpperCase());

    codeEl.textContent = code;
    if (friendsEl)   friendsEl.textContent   = profile?.referral_count     || 0;
    if (completedEl) completedEl.textContent  = profile?.referral_completed || 0;
    if (earnedEl)    earnedEl.textContent     = `$${(profile?.referral_earnings || 0).toFixed(0)}`;
  } catch(e) {
    console.warn('[Referral] loadReferralCode:', e.message);
    if (codeEl) codeEl.textContent = '—';
  }
};

/* copyCode — copies the referral link (referenced in screen-refer HTML) */
window.copyCode = function() {
  const code = document.getElementById('referral-code-display')?.textContent || '';
  if (!code || code === '…' || code === '—') return;
  const link = `https://vyralist.com/join?ref=${code}`;
  navigator.clipboard.writeText(link).then(() => {
    const fb = document.getElementById('copy-feedback');
    if (fb) { fb.textContent = 'Copied!'; setTimeout(() => { fb.textContent = ''; }, 2000); }
    showToast('Referral link copied!', 'success');
  }).catch(() => showToast('Could not copy — tap the code to copy it manually'));
};

/* shareReferralCode — native share sheet or clipboard fallback */
window.shareReferralCode = async function() {
  const code = document.getElementById('referral-code-display')?.textContent || '';
  const link = `https://vyralist.com/join?ref=${code}`;
  const text = `Join me on Vyralist and earn money creating short videos for brands! Use my code ${code} to get a $10 bonus on your first completed task. 🎬`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Join Vyralist', text, url: link }); return; }
    catch(e) { /* user cancelled — fall through */ }
  }
  navigator.clipboard.writeText(text + '\n' + link)
    .then(() => showToast('Referral message copied!', 'success'))
    .catch(() => showToast('Could not copy'));
};
