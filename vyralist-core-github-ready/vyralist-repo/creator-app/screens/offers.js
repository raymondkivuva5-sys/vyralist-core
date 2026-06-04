/* ============================================================
   OFFERS.JS — Offers screen, campaign filters, detail view,
   apply flow, screening questions, DB campaign CRUD.
   ============================================================ */

/* ── Hidden campaigns state — managed by state.js / AppState ── */
/* AppState.hiddenCampaigns is seeded from localStorage in state.js.
   dismissCampaign() in state.js handles persistence.
   Local overrides removed to avoid double-init conflicts.           */

function dismissCampaign(campaignId, cardEl) {
  window.AppState.hiddenCampaigns.add(campaignId);
  try {
    localStorage.setItem('vyralist_hidden_campaigns',
      JSON.stringify([...window.AppState.hiddenCampaigns]));
  } catch (e) { /* storage full — hidden set still works in-memory */ }
  if (cardEl) {
    cardEl.style.transition = 'opacity .22s ease, transform .22s ease, max-height .28s ease';
    cardEl.style.opacity = '0';
    cardEl.style.transform = 'scale(0.94)';
    cardEl.style.maxHeight = cardEl.offsetHeight + 'px';
    setTimeout(() => {
      cardEl.style.maxHeight = '0';
      cardEl.style.overflow = 'hidden';
      cardEl.style.marginBottom = '0';
    }, 220);
    setTimeout(() => renderOffersScreen(), 320);
  } else {
    renderOffersScreen();
  }
  /* ── Undo toast — 5-second restore window ─────────── */
  _showUndoDismissToast(campaignId);
}

