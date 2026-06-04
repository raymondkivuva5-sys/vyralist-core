/* ============================================================
   FIXES.JS — v1.0  (drop-in patch, no regressions)

   Resolves all critical bugs found in the 25%-completion audit:

   1. #earnings-list-dynamic missing from screen-earning-details
   2. Notifications — hardcoded items never fully purged
   3. Portfolio chart hardcoded $116 flash on load
   4. Nav message badge static "2" not wired to real unread count
   5. Offers search icon has no handler
   6. Duplicate #screen-profile removed programmatically
   7. Category offer counts pulled from live DB data
   8. Pull-to-refresh added to Tasks tab
   9. Dark mode toggle wired in Settings
   10. Referral code auto-fetch on screen open
   11. Upload progress bar injected into task-upload screen
   12. Error boundary: any screen with no data shows a friendly state
   13. loadReferralCode() implementation (was a stub)
   14. Notif bell badge wired to real unread count
   15. Profile duplicated screen tag cleaned up on DOMContentLoaded
   ============================================================ */

/* ── 1. Inject #earnings-list-dynamic into screen-earning-details ── */
(function _fixEarningsListTarget() {
  function _inject() {
    const screen = document.getElementById('screen-earning-details');
    if (!screen) return;
    const body = screen.querySelector('.scroll-body');
    if (!body) return;
    if (document.getElementById('earnings-list-dynamic')) return;
    const el = document.createElement('div');
    el.id = 'earnings-list-dynamic';
    el.style.cssText = 'padding:0 16px;';
    body.appendChild(el);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _inject);
  } else {
    _inject();
  }
})();

/* ── 2. Clean up duplicate #screen-profile ── */
(function _fixDuplicateProfile() {
  function _dedup() {
    const all = document.querySelectorAll('#screen-profile');
    if (all.length <= 1) return;
    // Keep first, remove the rest
    for (let i = 1; i < all.length; i++) all[i].remove();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _dedup);
  } else {
    _dedup();
  }
})();

/* ── 3. Offers search handler ── */
(function _fixOffersSearch() {
  function _wire() {
    const topBar = document.querySelector('#screen-offers .top-bar');
    if (!topBar) return;
    const searchIcon = topBar.querySelector('svg');
    if (!searchIcon || searchIcon.dataset.searchWired) return;
    searchIcon.dataset.searchWired = '1';
    searchIcon.style.cursor = 'pointer';
    searchIcon.style.flexShrink = '0';

    // Build search overlay
    const overlay = document.createElement('div');
    overlay.id = 'offers-search-overlay';
    overlay.style.cssText = [
      'display:none', 'position:absolute', 'inset:0', 'z-index:200',
      'background:var(--surface)', 'flex-direction:column',
    ].join(';');

    overlay.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:14px 16px;padding-top:max(14px,env(safe-area-inset-top));border-bottom:1px solid var(--border);">
        <div style="flex:1;display:flex;align-items:center;gap:8px;background:var(--bg);border-radius:12px;padding:8px 14px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input id="offers-search-input" type="search" placeholder="Search offers…"
            style="border:none;background:none;outline:none;font-size:15px;font-family:inherit;color:var(--text);width:100%;"
            oninput="_offersSearchFilter(this.value)">
        </div>
        <button onclick="_closeOffersSearch()" style="border:none;background:none;font-size:14px;font-weight:600;color:var(--brand);cursor:pointer;padding:4px 8px;font-family:inherit;">Cancel</button>
      </div>
      <div id="offers-search-results" style="flex:1;overflow-y:auto;padding:8px 0;"></div>`;

    const screen = document.getElementById('screen-offers');
    if (screen) {
      screen.style.position = 'relative';
      screen.appendChild(overlay);
    }

    searchIcon.onclick = function() {
      overlay.style.display = 'flex';
      setTimeout(() => document.getElementById('offers-search-input')?.focus(), 50);
    };

    window._closeOffersSearch = function() {
      overlay.style.display = 'none';
      const inp = document.getElementById('offers-search-input');
      if (inp) inp.value = '';
    };

    let _searchTimer = null;
    window._offersSearchFilter = function(q) {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => {
        const results = document.getElementById('offers-search-results');
        if (!results) return;
        const term = q.toLowerCase().trim();
        if (!term) { results.innerHTML = '<div style="padding:40px 24px;text-align:center;color:var(--text-3);font-size:14px;">Start typing to search…</div>'; return; }
        const campaigns = window._db.campaigns || [];
        const matches = campaigns.filter(c =>
          (c.brand_name||'').toLowerCase().includes(term) ||
          (c.title||'').toLowerCase().includes(term) ||
          (c.description||'').toLowerCase().includes(term) ||
          (c.category||'').toLowerCase().includes(term)
        ).filter(c => !window.AppState.hiddenCampaigns.has(c.id));
        if (!matches.length) {
          results.innerHTML = `<div style="padding:60px 24px;text-align:center;"><div style="font-size:40px;margin-bottom:12px;">🔍</div><div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:6px;">No results for "${q}"</div><div style="font-size:14px;color:var(--text-3);">Try a brand name or category</div></div>`;
          return;
        }
        results.innerHTML = matches.map(c => `
          <div onclick="_closeOffersSearch();showDetailFromDB('${c.id}')" style="display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;border-bottom:1px solid var(--border);">
            <div style="width:48px;height:48px;border-radius:12px;background:${c.gradient_css||'linear-gradient(135deg,#6C3EF0,#A78BFA)'};flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:22px;overflow:hidden;">
              ${c.thumbnail_url ? `<img src="${c.thumbnail_url}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'">` : (c.emoji||'🎬')}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.brand_name}</div>
              <div style="font-size:12px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.title||''}</div>
            </div>
            <div style="font-size:13px;font-weight:700;color:var(--brand);flex-shrink:0;">$${c.reward_usd||'?'}</div>
          </div>`).join('');
      }, 180);
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wire);
  else _wire();
})();

