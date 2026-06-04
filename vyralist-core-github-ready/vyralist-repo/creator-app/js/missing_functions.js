/* ============================================================
   MISSING_FUNCTIONS.JS — v1.0
   Implements every function called in HTML that had no definition.
   Also adds several quality-of-life improvements to existing flows.

   Functions defined here:
     playTaskUploadPreview()   — play local video preview in modal
     playTaskVideo()           — play the submitted task video
     selectOrgPlatform(p)      — toggle IG/TikTok org posting platform
     togglePartnershipCard(p)  — expand/collapse PA pricing card
     toggleDefaultPrice(p, e)  — toggle between platform default & custom
     savePartnershipAds(p)     — save PA settings to Supabase
   ============================================================ */

/* ── playTaskUploadPreview — plays the pending upload file inline ── */
window.playTaskUploadPreview = function() {
  const file = window._pendingTaskFile;
  if (!file) { showToast('No video selected yet', 'error'); return; }
  _openVideoModal(URL.createObjectURL(file), true);
};

/* ── playTaskVideo — plays the submitted task video (signed URL) ── */
window.playTaskVideo = async function() {
  const task = window._activeTask;
  if (!task) return;
  const storagePath = task.video_url || task.storage_path;
  if (!storagePath) { showToast('No video on file for this task', 'error'); return; }

  /* If it's already a full URL, play directly */
  if (storagePath.startsWith('http')) {
    _openVideoModal(storagePath, false);
    return;
  }

  /* Otherwise get a signed URL */
  try {
    const { data, error } = await window._supabase.storage
      .from('videos').createSignedUrl(storagePath, 3600);
    if (error || !data?.signedUrl) { showToast('Could not load video', 'error'); return; }
    _openVideoModal(data.signedUrl, false);
  } catch(e) {
    showToast('Could not load video: ' + e.message, 'error');
  }
};

/* ── Shared video modal ── */
function _openVideoModal(src, isObjectUrl) {
  /* Remove any existing modal */
  document.getElementById('_video_modal')?.remove();

  const modal = document.createElement('div');
  modal.id = '_video_modal';
  modal.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:9000',
    'background:rgba(0,0,0,.92)', 'display:flex',
    'align-items:center', 'justify-content:center',
    'flex-direction:column', 'gap:16px',
  ].join(';');

  modal.innerHTML = `
    <video id="_modal_video" src="${src}" controls playsinline autoplay
      style="max-width:min(90vw,480px);max-height:75vh;border-radius:14px;outline:none;">
    </video>
    <button onclick="document.getElementById('_video_modal').remove();"
      style="color:white;background:rgba(255,255,255,.15);border:none;border-radius:20px;
             padding:10px 28px;font-size:15px;font-weight:600;cursor:pointer;
             font-family:'Satoshi',sans-serif;">
      Close
    </button>`;

  modal.addEventListener('click', e => {
    if (e.target === modal) {
      if (isObjectUrl) {
        const v = document.getElementById('_modal_video');
        if (v) URL.revokeObjectURL(v.src);
      }
      modal.remove();
    }
  });

  document.body.appendChild(modal);
}

/* ── selectOrgPlatform — selects IG or TikTok for organic posting ── */
window.selectOrgPlatform = function(platform) {
  window._selectedOrgPlatform = platform;

  const igBtn = document.getElementById('org-platform-ig');
  const ttBtn = document.getElementById('org-platform-tt');
  const linkWrap = document.getElementById('org-post-link-wrap');

  if (igBtn && ttBtn) {
    const activeStyle = `border-color:var(--brand);background:var(--brand-soft);color:var(--brand);`;
    const inactiveStyle = `border-color:var(--border);background:white;color:var(--text);`;
    igBtn.style.cssText += platform === 'ig' ? activeStyle : inactiveStyle;
    ttBtn.style.cssText += platform === 'tt' ? activeStyle : inactiveStyle;
  }

  if (linkWrap) linkWrap.style.display = platform ? 'block' : 'none';

  const placeholder = platform === 'ig'
    ? 'https://www.instagram.com/p/...'
    : 'https://www.tiktok.com/@user/video/...';
  const linkInput = document.getElementById('org-post-link-input');
  if (linkInput) linkInput.placeholder = placeholder;
};