function _showUndoDismissToast(campaignId) {
  const existing = document.getElementById('undo-dismiss-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'undo-dismiss-toast';
  toast.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#1a1a1a;color:#fff;font-size:13px;font-weight:500;padding:12px 18px;border-radius:24px;display:flex;align-items:center;gap:14px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.25);white-space:nowrap;';
  toast.innerHTML = `<span>Campaign hidden</span><span onclick="_undoDismiss('${campaignId}')" style="color:#A78BFA;font-weight:700;cursor:pointer;text-decoration:underline;text-underline-offset:2px;">Undo</span>`;
  document.body.appendChild(toast);
  const iv = setTimeout(() => toast.remove(), 5000);
  toast._clearTimer = () => clearTimeout(iv);
}

function _undoDismiss(campaignId) {
  window.AppState.hiddenCampaigns.delete(campaignId);
  try {
    localStorage.setItem('vyralist_hidden_campaigns',
      JSON.stringify([...window.AppState.hiddenCampaigns]));
  } catch (e) {}
  const toast = document.getElementById('undo-dismiss-toast');
  if (toast) { toast._clearTimer?.(); toast.remove(); }
  renderOffersScreen();
  showToast('Campaign restored', 'success');
}

/* ── Pull-to-refresh on Offers feed ─────────────────────── */
let _ptr_startY = 0, _ptr_pulling = false, _ptr_refreshing = false;
const _PTR_THRESHOLD = 60;

function _initPullToRefresh() {
  const container = document.getElementById('screen-offers');
  if (!container || container._ptrBound) return;
  container._ptrBound = true;

  if (!document.getElementById('offers-ptr-spinner')) {
    const spinner = document.createElement('div');
    spinner.id = 'offers-ptr-spinner';
    spinner.style.cssText = [
      'position:absolute', 'top:0', 'left:50%', 'transform:translateX(-50%) translateY(-50px)',
      'width:36px', 'height:36px', 'border-radius:50%',
      'background:var(--brand,#6C3EF0)', 'display:flex', 'align-items:center',
      'justify-content:center', 'transition:transform .2s ease,opacity .2s ease', 'z-index:99',
      'box-shadow:0 2px 12px rgba(108,62,240,.3)', 'opacity:0',
    ].join(';');
    spinner.innerHTML = `<svg id="offers-ptr-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
    container.style.position = 'relative';
    container.prepend(spinner);
  }

  if (!document.getElementById('ptr-spin-style')) {
    const s = document.createElement('style');
    s.id = 'ptr-spin-style';
    s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }

  container.addEventListener('touchstart', (e) => {
    if (container.scrollTop === 0) { _ptr_startY = e.touches[0].clientY; _ptr_pulling = true; }
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    if (!_ptr_pulling || _ptr_refreshing) return;
    const dy = e.touches[0].clientY - _ptr_startY;
    if (dy <= 0) { _ptr_pulling = false; return; }
    const spinner = document.getElementById('offers-ptr-spinner');
    const pull = Math.min(dy, _PTR_THRESHOLD * 1.5);
    const pct  = Math.min(pull / _PTR_THRESHOLD, 1);
    if (spinner) {
      spinner.style.transform = `translateX(-50%) translateY(${pull * 0.6 - 18}px) rotate(${pct * 180}deg)`;
      spinner.style.opacity = String(pct);
    }
  }, { passive: true });

  container.addEventListener('touchend', async (e) => {
    if (!_ptr_pulling || _ptr_refreshing) return;
    _ptr_pulling = false;
    const dy = e.changedTouches[0].clientY - _ptr_startY;
    const spinner = document.getElementById('offers-ptr-spinner');
    if (dy >= _PTR_THRESHOLD) {
      _ptr_refreshing = true;
      if (spinner) {
        spinner.style.transform = 'translateX(-50%) translateY(24px)';
        const icon = document.getElementById('offers-ptr-icon');
        if (icon) icon.style.animation = 'spin 0.7s linear infinite';
      }
      try { await dbLoadCampaigns(); } catch (e2) { console.warn('[PTR]', e2.message); }
      _ptr_refreshing = false;
    }
    if (spinner) {
      spinner.style.transform = 'translateX(-50%) translateY(-50px)';
      spinner.style.opacity = '0';
      const icon = document.getElementById('offers-ptr-icon');
      if (icon) icon.style.animation = 'none';
    }
  }, { passive: true });
}

/* ── Invitation expiry countdown helper ─────────────────── */
function _inviteExpiryLabel(app) {
  if (!app.expires_at) return '';
  const ms = new Date(app.expires_at) - Date.now();
  if (ms <= 0) return `<span style="color:#EF4444;font-size:11px;font-weight:700;">Expired</span>`;
  const h = Math.floor(ms / 3600000);
  if (h < 24) return `<span style="color:#F59E0B;font-size:11px;font-weight:600;">Expires in ${h}h</span>`;
  const d = Math.floor(h / 24), rem = h % 24;
  return `<span style="color:#F59E0B;font-size:11px;font-weight:600;">Expires in ${d}d ${rem}h</span>`;
}

/* ── Render offers screen ─────────────────────────────────── */
function renderOffersScreen() {
  // Debounce: if two callers fire in the same tick (e.g. dbLoadCampaigns +
  // dbLoadApplications both finishing), collapse to a single deferred render.
  if (_renderOffersScheduled) return;
  _renderOffersScheduled = true;
  setTimeout(_doRenderOffersScreen, 0);
}

function _doRenderOffersScreen() {
  _renderOffersScheduled = false;
  const allCampaigns = window._db.campaigns;
  // Filter hidden campaigns before rendering
  const campaigns = allCampaigns.filter(c => !window.AppState.hiddenCampaigns.has(c.id));

  // Invitations banner — with expiry countdown
  const invitations = (window._db.applications || []).filter(a => a.status === 'invited');
  const invBannerEl = document.getElementById('offers-invitations-banner');
  if (invBannerEl) {
    if (invitations.length) {
      invBannerEl.style.display = 'block';
      invBannerEl.innerHTML = invitations.map(a => {
        const c = window._db.campaigns.find(x => x.id === a.campaign_id) || a.campaigns || {};
        const pay = c.reward_usd ? `$${c.reward_usd}${c.reward_product ? ' + product' : ''}` : '';
        const expiryLabel = _inviteExpiryLabel(a);
        return `
          <div onclick="showDetailFromDB('${c.id || a.campaign_id}')" style="display:flex;align-items:center;gap:12px;background:white;border:2px solid #F59E0B;border-radius:14px;padding:12px 14px;cursor:pointer;margin-bottom:10px;">
            <div style="width:44px;height:44px;border-radius:10px;flex-shrink:0;background:${c.gradient_css||'linear-gradient(135deg,#EDE8FD,#D4BBFC)'};overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:20px;position:relative;">
              ${c.thumbnail_url ? `<img src="${c.thumbnail_url}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;" onerror="this.style.display='none';">` : (c.emoji||'🎬')}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.brand_name||'Brand'} – ${c.title||''}</div>
              ${pay ? `<div style="font-size:12px;color:var(--text-2);margin-top:2px;">${pay}</div>` : ''}
              ${expiryLabel ? `<div style="margin-top:3px;">${expiryLabel}</div>` : ''}
            </div>
            <div style="background:#FEF3C7;color:#D97706;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;white-space:nowrap;">Express interest</div>
          </div>`;
      }).join('');
    } else {
      invBannerEl.style.display = 'none';
    }
  }

  const suggestedEl = document.getElementById('offers-suggested-dynamic');
  if (suggestedEl) {
    const suggested = campaigns.filter(c => c.is_suggested).slice(0, 10);
    suggestedEl.innerHTML = suggested.map(c => offerCardH(c)).join('');
  }

  const newOffersEl = document.getElementById('new-offers-hscroll');
  if (newOffersEl) {
    const newest = [...campaigns]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10);
    newOffersEl.innerHTML = newest.map(c => offerCardV(c)).join('');
  }

  const listEl = document.getElementById('campaign-list-dynamic');
  if (listEl) {
    const firstPage = campaigns.slice(0, _campaignPageSize);
    listEl.innerHTML = firstPage.length
      ? firstPage.map(c => offerCardFull(c)).join('')
      : `<div style="padding:60px 32px;text-align:center;color:#999;"><div style="font-size:48px;margin-bottom:12px;">📭</div><div style="font-size:16px;font-weight:600;color:#333;margin-bottom:6px;">No campaigns available</div><div style="font-size:14px;line-height:1.6;">Check back soon — new brand opportunities are added regularly.</div></div>`;
    _campaignOffset = firstPage.length;
    _attachPaginationSentinel(campaigns);
  }

  const nsCount = campaigns.filter(c => !c.requires_shipping).length;
  const nsChip  = document.getElementById('count-noshipping');
  if (nsChip) nsChip.textContent = nsCount;
  const allChip = document.getElementById('count-all');
  if (allChip) allChip.textContent = campaigns.length;

  _updateCategoryCounts(campaigns);
  _initPullToRefresh();
}

/* ── Category counts — live tally from real campaigns ────── */
function _updateCategoryCounts(campaigns) {
  // Build a tally map: category → count
  const tally = {};
  campaigns.forEach(c => {
    const cat = (c.product_category || c.category || 'Other').trim();
    tally[cat] = (tally[cat] || 0) + 1;
  });

  // Update every element that has data-category attribute (pills + grid cards)
  document.querySelectorAll('[data-category]').forEach(el => {
    const cat   = el.getAttribute('data-category');
    const count = tally[cat] || 0;
    const isCaps = el.classList.contains('by-cat-count'); // grid cards use UPPERCASE
    el.textContent = isCaps
      ? `${count} OFFER${count !== 1 ? 'S' : ''}`
      : `${count} offer${count !== 1 ? 's' : ''}`;
  });
}

/* ── Infinite scroll / pagination ────────────────────────── */
const _campaignPageSize = 20;
let   _campaignOffset   = 0;
let   _paginationObserver = null;
// Debounce flag: renderOffersScreen() is called by both dbLoadCampaigns and
// dbLoadApplications which run in parallel. Without this, two renders fire
// in the same tick causing a visible flash and redundant DOM work.
let _renderOffersScheduled = false;

function _attachPaginationSentinel(campaigns) {
  const old = document.getElementById('offers-pagination-sentinel');
  if (old) old.remove();
  if (_paginationObserver) { _paginationObserver.disconnect(); _paginationObserver = null; }
  if (_campaignOffset >= campaigns.length) return;

  const listEl = document.getElementById('campaign-list-dynamic');
  if (!listEl) return;

  const sentinel = document.createElement('div');
  sentinel.id = 'offers-pagination-sentinel';
  sentinel.style.cssText = 'height:1px;width:100%;';
  listEl.appendChild(sentinel);

  _paginationObserver = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    const nextBatch = campaigns.slice(_campaignOffset, _campaignOffset + _campaignPageSize);
    if (!nextBatch.length) { _paginationObserver.disconnect(); sentinel.remove(); return; }
    nextBatch.forEach(c => {
      const div = document.createElement('div');
      div.innerHTML = offerCardFull(c);
      listEl.insertBefore(div.firstElementChild, sentinel);
    });
    _campaignOffset += nextBatch.length;
    if (_campaignOffset >= campaigns.length) { _paginationObserver.disconnect(); sentinel.remove(); }
  }, { rootMargin: '120px' });

  _paginationObserver.observe(sentinel);
}

/* ── Filter chips ────────────────────────────────────────── */
function setFilter(type, el) {
  document.querySelectorAll('#screen-offers .filter-row .chip').forEach(c => c.classList.remove('active'));
  if (el) {
    el.classList.add('active');
    // Scroll the chip fully into view within the filter row
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }

  document.getElementById('offers-suggested-view').style.display = 'none';
  document.getElementById('offers-category-view').style.display  = 'none';
  document.getElementById('campaign-list').style.display         = 'none';
  const backBtn = document.querySelector('#screen-offers .top-bar .back-btn');
  if (backBtn) backBtn.remove();
  document.querySelector('#screen-offers .top-bar h1').textContent = 'Offers';

  const campaigns = (window._db.campaigns || [])
    .filter(c => !window.AppState.hiddenCampaigns.has(c.id));

  if (type === 'suggested') {
    document.getElementById('offers-suggested-view').style.display = 'block';
  } else if (type === 'category') {
    document.getElementById('offers-category-view').style.display = 'block';
  } else if (type === 'noshipping') {
    const filtered = campaigns.filter(c => !c.requires_shipping)
      .sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    const listEl = document.getElementById('campaign-list-dynamic');
    if (listEl) {
      const firstPage = filtered.slice(0, _campaignPageSize);
      listEl.innerHTML = firstPage.length
        ? firstPage.map(c => offerCardFull(c)).join('')
        : `<div style="padding:60px 32px;text-align:center;color:#999;"><div style="font-size:48px;margin-bottom:12px;">📦</div><div style="font-size:16px;font-weight:600;color:#333;margin-bottom:6px;">No digital campaigns right now</div><div style="font-size:14px;line-height:1.6;color:#888;">Digital campaigns don't require shipping — check back soon or browse all offers.</div></div>`;
      _campaignOffset = firstPage.length;
      _attachPaginationSentinel(filtered);
    }
    document.getElementById('campaign-list').style.display = 'flex';
  } else if (type === 'all') {
    const sorted = [...campaigns].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    const listEl = document.getElementById('campaign-list-dynamic');
    if (listEl) {
      const firstPage = sorted.slice(0, _campaignPageSize);
      listEl.innerHTML = firstPage.length
        ? firstPage.map(c => offerCardFull(c)).join('')
        : `<div style="padding:60px 32px;text-align:center;color:#999;"><div style="font-size:48px;margin-bottom:12px;">📭</div><div style="font-size:16px;font-weight:600;color:#333;margin-bottom:6px;">No campaigns yet</div></div>`;
      _campaignOffset = firstPage.length;
      _attachPaginationSentinel(sorted);
    }
    document.getElementById('campaign-list').style.display = 'flex';
  }
}