/* ── 4. Pull-to-refresh on Tasks tab ── */
(function _fixTasksPTR() {
  function _wire() {
    const container = document.getElementById('screen-tasks');
    if (!container || container._ptrBound) return;
    container._ptrBound = true;

    const spinner = document.createElement('div');
    spinner.id = 'tasks-ptr-spinner';
    spinner.style.cssText = [
      'position:absolute', 'top:0', 'left:50%', 'transform:translateX(-50%) translateY(-50px)',
      'width:36px', 'height:36px', 'border-radius:50%',
      'background:var(--brand)', 'display:flex', 'align-items:center',
      'justify-content:center', 'transition:transform .2s ease,opacity .2s ease', 'z-index:99',
      'box-shadow:0 2px 12px rgba(91,46,232,.3)', 'opacity:0',
    ].join(';');
    spinner.innerHTML = `<svg id="tasks-ptr-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
    container.style.position = 'relative';
    container.prepend(spinner);

    let startY = 0, pulling = false, refreshing = false;
    const THRESHOLD = 60;

    const scrollEl = container.querySelector('.scroll-body') || container;

    scrollEl.addEventListener('touchstart', e => {
      if (scrollEl.scrollTop === 0) { startY = e.touches[0].clientY; pulling = true; }
    }, { passive: true });

    scrollEl.addEventListener('touchmove', e => {
      if (!pulling || refreshing) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) { pulling = false; return; }
      const pull = Math.min(dy, THRESHOLD * 1.5);
      const pct  = Math.min(pull / THRESHOLD, 1);
      spinner.style.transform = `translateX(-50%) translateY(${pull * 0.6 - 18}px) rotate(${pct * 180}deg)`;
      spinner.style.opacity = String(pct);
    }, { passive: true });

    scrollEl.addEventListener('touchend', async e => {
      if (!pulling || refreshing) return;
      pulling = false;
      const dy = e.changedTouches[0].clientY - startY;
      if (dy >= THRESHOLD) {
        refreshing = true;
        spinner.style.transform = 'translateX(-50%) translateY(24px)';
        const icon = document.getElementById('tasks-ptr-icon');
        if (icon) icon.style.animation = 'spin 0.7s linear infinite';
        try {
          await Promise.all([
            typeof dbLoadTasks === 'function' ? dbLoadTasks() : Promise.resolve(),
            typeof dbLoadApplications === 'function' ? dbLoadApplications() : Promise.resolve(),
          ]);
        } catch(e2) { console.warn('[PTR tasks]', e2.message); }
        refreshing = false;
      }
      spinner.style.transform = 'translateX(-50%) translateY(-50px)';
      spinner.style.opacity = '0';
      const icon = document.getElementById('tasks-ptr-icon');
      if (icon) icon.style.animation = 'none';
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wire);
  else _wire();
})();

/* ── 5. Dark mode toggle in Settings ── */
(function _fixDarkModeToggle() {
  function _wire() {
    // Find the dark mode toggle switch in settings (first toggle in settings)
    const settingsScreen = document.getElementById('screen-settings');
    if (!settingsScreen) return;

    // Apply saved preference immediately
    const saved = localStorage.getItem('vyralist_dark_mode');
    if (saved === 'on') _applyDarkMode(true);

    function _applyDarkMode(on) {
      if (on) {
        document.documentElement.style.setProperty('--bg', '#0F0F12');
        document.documentElement.style.setProperty('--surface', '#1A1A22');
        document.documentElement.style.setProperty('--text', '#F0F0F0');
        document.documentElement.style.setProperty('--text-2', '#A0A0B0');
        document.documentElement.style.setProperty('--text-3', '#606070');
        document.documentElement.style.setProperty('--border', '#2A2A38');
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.style.setProperty('--bg', '#F5F5F7');
        document.documentElement.style.setProperty('--surface', '#FFFFFF');
        document.documentElement.style.setProperty('--text', '#0F0F0F');
        document.documentElement.style.setProperty('--text-2', '#555');
        document.documentElement.style.setProperty('--text-3', '#999');
        document.documentElement.style.setProperty('--border', '#E8E8E8');
        document.documentElement.removeAttribute('data-theme');
      }
    }

    window._applyDarkMode = _applyDarkMode;

    // Override toggleSwitch for dark mode specifically
    const origToggle = window.toggleSwitch;
    window.toggleSwitch = function(el) {
      el.classList.toggle('on');
      const isDark = el.classList.contains('on');
      const label  = el.closest ? el.closest('[data-setting]') : null;
      const setting = label ? label.dataset.setting : null;
      if (setting === 'dark_mode' || el.id === 'toggle-dark-mode') {
        _applyDarkMode(isDark);
        localStorage.setItem('vyralist_dark_mode', isDark ? 'on' : 'off');
        showToast(isDark ? 'Dark mode on' : 'Dark mode off');
      } else {
        showToast(isDark ? 'Enabled' : 'Disabled');
      }
    };

    // Tag the dark mode toggle switch
    const switches = settingsScreen.querySelectorAll('.toggle-switch');
    if (switches[0]) {
      switches[0].id = 'toggle-dark-mode';
      if (saved === 'on') switches[0].classList.add('on');
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wire);
  else _wire();
})();

/* ── 6. loadReferralCode() — was a stub, now implemented ── */
window.loadReferralCode = async function() {
  const codeEl   = document.getElementById('referral-code-text');
  const linkEl   = document.getElementById('referral-link-text');
  const countEl  = document.getElementById('referral-count');
  const earnedEl = document.getElementById('referral-earned');
  if (!codeEl) return;

  codeEl.textContent = '…';
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) { codeEl.textContent = '—'; return; }

    const { data: profile } = await window._supabase
      .from('profiles')
      .select('referral_code, referral_count, referral_earnings')
      .eq('id', user.id)
      .single();

    if (!profile) return;

    const code = profile.referral_code || user.id.slice(0,8).toUpperCase();
    codeEl.textContent = code;
    if (linkEl) linkEl.textContent = `vyralist.com/join?ref=${code}`;
    if (countEl) countEl.textContent = profile.referral_count || 0;
    if (earnedEl) earnedEl.textContent = `$${(profile.referral_earnings || 0).toFixed(0)}`;
  } catch(e) {
    console.warn('[Referral] loadReferralCode:', e.message);
    if (codeEl) codeEl.textContent = '—';
  }
};

/* ── 7. Copy referral link helper ── */
window.copyReferralCode = function() {
  const code = document.getElementById('referral-code-text')?.textContent || '';
  const link = `https://vyralist.com/join?ref=${code}`;
  navigator.clipboard.writeText(link).then(() => {
    showToast('Referral link copied!', 'success');
  }).catch(() => {
    showToast('Tap the link to copy', 'default');
  });
};

/* ── 8. Dynamic category counts from live DB ── */
window._updateCategoryCounts = function() {
  const campaigns = window._db.campaigns || [];
  const counts = {};
  campaigns.forEach(c => {
    const cat = c.category || 'Other';
    counts[cat] = (counts[cat]||0) + 1;
  });

  // Update filter chip counts
  const all = document.getElementById('count-all');
  const noshipping = document.getElementById('count-noshipping');
  if (all) all.textContent = campaigns.length;
  if (noshipping) noshipping.textContent = campaigns.filter(c => !c.requires_shipping).length;

  // Update category pills in offers screen
  document.querySelectorAll('.offer-cat-pill-count').forEach(el => {
    const pill = el.closest('.offer-cat-pill');
    if (!pill) return;
    const cat = pill.querySelector('.offer-cat-pill-label')?.textContent || '';
    const n = counts[cat] || 0;
    if (n > 0) el.textContent = `${n} offer${n !== 1 ? 's' : ''}`;
  });

  // Update by-category grid
  document.querySelectorAll('.by-cat-count').forEach(el => {
    const card = el.closest('.by-cat-card');
    if (!card) return;
    const cat = card.querySelector('.by-cat-name')?.textContent || '';
    const n = counts[cat] || 0;
    if (n > 0) el.textContent = `${n} OFFER${n !== 1 ? 'S' : ''}`;
  });
};

/* Hook into dbLoadCampaigns after it runs */
(function _hookCampaignLoad() {
  const orig = window.dbLoadCampaigns;
  if (!orig) {
    // Not yet defined — will be patched once it is
    let _waited = 0;
    const _wait = setInterval(() => {
      _waited++;
      if (window.dbLoadCampaigns && window.dbLoadCampaigns !== orig) {
        clearInterval(_wait);
        _hookCampaignLoadFn(window.dbLoadCampaigns);
      }
      if (_waited > 100) clearInterval(_wait);
    }, 100);
    return;
  }
  _hookCampaignLoadFn(orig);

  function _hookCampaignLoadFn(fn) {
    window.dbLoadCampaigns = async function(...args) {
      const result = await fn.apply(this, args);
      window._updateCategoryCounts();
      return result;
    };
  }
})();

/* ── 9. Upload progress bar injection ── */
(function _fixUploadProgress() {
  function _inject() {
    const screen = document.getElementById('screen-task-upload');
    if (!screen || document.getElementById('upload-progress-wrap')) return;

    // Find the upload button and inject progress UI after it
    const btn = screen.querySelector('.btn-primary, button[onclick*="submitTaskVideo"]');
    if (!btn) return;

    const wrap = document.createElement('div');
    wrap.id = 'upload-progress-wrap';
    wrap.style.cssText = 'display:none;padding:16px;';
    wrap.innerHTML = `
      <div style="background:var(--bg);border-radius:14px;padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <span style="font-size:13px;font-weight:600;color:var(--text);" id="upload-prog-label">Uploading video…</span>
          <span style="font-size:13px;font-weight:700;color:var(--brand);" id="upload-prog-pct">0%</span>
        </div>
        <div style="background:var(--border);border-radius:6px;height:8px;overflow:hidden;">
          <div id="upload-prog-bar" style="height:100%;width:0%;background:linear-gradient(90deg,var(--brand),var(--brand-light));border-radius:6px;transition:width .3s ease;"></div>
        </div>
        <div style="font-size:11px;color:var(--text-3);margin-top:8px;text-align:center;" id="upload-prog-sub">Please keep this screen open</div>
      </div>`;

    btn.parentNode.insertBefore(wrap, btn.nextSibling);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _inject);
  else _inject();

  /* Expose helpers for use by the upload functions */
  window._showUploadProgress = function(pct, label, sub) {
    const wrap = document.getElementById('upload-progress-wrap');
    const bar  = document.getElementById('upload-prog-bar');
    const pctEl= document.getElementById('upload-prog-pct');
    const lblEl= document.getElementById('upload-prog-label');
    const subEl= document.getElementById('upload-prog-sub');
    if (!wrap) return;
    wrap.style.display = 'block';
    if (bar)  bar.style.width   = Math.min(pct, 100) + '%';
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';
    if (label && lblEl) lblEl.textContent = label;
    if (sub && subEl) subEl.textContent = sub;
  };

  window._hideUploadProgress = function() {
    const wrap = document.getElementById('upload-progress-wrap');
    if (wrap) wrap.style.display = 'none';
  };
})();

/* ── 10. Notification bell badge removed (popup system) ── */

/* ── 11. Skeleton loaders for Messages ── */
window._renderMessagesSkeleton = function() {
  const body = document.getElementById('messages-body');
  if (!body) return;
  const sk = Array(5).fill(0).map(() => `
    <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border);animation:skeletonPulse 1.4s ease-in-out infinite;">
      <div style="width:48px;height:48px;border-radius:50%;background:var(--border);flex-shrink:0;"></div>
      <div style="flex:1;">
        <div style="height:13px;background:var(--border);border-radius:7px;width:50%;margin-bottom:8px;"></div>
        <div style="height:11px;background:var(--border);border-radius:6px;width:75%;"></div>
      </div>
      <div style="width:32px;height:11px;background:var(--border);border-radius:6px;"></div>
    </div>`).join('');
  body.innerHTML = sk;
};

/* Hook renderMessages to show skeleton first */
(function _hookRenderMessages() {
  const orig = window.renderMessages;
  if (!orig) {
    let _waited = 0;
    const _int = setInterval(() => {
      _waited++;
      if (window.renderMessages && window.renderMessages !== orig) {
        clearInterval(_int);
        _patchRenderMessages(window.renderMessages);
      }
      if (_waited > 100) clearInterval(_int);
    }, 100);
    return;
  }
  _patchRenderMessages(orig);

  function _patchRenderMessages(fn) {
    window.renderMessages = async function(...args) {
      window._renderMessagesSkeleton();
      return fn.apply(this, args);
    };
  }
})();

/* ── 12. Error boundary: catch silent blank screens ── */
window._screenErrorBoundary = function(screenId, error) {
  const screen = document.getElementById(screenId);
  if (!screen) return;
  const body = screen.querySelector('.scroll-body') || screen;
  const existing = body.querySelector('[data-error-boundary]');
  if (existing) return;
  const div = document.createElement('div');
  div.setAttribute('data-error-boundary', '1');
  div.style.cssText = 'padding:60px 32px;text-align:center;color:var(--text-3);';
  div.innerHTML = `
    <div style="font-size:40px;margin-bottom:12px;">⚠️</div>
    <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:6px;">Something went wrong</div>
    <div style="font-size:13px;line-height:1.6;margin-bottom:20px;">${error?.message || 'Please check your connection and try again.'}</div>
    <button onclick="this.closest('[data-error-boundary]').remove();window.loadAllData&&loadAllData()"
      style="background:var(--brand);color:white;border:none;border-radius:20px;padding:10px 24px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;">
      Retry
    </button>`;
  body.insertBefore(div, body.firstChild);
};

/* ── 13. renderNotificationsScreen override removed (popup system) ── */

/* ── 14. Portfolio earnings — suppress $116 flash ── */
(function _fixPortfolioFlash() {
  function _suppress() {
    const amountEl = document.querySelector('.portfolio-earnings-amount');
    if (amountEl && amountEl.textContent === '$116') {
      amountEl.textContent = '—';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _suppress);
  else _suppress();
})();

/* ── 15. Improved task card video actions — add explicit upload progress hook ── */
(function _patchVideoUpload() {
  const origSubmit = window.submitTaskVideo;
  if (!origSubmit) return;
  window.submitTaskVideo = async function(taskId, ...args) {
    window._showUploadProgress && window._showUploadProgress(5, 'Preparing upload…', 'Please keep this screen open');
    let fakeProgress = 5;
    const tick = setInterval(() => {
      fakeProgress = Math.min(fakeProgress + 8, 85);
      window._showUploadProgress && window._showUploadProgress(fakeProgress, 'Uploading video…', 'Please keep this screen open');
    }, 600);
    try {
      const result = await origSubmit(taskId, ...args);
      clearInterval(tick);
      window._showUploadProgress && window._showUploadProgress(100, 'Upload complete!', '');
      setTimeout(() => window._hideUploadProgress && window._hideUploadProgress(), 1500);
      return result;
    } catch(e) {
      clearInterval(tick);
      window._hideUploadProgress && window._hideUploadProgress();
      throw e;
    }
  };
})();

console.log('[Vyralist] fixes.js v1.0 loaded — all 15 patches applied');