/* ── togglePartnershipCard — expands/collapses PA pricing panel ── */
window.togglePartnershipCard = function(platform) {
  const card  = document.getElementById(`pa-${platform}-card`);
  const panel = document.getElementById(`pa-${platform}-panel`);
  const tog   = document.getElementById(`pa-${platform}-toggle`);
  if (!card || !panel || !tog) return;

  const isOn = tog.classList.toggle('on');

  /* Animate panel open/close */
  if (isOn) {
    panel.style.display = 'block';
    panel.style.maxHeight = '0px';
    panel.style.overflow  = 'hidden';
    panel.style.transition = 'max-height .3s ease';
    requestAnimationFrame(() => { panel.style.maxHeight = panel.scrollHeight + 48 + 'px'; });
    setTimeout(() => { panel.style.maxHeight = ''; panel.style.overflow = ''; }, 320);
  } else {
    panel.style.overflow  = 'hidden';
    panel.style.maxHeight = panel.scrollHeight + 'px';
    panel.style.transition = 'max-height .25s ease';
    requestAnimationFrame(() => { panel.style.maxHeight = '0px'; });
    setTimeout(() => { panel.style.display = 'none'; panel.style.maxHeight = ''; panel.style.overflow = ''; }, 260);
  }

  /* Persist toggle state */
  const col = { meta: 'svc_pa_meta_enabled', tiktok: 'svc_pa_tiktok_enabled' }[platform];
  if (col) _persistServiceToggle(col, isOn);
};

/* ── toggleDefaultPrice — switches between platform default & custom price ── */
window.toggleDefaultPrice = function(platform, e) {
  if (e) e.stopPropagation();

  const defTog   = document.getElementById(`pa-${platform}-default-toggle`);
  const customWr = document.getElementById(`pa-${platform}-custom-wrap`);
  if (!defTog || !customWr) return;

  const usingDefault = defTog.classList.toggle('on');
  customWr.style.display = usingDefault ? 'none' : 'block';

  /* When reverting to default, reset the input to platform default */
  if (usingDefault) {
    const defaults = { meta: 80, tiktok: 70 };
    const inp = document.getElementById(`pa-${platform}-price-input`);
    if (inp) { inp.value = defaults[platform] || 80; syncPriceLabel(platform); }
  }
};

/* ── savePartnershipAds — saves PA settings for a given platform ── */
window.savePartnershipAds = async function(platform) {
  const btn = document.querySelector(`#pa-${platform}-panel .pa-save-btn`);
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) throw new Error('Not logged in');

    const isOn   = document.getElementById(`pa-${platform}-toggle`)?.classList.contains('on');
    const defOn  = document.getElementById(`pa-${platform}-default-toggle`)?.classList.contains('on');
    const priceEl = document.getElementById(`pa-${platform}-price-input`);
    const price   = priceEl ? (parseInt(priceEl.value, 10) || null) : null;

    const col = { meta: 'svc_pa_meta', tiktok: 'svc_pa_tiktok' }[platform];
    if (!col) throw new Error('Unknown platform: ' + platform);

    const payload = {
      [`${col}_enabled`]      : isOn,
      [`${col}_price`]        : defOn ? null : price,
      [`${col}_use_default`]  : defOn,
      updated_at              : new Date().toISOString(),
    };

    const { error } = await window._supabase
      .from('profiles').update(payload).eq('id', user.id);
    if (error) throw error;

    showToast(`${platform === 'meta' ? 'Meta' : 'TikTok'} ads saved!`, 'success');

    /* Update sub-label */
    const sub = document.getElementById(`pa-${platform}-sub`);
    if (sub && isOn) {
      const priceStr = defOn ? 'Platform default' : `$${price}/30 days`;
      sub.textContent = `Enabled · ${priceStr}`;
    }

  } catch(e) {
    console.warn('[PA] savePartnershipAds:', e.message);
    showToast('Could not save: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
};

/* ── _persistServiceToggle — fire-and-forget single-column profile update ── */
async function _persistServiceToggle(column, value) {
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;
    await window._supabase.from('profiles')
      .update({ [column]: value, updated_at: new Date().toISOString() })
      .eq('id', user.id);
  } catch(e) {
    console.warn('[Services] _persistServiceToggle:', e.message);
  }
}

/* ── playStorageVideo — called from My Videos screen ── */
window.playStorageVideo = async function(storagePath) {
  if (!storagePath) { showToast('No video recorded for this submission', 'error'); return; }
  if (storagePath.startsWith('http')) { _openVideoModal(storagePath, false); return; }
  try {
    const { data, error } = await window._supabase.storage
      .from('videos').createSignedUrl(storagePath, 3600);
    if (error || !data?.signedUrl) { showToast('Could not load video', 'error'); return; }
    _openVideoModal(data.signedUrl, false);
  } catch(e) { showToast('Could not load video: ' + e.message, 'error'); }
};

/* ── validateOrgLink — validates the organic post URL field ── */
window.validateOrgLink = function(input) {
  const val = (input.value || '').trim();
  const submitBtn = document.getElementById('org-submit-btn');
  const isValid = val.startsWith('https://') && val.length > 20;
  if (submitBtn) submitBtn.disabled = !isValid;
  input.style.borderColor = val.length === 0 ? 'var(--border)'
    : isValid ? 'var(--success)' : '#EF4444';
};