function showCampaignList(category) {
  document.getElementById('offers-suggested-view').style.display = 'none';
  document.getElementById('offers-category-view').style.display  = 'none';

  const listEl = document.getElementById('campaign-list');
  listEl.style.display = 'flex';
  listEl.style.flexDirection = 'column';

  document.querySelector('#screen-offers .top-bar h1').textContent = category;

  const topBar = document.querySelector('#screen-offers .top-bar');
  if (!topBar.querySelector('.back-btn')) {
    const btn = document.createElement('div');
    btn.className = 'back-btn';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>`;
    btn.onclick = showAllCategories;
    topBar.insertBefore(btn, topBar.firstChild);
  }

  /* Render from live DB filtered by category */
  const campaigns = (window._db.campaigns || []).filter(c => {
    if (!category || category === 'All') return true;
    return (c.category || 'Other') === category;
  }).filter(c => !window.AppState.hiddenCampaigns.has(c.id));

  if (!campaigns.length) {
    listEl.innerHTML = `<div style="padding:60px 32px;text-align:center;color:var(--text-3);">
      <div style="font-size:40px;margin-bottom:12px;">📂</div>
      <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:6px;">No offers in ${category}</div>
      <div style="font-size:14px;">Check back soon — new campaigns are added weekly.</div>
    </div>`;
    return;
  }

  const calcMatchScore = typeof window.calcMatchScore === 'function' ? window.calcMatchScore : () => null;
  listEl.innerHTML = campaigns.map(c => {
    const score = calcMatchScore(c);
    return typeof offerCardFull === 'function'
      ? offerCardFull(c, score)
      : `<div class="campaign-card" onclick="showDetailFromDB('${c.id}')">
           <div style="height:140px;background:${c.gradient_css||'linear-gradient(135deg,#6C3EF0,#A78BFA)'};position:relative;display:flex;align-items:center;justify-content:center;font-size:40px;">
             ${c.thumbnail_url?`<img src="${c.thumbnail_url}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;" onerror="this.style.display='none'">`:''}
             <span>${c.emoji||'🎬'}</span>
           </div>
           <div class="campaign-info">
             <h3>${c.brand_name} — ${c.title||''}</h3>
             <div class="campaign-meta">
               <div class="meta-row">
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                 ${typeof _getPayStr==='function'?_getPayStr(c,false):('From $'+(c.reward_usd||'?'))}
               </div>
             </div>
           </div>
         </div>`;
  }).join('');
}

function showAllCategories() {
  document.getElementById('offers-category-view').style.display  = 'block';
  document.getElementById('offers-suggested-view').style.display = 'none';
  document.getElementById('campaign-list').style.display         = 'none';
  document.querySelector('#screen-offers .top-bar h1').textContent = 'Offers';
  const backBtn = document.querySelector('#screen-offers .top-bar .back-btn');
  if (backBtn) backBtn.remove();
}

/* ── Detail view ─────────────────────────────────────────── */
function toggleDetailDesc() {
  const descEl = document.getElementById('detail-desc');
  const toggle = document.getElementById('detail-desc-toggle');
  if (!descEl || !toggle) return;
  window._detailDescExpanded = !window._detailDescExpanded;
  descEl.style.webkitLineClamp = window._detailDescExpanded ? 'unset' : '4';
  descEl.style.overflow = window._detailDescExpanded ? 'visible' : 'hidden';
  toggle.textContent = window._detailDescExpanded ? 'See less' : 'See more';
}

function showDetailFromDB(campaignId) {
  const c = window._db.campaigns.find(x => x.id === campaignId);
  if (!c) return;
  window._currentCampaignId = campaignId;

  // Push the current screen onto the back-stack so goBack() returns here correctly.
  // Use the real AppState screen if available, fall back to currentTab.
  const from = (window.AppState && AppState.currentScreen) || currentTab || 'offers';
  if (!window._navStack) window._navStack = [];
  window._navStack.push(from);

  previousTab = currentTab; currentTab = 'detail';

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('screen-detail').classList.add('active');

  document.getElementById('detail-title').textContent = `${c.brand_name} – ${c.title}`;

  const shippingBanner = document.getElementById('detail-shipping-banner');
  const shippingText   = document.getElementById('detail-shipping-text');
  if (shippingBanner && shippingText) {
    shippingBanner.style.display = 'flex';
    shippingText.textContent = c.requires_shipping
      ? 'Product shipping required'
      : 'Instant task - no product shipping required!';
  }

  const rewardSection = document.getElementById('detail-reward-section');
  const rewardText    = document.getElementById('detail-reward-text');
  if (rewardSection && rewardText) {
    const amt    = c.reward_usd || c.reward_cash || null;
    const reward = amt
      ? `From $${amt}${(c.reward_product || c.requires_shipping) ? ' + free product' : ''}`
      : 'To be confirmed';
    rewardSection.style.display = 'block';
    rewardText.textContent = reward;
  }

  const productSection      = document.getElementById('detail-product-section');
  const pitchProductSection = document.getElementById('detail-pitch-product-section');
  if (productSection)      productSection.style.display      = 'block';
  if (pitchProductSection) pitchProductSection.style.display = 'none';

  // Product name — clickable link if product_url exists
  const productNameEl = document.getElementById('detail-product-name');
  if (productNameEl) {
    const name = c.product_name || c.brand_name || '';
    const url  = c.product_url || null;
    if (url) {
      productNameEl.innerHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer"
        style="color:var(--brand);text-decoration:underline;cursor:pointer;">${name}</a>`;
    } else {
      productNameEl.textContent = name;
    }
  }

  const descEl    = document.getElementById('detail-desc');
  const descToggle = document.getElementById('detail-desc-toggle');
  if (descEl) {
    descEl.textContent = c.description || '';
    descEl.style.webkitLineClamp = '4'; descEl.style.overflow = 'hidden';
  }
  if (descToggle) {
    descToggle.style.display = c.description && c.description.length > 200 ? 'block' : 'none';
    descToggle.textContent = 'See more'; window._detailDescExpanded = false;
  }

  const durationPill = document.getElementById('detail-duration-pill');
  if (durationPill) durationPill.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> ${c.duration || 30} sec.`;

  const scenarioEl = document.getElementById('detail-scenario-content');
  if (scenarioEl) scenarioEl.innerHTML = c.scenario
    ? `<p style="font-size:14px;line-height:1.7;color:var(--text-2);white-space:pre-line;">${c.scenario}</p>`
    : `<p style="font-size:14px;line-height:1.7;color:var(--text-3);">No scenario provided yet.</p>`;

  const additionalEl = document.getElementById('detail-additional-content');
  if (additionalEl) additionalEl.innerHTML = c.additional_context
    ? `<span class="label-sm">Additional context</span><p style="font-size:14px;line-height:1.7;color:var(--text-2);white-space:pre-line;">${c.additional_context}</p>`
    : `<p style="font-size:14px;color:var(--text-3);">No additional details provided.</p>`;

  const dosSection = document.getElementById('detail-dos-donts');
  const dosContent = document.getElementById('detail-dos-donts-content');
  if (dosSection && dosContent) {
    if (c.dos_and_donts) {
      dosSection.style.display = 'block';
      dosContent.innerHTML = c.dos_and_donts.split('\n').filter(l => l.trim()).map(line => {
        const isDo   = /^(DO:|✅)/i.test(line.trim());
        const isDont = /^(DON'T:|❌)/i.test(line.trim());
        const icon   = isDo ? '✅' : isDont ? '❌' : '•';
        const text   = line.replace(/^(DO:|DON'T:|✅|❌)\s*/i, '').trim();
        return `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;font-size:14px;line-height:1.5;"><span>${icon}</span><span>${text}</span></div>`;
      }).join('');
    } else { dosSection.style.display = 'none'; }
  }

  ['example-videos-section','pitch-upload-section','pitch-pending-banner'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });

  const detailHero = document.querySelector('.detail-hero-bg');
  if (detailHero) {
    detailHero.style.background = c.gradient_css || 'linear-gradient(135deg,#6C3EF0,#A78BFA)';
    const existingImg = detailHero.querySelector('img');
    if (existingImg) existingImg.remove();
    if (c.thumbnail_url) {
      const img = document.createElement('img');
      img.src = c.thumbnail_url;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0;';
      img.onerror = () => img.remove();
      detailHero.prepend(img);
    }
  }

  const logoEl = document.querySelector('#screen-detail .detail-logo');
  if (logoEl) {
    const initials = (c.brand_name || 'BR').split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    if (c.logo_url) {
      const img = document.createElement('img');
      img.src = c.logo_url; img.alt = c.brand_name || '';
      img.onerror = () => { img.remove(); logoEl.textContent = initials; };
      logoEl.innerHTML = ''; logoEl.appendChild(img);
    } else { logoEl.innerHTML = ''; logoEl.textContent = initials; }
  }

  window._activeBriefUrl = c.brief_document_url || null;
  const briefRow   = document.getElementById('task-brief-doc-row');
  const briefLabel = document.getElementById('task-brief-doc-label');
  if (briefRow) {
    briefRow.style.display = c.brief_document_url ? 'block' : 'none';
    if (c.brief_document_url && briefLabel) {
      briefLabel.textContent = /docs\.google\.com|drive\.google\.com/i.test(c.brief_document_url)
        ? 'Google Doc — tap to view' : 'PDF brief — tap to view';
    }
  }

  const ctaBtn = document.getElementById('detail-cta-btn');
  if (ctaBtn) {
    const existingApp = window._db.applications.find(a => a.campaign_id === campaignId);
    const isInvited   = existingApp?.status === 'invited';
    const isApplied   = existingApp && !isInvited;
    ctaBtn.style.display = ''; ctaBtn.disabled = isApplied;
    if (isApplied) {
      ctaBtn.textContent = 'Applied ✓'; ctaBtn.onclick = null;
    } else if (isInvited) {
      ctaBtn.textContent = '✉️ Express interest';
      ctaBtn.onclick = () => dbExpressInterest(existingApp.id, campaignId);
    } else {
      ctaBtn.textContent = 'Apply';
      ctaBtn.onclick = () => dbHandleApply(campaignId, c.brand_name, c.reward_usd, c.reward_product);
    }
  }
}

/* ── Apply flow ──────────────────────────────────────────── */
async function dbHandleApply(campaignId, brandName, rewardUsd, rewardProduct) {
  /* ── Pitch gate: creator must have an approved pitch ─── */
  const pitchStatus = window._pitchStatus || window._profileSignals?.pitchStatus || 'none';
  if (pitchStatus !== 'approved') {
    const msg = pitchStatus === 'pending'
      ? 'Your pitch is still under review. You can apply once it\'s approved — usually within 48 hours.'
      : 'You need an approved video pitch before applying to campaigns. Head to the Overview tab to upload yours.';
    showToast(msg, 'error');
    return;
  }

  const c = window._db.campaigns.find(x => x.id === campaignId);
  const questions = c?.screening_questions;
  if (questions && questions.length > 0) {
    window._pendingApply = { campaignId, brandName, rewardUsd, rewardProduct };
    document.getElementById('screening-modal-title').textContent = `Apply to ${brandName}`;
    document.getElementById('screening-modal-subtitle').textContent =
      'Answer a few quick questions from the brand before submitting your application.';
    const list = document.getElementById('screening-questions-list');

    // Pre-fill previously saved answers if creator re-opens a partial application
    const existingApp = window._db.applications.find(
      a => a.campaign_id === campaignId && a.screening_answers
    );
    const savedAnswers = existingApp?.screening_answers || {};

    list.innerHTML = questions.map((q, i) => {
      const savedVal = savedAnswers[q.id || q.text] || '';
      if (q.type === 'select' && q.options?.length) {
        const opts = q.options.map(o =>
          `<option value="${o}"${o === savedVal ? ' selected' : ''}>${o}</option>`
        ).join('');
        return `<div><label style="font-size:13px;font-weight:600;color:var(--text);display:block;margin-bottom:6px;">${q.text}</label><select class="form-select" id="sq-${i}" style="width:100%;padding:12px 14px;border:1.5px solid var(--border);border-radius:12px;font-size:14px;font-family:'Satoshi',sans-serif;color:var(--text);background:white;appearance:none;"><option value="">Select an answer…</option>${opts}</select></div>`;
      }
      return `<div><label style="font-size:13px;font-weight:600;color:var(--text);display:block;margin-bottom:6px;">${q.text}</label><textarea class="form-input" id="sq-${i}" rows="3" placeholder="Your answer…" style="resize:none;">${savedVal}</textarea></div>`;
    }).join('');
    document.getElementById('modal-screening').classList.add('open');
    return;
  }
  await _doApply(campaignId, brandName, rewardUsd, rewardProduct, null);
}