/* ── showBarTip / hideBarTip — portfolio chart tooltips ── */
window.showBarTip = function(el) {
  const tipId = el.dataset.tip;
  if (!tipId) return;
  const tip = document.getElementById(tipId);
  if (tip) tip.style.display = 'block';
};
window.hideBarTip = function(el) {
  const tipId = el.dataset.tip;
  if (!tipId) return;
  const tip = document.getElementById(tipId);
  if (tip) tip.style.display = '';
};

console.log('[Vyralist] missing_functions.js v1.0 loaded — 8 functions defined');

/* ═══════════════════════════════════════════════════════════
   PVP VIDEO CONTROLS  (Cards 0–3)
   ═══════════════════════════════════════════════════════════ */

const _pvpFmt = t => {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/* SVG icon strings — kept minimal for mobile perf */
const _pvpIcons = {
  play:  `<svg id="pvp-play-icon-N" viewBox="0 0 24 24" fill="#fff" width="22" height="22"><path d="M8 5v14l11-7z"/></svg>`,
  pause: `<svg id="pvp-play-icon-N" viewBox="0 0 24 24" fill="#fff" width="22" height="22"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`,
  sound: `<svg id="pvp-mute-icon-N" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" width="19" height="19"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
  mute:  `<svg id="pvp-mute-icon-N" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" width="19" height="19"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
};

function _pvpIcon(type, n) {
  return _pvpIcons[type].replace(/-N"/g, `-${n}"`);
}

function _pvpUpdateScrubber(n, pct) {
  const s = document.getElementById('pvp-scrub-' + n);
  if (!s) return;
  s.value = pct;
  s.style.background = `linear-gradient(to right,rgba(255,255,255,0.9) ${pct}%,rgba(255,255,255,0.28) ${pct}%)`;
}

function _pvpBind(n) {
  const v = document.getElementById('pvp-video-' + n);
  if (!v || v._pvpBound) return;
  v._pvpBound = true;

  v.addEventListener('timeupdate', () => {
    if (!v.duration) return;
    const pct = (v.currentTime / v.duration) * 100;
    _pvpUpdateScrubber(n, pct);
    const t = document.getElementById('pvp-time-' + n);
    if (t) t.textContent = _pvpFmt(v.currentTime);
  });

  v.addEventListener('play', () => {
    const el = document.getElementById('pvp-play-icon-' + n);
    if (el) el.outerHTML = _pvpIcon('pause', n);
  });

  v.addEventListener('pause', () => {
    const el = document.getElementById('pvp-play-icon-' + n);
    if (el) el.outerHTML = _pvpIcon('play', n);
  });

  v.addEventListener('ended', () => {
    v.currentTime = 0;
    _pvpUpdateScrubber(n, 0);
    const t = document.getElementById('pvp-time-' + n);
    if (t) t.textContent = '0:00';
  });
}

window.pvpTogglePlay = function(n) {
  const v = document.getElementById('pvp-video-' + n);
  if (!v || !v.src) return;
  _pvpBind(n);
  /* pause all other cards first */
  [0,1,2,3].filter(i => i !== n).forEach(i => {
    const other = document.getElementById('pvp-video-' + i);
    if (other && !other.paused) other.pause();
  });
  v.paused ? v.play().catch(() => {}) : v.pause();
};

window.pvpSkip = function(n, secs) {
  const v = document.getElementById('pvp-video-' + n);
  if (!v) return;
  v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + secs));
};

window.pvpSeek = function(n, pct) {
  const v = document.getElementById('pvp-video-' + n);
  if (!v || !v.duration) return;
  v.currentTime = (pct / 100) * v.duration;
  _pvpUpdateScrubber(n, pct);
};

window.pvpToggleMute = function(n) {
  const v = document.getElementById('pvp-video-' + n);
  if (!v) return;
  v.muted = !v.muted;
  const el = document.getElementById('pvp-mute-icon-' + n);
  if (el) el.outerHTML = _pvpIcon(v.muted ? 'mute' : 'sound', n);
};

/* Bind metadata listeners on load so scrubbers are ready */
document.addEventListener('DOMContentLoaded', () => {
  [1, 2, 3].forEach(n => {
    const v = document.getElementById('pvp-video-' + n);
    if (v) v.addEventListener('loadedmetadata', () => _pvpBind(n));
  });
});

/* ── Tutorial video controls ── */
window.tvPlayToggle = function() {
  const v   = document.getElementById('tutorial-bg-video');
  const btn = document.getElementById('tv-play-btn');
  if (!v) return;
  if (v.paused) {
    v.play().catch(() => {});
    if (btn) btn.style.display = 'none'; /* hide overlay once playing */
  } else {
    v.pause();
    if (btn) btn.style.display = 'flex'; /* show overlay when paused */
  }
};

window.tvToggleFullscreen = function() {
  const v = document.getElementById('tutorial-bg-video');
  if (!v) return;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else if (v.requestFullscreen) {
    v.requestFullscreen().catch(() => {});
  } else if (v.webkitEnterFullscreen) {
    /* iOS Safari fallback */
    v.webkitEnterFullscreen();
  }
};