async function submitScreeningAnswers() {
  const p = window._pendingApply;
  if (!p) return;
  const c = window._db.campaigns.find(x => x.id === p.campaignId);
  const questions = c?.screening_questions || [];
  const answers = {};
  for (let i = 0; i < questions.length; i++) {
    const el = document.getElementById(`sq-${i}`);
    const val = el?.value?.trim() || '';
    if (!val) { showToast('Please answer all questions', 'error'); el?.focus(); return; }
    answers[questions[i].id || questions[i].text] = val;
  }
  closeModal('modal-screening');
  window._pendingApply = null;
  await _doApply(p.campaignId, p.brandName, p.rewardUsd, p.rewardProduct, answers);
}

async function _doApply(campaignId, brandName, rewardUsd, rewardProduct, screeningAnswers) {
  const rewardStr = rewardUsd
    ? `$${rewardUsd}${rewardProduct ? ' + free product' : ''}` : (rewardProduct ? 'Free product' : '');
  const ok = await dbApply(campaignId, screeningAnswers);
  if (!ok) return;
  document.getElementById('applied-campaign-name').textContent = brandName;
  document.getElementById('applied-reward').textContent = rewardStr;
  document.getElementById('modal-apply-success').classList.add('open');
  const ctaBtn = document.getElementById('detail-cta-btn');
  if (ctaBtn) { ctaBtn.textContent = 'Applied ✓'; ctaBtn.disabled = true; ctaBtn.onclick = null; }
  const { data: { user } } = await window._supabase.auth.getUser();
  if (user) {
    await dbInsertNotification(user.id, 'application', 'Application submitted!',
      `You applied to ${brandName}. You'll hear back within 3–5 business days.`);
    await dbLoadNotifications();
  }
}

async function dbExpressInterest(applicationId, campaignId) {
  const app = window._db.applications.find(a => a.id === applicationId);
  if (!app) return;
  const c = window._db.campaigns.find(x => x.id === campaignId) || app.campaigns || {};
  const { error } = await window._supabase.from('applications')
    .update({ status: 'applied', updated_at: new Date().toISOString() }).eq('id', applicationId);
  if (error) { showToast(error.message, 'error'); return; }
  app.status = 'applied';
  renderTasksScreen();
  const ctaBtn = document.getElementById('detail-cta-btn');
  if (ctaBtn) {
    ctaBtn.textContent = 'Applied ✓'; ctaBtn.disabled = true;
    ctaBtn.style.background = ''; ctaBtn.onclick = null;
  }
  const rewardStr = c.reward_usd ? `$${c.reward_usd}${c.reward_product ? ' + free product' : ''}` : '';
  document.getElementById('applied-campaign-name').textContent = c.brand_name || 'Campaign';
  document.getElementById('applied-reward').textContent = rewardStr;
  document.getElementById('modal-apply-success').classList.add('open');
}

/* ── DB: Campaigns & Applications ─────────────────────────── */
const _OFFERS_SKELETON = `<div style="width:160px;min-width:160px;height:200px;border-radius:18px;background:#f5f5f5;flex-shrink:0;animation:skeletonPulse 1.4s ease-in-out infinite;display:inline-block;margin-right:12px;"><div style="height:110px;border-radius:18px 18px 0 0;background:#e8e8e8;"></div><div style="padding:10px;"><div style="height:11px;border-radius:6px;background:#e0e0e0;width:70%;margin-bottom:7px;"></div><div style="height:10px;border-radius:5px;background:#ebebeb;width:50%;"></div></div></div>`;
const _OFFERS_GRID_SKELETON = `<div style="border-radius:16px;background:#f5f5f5;height:90px;animation:skeletonPulse 1.4s ease-in-out infinite;margin-bottom:10px;display:flex;gap:12px;padding:14px;align-items:center;"><div style="width:60px;height:60px;border-radius:12px;background:#e0e0e0;flex-shrink:0;"></div><div style="flex:1;"><div style="height:12px;border-radius:6px;background:#e0e0e0;width:65%;margin-bottom:8px;"></div><div style="height:10px;border-radius:5px;background:#ebebeb;width:40%;"></div></div></div>`;

function renderOffersScreenSkeleton() {
  const suggestedEl = document.getElementById('offers-suggested-dynamic');
  if (suggestedEl) suggestedEl.innerHTML = `<div style="display:flex;overflow:hidden;gap:0;">${_OFFERS_SKELETON.repeat(3)}</div>`;
  const newEl = document.getElementById('offers-new-dynamic');
  if (newEl) newEl.innerHTML = _OFFERS_GRID_SKELETON.repeat(3);
}

async function dbLoadCampaigns() {
  renderOffersScreenSkeleton();
  const { data, error } = await window._supabase.from('campaigns').select('*');
  if (error) { console.warn('[DB] campaigns:', error.message); return; }
  window._db.campaigns = data || [];
  renderOffersScreen();
  renderTaskCampaignData();
  /* Update category counts from live DB data */
  if (typeof window._updateCategoryCounts === 'function') window._updateCategoryCounts();
}

async function dbLoadApplications() {
  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) return;
  const { data, error } = await window._supabase
    .from('applications')
    .select('*, campaigns(id, title, brand_name, emoji, gradient_css, thumbnail_url, reward_usd, reward_product, requires_shipping, organic_posting, org_reward_extra, screening_questions)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[DB] applications:', error.message); return; }
  window._db.applications = data || [];

  // FIX: Also fetch tasks to get the authoritative state (tasks.state overrides applications.status
  // when they diverge — this happens when brand updates task directly without touching applications)
  try {
    const { data: taskData } = await window._supabase
      .from('tasks')
      .select('id, application_id, state, submitted_video_path, revision_note, revision_count, filming_deadline, shipping_deadline, revision_deadline, tracking_number, carrier')
      .eq('user_id', user.id);
    if (taskData?.length) {
      // Merge task state into applications for authoritative status
      window._db.applications = window._db.applications.map(app => {
        const task = taskData.find(t => t.application_id === app.id);
        if (!task) return app;
        // Map task state back to application status for UI
        const stateToStatus = {
          selected: 'selected', selected_digital: 'selected_digital',
          confirm: 'confirm', filming: 'filming', filming_digital: 'filming_digital',
          submitted: 'submitted', revision: 'revision',
          approved: 'completed', auto_approved: 'completed',
        };
        const authoritative = stateToStatus[task.state];
        return {
          ...app,
          // Override status with task state if task has a more recent/accurate state
          status: authoritative && authoritative !== app.status ? authoritative : app.status,
          // Add task fields to app for easy access
          revision_note: task.revision_note || app.revision_note,
          revision_count: task.revision_count || app.revision_count || 0,
          filming_deadline: task.filming_deadline || app.filming_deadline,
          shipping_deadline: task.shipping_deadline || app.shipping_deadline,
          revision_deadline: task.revision_deadline || app.revision_deadline,
          tracking_number: task.tracking_number,
          carrier: task.carrier,
          _task_id: task.id,
        };
      });
    }
  } catch(e) {
    console.warn('[DB] tasks merge error:', e.message);
  }

  renderOffersScreen();
  renderTasksScreen();
}

async function dbApply(campaignId, screeningAnswers = null) {
  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) { showToast('Please log in to apply', 'error'); return false; }
  const existing = window._db.applications.find(a => a.campaign_id === campaignId && a.status !== 'revoked');
  if (existing) { showToast('You have already applied to this campaign', 'error'); return false; }
  const row = { campaign_id: campaignId, user_id: user.id, status: 'applied', created_at: new Date().toISOString() };
  if (screeningAnswers) row.screening_answers = screeningAnswers;
  const { data, error } = await window._supabase.from('applications').insert(row).select().single();
  if (error) { showToast(error.message, 'error'); return false; }
  window._db.applications.unshift(data);
  renderTasksScreen();
  return true;
}

async function dbUpdateTaskState(applicationId, newState, extra = {}) {
  const { error } = await window._supabase.from('applications').update({
    status: newState, updated_at: new Date().toISOString(), ...extra,
  }).eq('id', applicationId);
  if (error) { showToast(error.message, 'error'); return; }
  const app = window._db.applications.find(a => a.id === applicationId);
  if (app) Object.assign(app, { status: newState, ...extra });
  renderTasksScreen();
}

async function dbRevokeApplication(applicationId) {
  const { error } = await window._supabase.from('applications')
    .update({ status: 'revoked', updated_at: new Date().toISOString() }).eq('id', applicationId);
  if (error) { showToast(error.message, 'error'); return; }
  window._db.applications = window._db.applications.filter(a => a.id !== applicationId);
  renderTasksScreen();
  showToast('Application withdrawn', 'success');
}
