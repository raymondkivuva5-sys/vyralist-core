/* ============================================================
   PROFILE.JS — Profile stats, tier system,
   my-videos renderer, tag system, referral, services sheet.
   ============================================================ */

/* ── Rating / on-time helpers ────────────────────────────── */
function calcRating(videos) {
  const rated = [...videos].sort((a,b) => new Date(b.date) - new Date(a.date))
    .filter(v => v.rating !== null).slice(0, 8);
  if (!rated.length) return { avg: null, count: 0 };
  const avg = rated.reduce((s,v) => s + v.rating, 0) / rated.length;
  return { avg: Math.round(avg * 10) / 10, count: rated.length };
}

/*
 * calcOnTime — Billo-accurate on-time scoring.
 *
 * Rules (mirroring Billo help docs):
 *  1. Only approved videos (rating !== null) from the last 365 days are counted.
 *  2. A video is on-time when upload timestamp is within 5 days of delivered_at
 *     (product delivery mark).  Falls back to the legacy v.onTime boolean when
 *     delivered_at is absent so existing test data keeps working.
 *  3. Only the most-recent 3–20 videos in that window are used (min 3 to produce
 *     a score; capped at 20).
 */
function calcOnTime(videos) {
  const now        = new Date();
  const cutoff365  = new Date(now.getTime() - 365 * 86400000);
  const FIVE_DAYS  = 5 * 86400000;

  // Step 1 – approved videos in rolling 365-day window, newest first
  const window365 = [...videos]
    .filter(v => v.rating !== null && new Date(v.date) >= cutoff365)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // Need at least 3 to produce a meaningful score
  if (window365.length < 3) return null;

  // Step 2 – cap at 20
  const scored = window365.slice(0, 20);

  // Step 3 – determine on-time per video
  const onTimeCount = scored.filter(v => {
    if (v.delivered_at) {
      // Billo 5-day window: upload date vs product delivery mark
      return (new Date(v.date) - new Date(v.delivered_at)) <= FIVE_DAYS;
    }
    // Legacy fallback
    return !!v.onTime;
  }).length;

  return Math.round((onTimeCount / scored.length) * 100);
}

function renderStars(rating, size = 16) {
  if (rating === null) return '';
  const full = Math.floor(rating), half = rating - full >= 0.5 ? 1 : 0, empty = 5 - full - half;
  const star = (type) => {
    const color = type === 'empty' ? '#ddd' : 'var(--brand)';
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${type === 'empty' ? 'none' : color}" stroke="${color}" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  };
  let html = '';
  for (let i=0;i<full;i++)  html += star('full');
  if (half)                  html += star('half');
  for (let i=0;i<empty;i++) html += star('empty');
  return html;
}

/* ── Ban logic ───────────────────────────────────────────── */
function getMostRecentMissed(videos) {
  const missed = videos.filter(v => !v.onTime && v.rating !== null);
  if (!missed.length) return null;
  return missed.sort((a,b) => new Date(b.date) - new Date(a.date))[0];
}

function getBanState(videos) {
  const missed = getMostRecentMissed(videos);
  if (!missed) return { active: false };
  const banEnd = new Date(new Date(missed.date).getTime() + 30 * 86400000);
  const now = new Date();
  return now < banEnd ? { active: true, endsAt: banEnd, msLeft: banEnd - now } : { active: false };
}

function formatBanTimer(ms) {
  const s = Math.floor(ms/1000), d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s%60}s`;
}

let _banTimerInterval = null;
function startBanTimer(endsAt) {
  if (_banTimerInterval) clearInterval(_banTimerInterval);
  const el = document.getElementById('mv-ban-timer');
  const tick = () => {
    const ms = endsAt - new Date();
    if (ms <= 0) { clearInterval(_banTimerInterval); if (el) el.textContent = 'Ban lifted'; renderProfileStats(); return; }
    if (el) el.textContent = formatBanTimer(ms);
  };
  tick(); _banTimerInterval = setInterval(tick, 1000);
}

/* ── Tier system ─────────────────────────────────────────── */
/*
 * Billo-accurate thresholds (from Billo help docs):
 *   - 14 approved videos
 *   - >= 5 rated videos
 *   - >= 4.8 average rating
 *   - >= 90% on-time delivery (rolling 3-20 window, 365-day)
 */
const PREMIUM_REQUIRED_VIDEOS  = 14;
const PREMIUM_REQUIRED_RATING  = 4.8;
const PREMIUM_RATED_FROM       = 5;
const PREMIUM_REQUIRED_ONTIME  = 90;  // percent — NOT 100%

function checkPremiumEligibility(videos) {
  const approved      = videos.filter(v => v.rating !== null);
  const approvedCount = approved.length;
  const ratedSorted   = [...approved].sort((a,b) => new Date(b.date) - new Date(a.date));
  const ratedCount    = ratedSorted.length;
  const ratingAvg     = ratedCount > 0 ? ratedSorted.reduce((s,v) => s + v.rating, 0) / ratedCount : null;
  const onTimePct     = calcOnTime(videos);

  const videosOk = approvedCount >= PREMIUM_REQUIRED_VIDEOS;
  const ratingOk = ratedCount >= PREMIUM_RATED_FROM && ratingAvg !== null && ratingAvg >= PREMIUM_REQUIRED_RATING;
  const ontimeOk = onTimePct !== null && onTimePct >= PREMIUM_REQUIRED_ONTIME;

  return {
    videosOk, ratingOk, ontimeOk,
    approvedCount, ratedCount,
    ratingAvg: ratingAvg !== null ? Math.round(ratingAvg*10)/10 : null,
    onTimePct,
    eligible: videosOk && ratingOk && ontimeOk,
  };
}

function renderTierCard(videos) {
  const p = checkPremiumEligibility(videos);
  const badge       = document.getElementById('tier-badge');
  const pricing     = document.getElementById('tier-pricing');
  const reqs        = document.getElementById('tier-requirements');
  const headerBadge = document.getElementById('tier-header-badge');
  const premiumNote = document.getElementById('tier-premium-note');
  if (!badge || !reqs) return;
  if (p.eligible) {
    const premiumStyle = 'display:inline-flex;align-items:center;gap:5px;padding:5px 13px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:.3px;background:linear-gradient(135deg,#FFD700,#FFA500);color:#7a4800;';
    badge.setAttribute('style', premiumStyle); badge.textContent = 'STAR Premium';
    if (pricing) pricing.textContent = '15s $75  /  30s $85  /  60s $100';
    if (headerBadge) { headerBadge.style.background = 'linear-gradient(135deg,#FFD700,#FFA500)'; headerBadge.style.color = '#7a4800'; headerBadge.textContent = 'STAR Premium'; }
    if (premiumNote) premiumNote.style.display = 'none';
  } else {
    const regularStyle = 'display:inline-flex;align-items:center;gap:5px;padding:5px 13px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:.3px;background:var(--brand-soft);color:var(--brand);';
    badge.setAttribute('style', regularStyle); badge.textContent = 'Regular';
    if (pricing) pricing.textContent = '15s $35  /  30s $45  /  60s $60';
    if (headerBadge) { headerBadge.style.background = 'var(--brand-soft)'; headerBadge.style.color = 'var(--brand)'; headerBadge.textContent = 'Regular'; }
    if (premiumNote) premiumNote.style.display = 'block';
  }
  const req = (ok, label) => `
    <div style="display:flex;align-items:center;gap:8px;font-size:13px;">
      <span style="width:18px;height:18px;border-radius:50%;background:${ok?'#22C55E':'var(--border)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
      </span>
      <span style="color:${ok?'var(--text)':'var(--text-3)'};">${label}</span>
    </div>`;
  reqs.innerHTML =
    req(p.videosOk, `${p.approvedCount}/${PREMIUM_REQUIRED_VIDEOS} approved videos`) +
    req(p.ratingOk, `${p.ratingAvg !== null ? p.ratingAvg.toFixed(1) : '--'} avg  ${p.ratedCount}/${PREMIUM_RATED_FROM}+ rated (need ${PREMIUM_REQUIRED_RATING})`) +
    req(p.ontimeOk, `${p.onTimePct !== null ? p.onTimePct : '--'}% on-time delivery (need ${PREMIUM_REQUIRED_ONTIME}%)`);
}

/* ── Upgrade notification: banner + in-feed offer card ───── */
/*
 * Billo surfaces a premium upgrade card inside the Offers feed once
 * criteria are met, in addition to a dismissable top banner.
 */
let _upgradeNotifShown   = false;
let _upgradeCardInjected = false;

function checkUpgradeNotification(videos) {
  const p = checkPremiumEligibility(videos);
  if (!p.eligible) return;

  // 1. Top banner (once per session)
  if (!_upgradeNotifShown) {
    _upgradeNotifShown = true;
    if (!document.getElementById('upgrade-banner')) {
      const banner = document.createElement('div');
      banner.id = 'upgrade-banner';
      banner.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);width:100%;max-width:430px;z-index:500;background:linear-gradient(135deg,#5B2EE8,#7B52F0);color:white;padding:14px 20px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(91,46,232,.4);';
      banner.innerHTML = '<div style="font-size:22px;flex-shrink:0;">STAR</div><div style="flex:1;"><div style="font-size:13px;font-weight:700;margin-bottom:2px;">Premium upgrade available!</div><div style="font-size:11px;opacity:.85;">You meet all Premium requirements. Vyralist will send you an upgrade link.</div></div><button onclick="document.getElementById(\'upgrade-banner\').remove()" style="background:rgba(255,255,255,.2);border:none;color:white;font-size:11px;font-weight:700;padding:6px 10px;border-radius:8px;cursor:pointer;">Dismiss</button>';
      document.body.appendChild(banner);
      showToast('You\'re eligible for Premium!');
    }
  }

  // 2. In-feed card inside Offers tab
  if (!_upgradeCardInjected) {
    _upgradeCardInjected = true;
    _injectUpgradeOfferCard();
  }
}

function _injectUpgradeOfferCard() {
  const feed = document.getElementById('offers-list') || document.querySelector('.offers-feed');
  if (!feed) return;
  if (document.getElementById('upgrade-offer-card')) return;

  const card = document.createElement('div');
  card.id = 'upgrade-offer-card';
  card.style.cssText = 'margin:0 16px 14px;border-radius:16px;overflow:hidden;background:linear-gradient(135deg,#5B2EE8,#9B72F5);color:white;padding:18px 18px 16px;display:flex;flex-direction:column;gap:10px;box-shadow:0 4px 18px rgba(91,46,232,.25);';
  card.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;">' +
      '<div style="font-size:28px;">STAR</div>' +
      '<div>' +
        '<div style="font-size:15px;font-weight:800;letter-spacing:-.2px;">Become Premium</div>' +
        '<div style="font-size:12px;opacity:.85;margin-top:2px;">You\'ve unlocked higher rates and priority matching</div>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<div style="background:rgba(255,255,255,.18);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;">15s $75</div>' +
      '<div style="background:rgba(255,255,255,.18);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;">30s $85</div>' +
      '<div style="background:rgba(255,255,255,.18);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;">60s $100</div>' +
    '</div>' +
    '<button onclick="showSubScreen(\'tier\');document.getElementById(\'upgrade-offer-card\').remove();" style="background:white;color:#5B2EE8;border:none;border-radius:100px;padding:11px;font-size:14px;font-weight:800;cursor:pointer;font-family:\'Satoshi\',sans-serif;">Upgrade to Premium</button>';

  feed.insertBefore(card, feed.firstChild);
}

/* ── Tags badge helper ───────────────────────────────────── */
function _updateTagsBadge(count) {
  const badge = document.getElementById('about-tags-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count + (count === 1 ? ' tag' : ' tags');
    badge.classList.add('badge-tag--filled');
  } else {
    badge.textContent = 'Tags missing';
    badge.classList.remove('badge-tag--filled');
  }
}

/* ── Profile completeness signals ────────────────────────── */
function updateProfileSignals(profile) {
  if (!window._profileSignals) return;
  window._profileSignals.hasName     = !!(profile.first_name || profile.last_name);
  window._profileSignals.hasTags     = !!(profile.occupation || (Array.isArray(profile.tags) && profile.tags.length > 0) || (Array.isArray(profile.about_tags) && profile.about_tags.length > 0));
  window._profileSignals.hasShipping = !!(profile.shipping_address && profile.shipping_city);
  window._profileSignals.hasPaypal   = !!(profile.paypal_email);
  window._profileSignals.hasPitch    = !!(profile.pitch_video_path || profile.pitch_submitted_at);
  // Bug 3 fix: DB column is photo_url, not avatar_url — hasPhoto was always false
  if ('photo_url' in profile) {
    window._profileSignals.hasPhoto = !!(profile.photo_url);
  }
  const allTags = [
    ...(Array.isArray(profile.tags) ? profile.tags : []),
    ...(Array.isArray(profile.about_tags) ? profile.about_tags : []),
  ];
  _updateTagsBadge(allTags.length);
}

/* ── Profile header stats ────────────────────────────────── */
function renderProfileStats() {
  const { avg, count } = calcRating(window.videoData);
  const onTimePct = calcOnTime(window.videoData);
  const total = window.videoData.length;

  const ratingText = document.getElementById('stat-rating-text');
  if (ratingText) ratingText.textContent = avg !== null ? `${avg.toFixed(1)} (${count} review${count!==1?'s':''})` : '-- (0 reviews)';

  const totalEl = document.getElementById('stat-total-videos');
  if (totalEl) totalEl.textContent = `Total videos: ${total}`;

  const ontimeEl = document.getElementById('stat-ontime');
  if (ontimeEl) {
    if (onTimePct !== null) {
      ontimeEl.textContent = onTimePct + '%';
      ontimeEl.style.background = onTimePct >= 90 ? '#DCFCE7' : onTimePct >= 70 ? '#FEF9C3' : '#FEE2E2';
      ontimeEl.style.color = onTimePct >= 90 ? '#15803D' : onTimePct >= 70 ? '#854D0E' : '#B91C1C';
    } else { ontimeEl.textContent = '--%'; ontimeEl.style.background = '#F3F4F6'; ontimeEl.style.color = 'var(--text-3)'; }
  }

  const banState = getBanState(window.videoData);
  const availEl  = document.getElementById('profile-avail-label');
  if (availEl && banState.active) { availEl.style.color = '#EF4444'; availEl.textContent = 'Banned  ' + formatBanTimer(banState.msLeft) + ' left'; }

  renderTierCard(window.videoData);
  checkUpgradeNotification(window.videoData);
}

/* ── My Videos screen ────────────────────────────────────── */
function showMyVideos() {
  previousTab = 'portfolio';
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('screen-my-videos').classList.add('active');
  document.getElementById('nav-portfolio').classList.add('active');
  renderMyVideosScreen();
}

function renderMyVideosScreen() {
  const videos = window.videoData;
  const { avg, count } = calcRating(videos);
  const onTimePct = calcOnTime(videos);

  const starRow     = document.getElementById('mv-star-row');
  const ratingNum   = document.getElementById('mv-rating-num');
  const reviewCount = document.getElementById('mv-review-count');
  const ontimePctEl = document.getElementById('mv-ontime-pct');

  if (starRow) starRow.innerHTML = renderStars(avg !== null ? avg : 0, 18);
  if (ratingNum) ratingNum.textContent = avg !== null ? avg.toFixed(1) : '--';
  if (reviewCount) reviewCount.textContent = avg !== null ? `(${count} review${count!==1?'s':''})` : '(0 reviews)';
  if (ontimePctEl) { ontimePctEl.textContent = onTimePct !== null ? `${onTimePct}%` : '--%'; ontimePctEl.style.color = onTimePct !== null && onTimePct < 90 ? '#EF4444' : '#22C55E'; }

  const banState  = getBanState(videos);
  const banBanner = document.getElementById('mv-ban-banner');
  if (banBanner) { banBanner.style.display = banState.active ? 'block' : 'none'; if (banState.active) startBanTimer(banState.endsAt); }

  const list   = document.getElementById('mv-video-list');
  if (!list) return;
  const sorted = [...videos].sort((a,b) => new Date(b.date) - new Date(a.date));

  list.innerHTML = sorted.map((v, i) => {
    const isLast = i === sorted.length - 1;
    const dateStr     = new Date(v.date).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    const deadlineStr = new Date(v.deadline).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    const onTimeBadge = v.rating !== null ? (v.onTime ? `<span style="font-size:11px;font-weight:700;background:#DCFCE7;color:#166534;padding:2px 8px;border-radius:20px;">On-time</span>` : `<span style="font-size:11px;font-weight:700;background:#FEE2E2;color:#B91C1C;padding:2px 8px;border-radius:20px;">Missed deadline</span>`) : '';
    const starBadge   = v.rating !== null ? `<div style="display:inline-flex;align-items:center;gap:3px;border:1.5px solid var(--brand);border-radius:8px;padding:3px 8px;margin-top:5px;">${renderStars(v.rating, 14)}<span style="font-size:12px;font-weight:700;color:var(--brand);margin-left:3px;">${v.rating}.0</span></div>` : `<span style="font-size:11px;color:#aaa;margin-top:4px;display:block;">Awaiting brand rating</span>`;
    const hasVideo    = !!v.storagePath;
    const clickHandler = hasVideo ? `playStorageVideo('${v.storagePath}')` : `showToast('No video file recorded for this submission.', 'error')`;
    const thumbInner  = v.thumbnailUrl ? `<img src="${v.thumbnailUrl}" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.style.display='none';">` : `<span style="font-size:28px;">${v.emoji}</span>`;
    return `<div style="display:flex;align-items:flex-start;gap:14px;padding:14px 16px;${!isLast ? 'border-bottom:1px solid #efefef;' : ''}cursor:pointer;" onclick="${clickHandler}">
      <div style="width:90px;height:68px;border-radius:8px;overflow:hidden;flex-shrink:0;background:${v.bg};display:flex;align-items:center;justify-content:center;font-size:28px;position:relative;">${thumbInner}${hasVideo ? `<div style="position:absolute;inset:0;background:rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;"><div style="width:28px;height:28px;background:rgba(255,255,255,0.9);border-radius:50%;display:flex;align-items:center;justify-content:center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="var(--brand)"><path d="M8 5v14l11-7z"/></svg></div></div>` : ''}</div>
      <div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;"><span style="font-size:12px;color:#888;">${dateStr}</span>${onTimeBadge}</div><div style="font-size:14px;color:#000;line-height:1.35;font-weight:500;">${v.title}</div><div style="font-size:11px;color:#bbb;margin-top:2px;">Deadline: ${deadlineStr}</div>${starBadge}</div>
      <svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="#ccc" stroke-width="2" stroke-linecap="round"><path d="M1 1l8 8-8 8"/></svg>
    </div>`;
  }).join('');
}

/* ── Bar chart tooltip ───────────────────────────────────── */
function showBarTip(bar) {
  const tip = document.getElementById(bar.getAttribute('data-tip'));
  if (tip) { tip.textContent = bar.getAttribute('data-amount'); tip.style.display = 'block'; }
}
function hideBarTip(bar) {
  const tip = document.getElementById(bar.getAttribute('data-tip'));
  if (tip) tip.style.display = 'none';
}

/* ── Tag system ──────────────────────────────────────────── */
function toggleTag(el) {
  el.classList.toggle('active');
  const activeTags = [...document.querySelectorAll('#screen-about .tag-pill.active')].map(e => e.textContent.trim());
  // Optimistically persist to Supabase in background
  (async () => {
    try {
      const { data: { user } } = await window._supabase.auth.getUser();
      if (!user) return;
      await window._supabase.from('profiles').update({ tags: activeTags, updated_at: new Date().toISOString() }).eq('id', user.id);
      // Bug 9 fix: also check occupation so hasTags stays consistent with
      // updateProfileSignals and saveAboutMe — previously ignored occupation here
      if (window._profileSignals) {
        const occupation = document.getElementById('occ-textarea')?.value.trim() || '';
        window._profileSignals.hasTags = !!(occupation || activeTags.length > 0);
      }
    } catch (e) { console.warn('[Tags] Save failed:', e.message); }
  })();
}

function restoreProfileTags() {
  const profile = window._creatorProfile || {};
  const saved = [
    ...(Array.isArray(profile.tags) ? profile.tags : []),
    ...(Array.isArray(profile.about_tags) ? profile.about_tags : []),
  ];
  document.querySelectorAll('#screen-about .tag-pill').forEach(el => {
    el.classList.toggle('active', saved.includes(el.textContent.trim()));
  });
  _updateTagsBadge(saved.length);
}

/* ── Availability toggle ─────────────────────────────────── */
/*
 * Billo full flow:
 *  1. Going away — prompts creator to resolve pending tasks first.
 *  2. Writes is_available flag to Supabase to pause new assignments.
 *  3. Cancel restores availability and re-opens assignments.
 */
let awaySet = false;

async function requestTimeOff() {
  if (!awaySet) {
    // Check for pending tasks before allowing away status
    const pending = (window._db && window._db.tasks || []).filter(t =>
      t.status === 'pending' || t.status === 'accepted' || t.status === 'filming'
    );
    if (pending.length > 0) {
      const confirmed = confirm(
        `You have ${pending.length} pending task${pending.length !== 1 ? 's' : ''}.\n\n` +
        `Please complete or abandon them before going away.`
      );
      if (!confirmed) return;
      if (typeof showTab === 'function') showTab('tasks');
      showToast('Please complete or abandon your pending tasks first.', 'error');
      return;
    }
  }

  awaySet = !awaySet;

  // Persist to Supabase
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (user) {
      await window._supabase.from('profiles')
        .update({ is_available: !awaySet, updated_at: new Date().toISOString() })
        .eq('id', user.id);
    }
  } catch (e) { console.warn('[Availability] Supabase write failed:', e.message); }

  const lbl = document.getElementById('avail-status-label');
  if (lbl) { lbl.textContent = awaySet ? 'Away Apr 5 - Apr 19' : 'Available now'; lbl.style.color = awaySet ? '#D97706' : 'var(--success)'; }
  const btn = document.getElementById('avail-btn');
  if (btn) btn.textContent = awaySet ? 'Cancel time off' : 'Request time off';
  showToast(awaySet ? 'New assignments paused' : 'You\'re available again', awaySet ? 'default' : 'success');
}

/* ── Referral ────────────────────────────────────────────── */
function copyCode() {
  const code = document.getElementById('referral-code-display')?.textContent?.trim() || 'VYR-K8TZ';
  navigator.clipboard.writeText(code).catch(()=>{});
  const el = document.getElementById('copy-feedback');
  if (el) { el.textContent = 'Copied!'; setTimeout(() => { el.textContent = ''; }, 2000); }
}

function shareReferralCode() {
  const code = document.getElementById('referral-code-display')?.textContent?.trim() || 'VYR-K8TZ';
  if (navigator.share) {
    navigator.share({ title:'Join Vyralist', text:`Use my code ${code} to join Vyralist and earn cash from UGC content!`, url:'https://vyralist.co' }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(`https://vyralist.co?ref=${code}`).catch(()=>{});
    showToast('Referral link copied!', 'success');
  }
}

async function loadReferralCode() {
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;
    const { data: profile } = await window._supabase.from('profiles').select('referral_code').eq('id', user.id).single();
    if (profile?.referral_code) { const el = document.getElementById('referral-code-display'); if (el) el.textContent = profile.referral_code; }
  } catch (e) { console.warn('[Referral] loadReferralCode:', e.message); }
}

/* ── Annual recap ────────────────────────────────────────── */
/* Bug 7 fix: showAnnualRecap() removed — it was dead code (no HTML caller)
   and used incomplete data (videoData only, no payouts).
   The canonical implementation is openYearRecap() in app.js which reads
   both _db.payouts and _db.videos and renders into screen-year-recap. */

/* ── Services sheet ──────────────────────────────────────── */
let _activeSvcType = null;

function openSvcDetail(svcType) {
  const CONFIGS = {
    instagram: {
      title: 'Instagram Reel',
      ctaLabel: 'Connect Instagram',
      body:
        '<p style="font-size:14px;color:#444;line-height:1.6;margin-bottom:20px;">Allow brands to assign you Instagram Reel posts. Your content will be posted organically on your account.</p>' +
        '<div style="background:#FFF4F2;border-radius:12px;padding:14px 16px;display:flex;gap:10px;align-items:flex-start;">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#E85D04" stroke-width="2" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="#E85D04"/></svg>' +
          '<span style="font-size:13px;color:#9a3412;line-height:1.5;">You must have an Instagram Business or Creator account to connect.</span>' +
        '</div>',
    },
    tiktok: {
      title: 'TikTok Post',
      ctaLabel: 'Connect TikTok',
      body:
        '<p style="font-size:14px;color:#444;line-height:1.6;margin-bottom:20px;">Allow brands to assign you TikTok video posts as part of your UGC services.</p>' +
        '<div style="background:#FFF4F2;border-radius:12px;padding:14px 16px;display:flex;gap:10px;align-items:flex-start;margin-bottom:20px;">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#E85D04" stroke-width="2" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="#E85D04"/></svg>' +
          '<span style="font-size:13px;color:#9a3412;line-height:1.5;">A TikTok Business account is required.</span>' +
        '</div>' +
        '<div style="margin-top:4px;">' +
          '<div style="font-size:13px;font-weight:700;color:#111;margin-bottom:8px;">Spark Ad access code <span style="font-weight:400;color:#888;">(optional)</span></div>' +
          '<input id="spark-ad-code-input" type="text" placeholder="e.g. TT-XXXXXXXXXXXXXXXX" style="width:100%;box-sizing:border-box;border:1.5px solid #e0e0e0;border-radius:12px;padding:12px 14px;font-size:14px;font-family:\'Satoshi\',sans-serif;outline:none;" oninput="this.style.borderColor=\'var(--brand)\'">' +
          '<div style="font-size:12px;color:#888;margin-top:6px;">Generate in TikTok Ads Manager under Spark Ads, then paste here.</div>' +
        '</div>',
    },
    meta: {
      title: 'Meta Partnership Ads',
      ctaLabel: 'Connect Meta Business Account',
      body:
        '<p style="font-size:14px;color:#444;line-height:1.6;margin-bottom:16px;">Account-level ads allow brands to boost <strong>any content from your account</strong> for up to 30 days.</p>' +
        '<div style="background:#EEF4FF;border-radius:12px;padding:14px 16px;display:flex;gap:10px;align-items:flex-start;margin-bottom:20px;">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#4A80D9" stroke-width="2" style="flex-shrink:0;margin-top:1px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="#4A80D9"/></svg>' +
          '<span style="font-size:13px;color:#3B5998;line-height:1.5;">Requires connecting a Meta Business Account via OAuth (added v6.11, Mar 2026).</span>' +
        '</div>',
    },
  };

  const cfg = CONFIGS[svcType];
  if (!cfg) return;
  _activeSvcType = svcType;

  const listView   = document.getElementById('svc-list-view');
  const detailView = document.getElementById('svc-detail-view');
  const titleEl    = document.getElementById('svc-detail-title');
  const bodyEl     = document.getElementById('svc-detail-body');
  const btnEl      = document.getElementById('svc-detail-btn');

  if (listView)   listView.style.display   = 'none';
  if (detailView) detailView.style.display = 'flex';
  if (titleEl)    titleEl.textContent      = cfg.title;
  if (bodyEl)     bodyEl.innerHTML         = cfg.body;
  if (btnEl)      btnEl.textContent        = cfg.ctaLabel;
}

/*
 * handleSvcDetailCta — saves the selected service to Supabase.
 *
 * instagram / tiktok  -> writes to profiles.services[] (JSONB)
 *                        tiktok also captures spark_ad_code if entered.
 * meta                -> initiates Meta Business Account OAuth (v6.11).
 */
async function handleSvcDetailCta() {
  const svcType = _activeSvcType;
  if (!svcType) return;
  const btn = document.getElementById('svc-detail-btn');

  if (svcType === 'meta') { connectMetaBusinessAccount(); return; }

  if (btn) { btn.textContent = 'Connecting...'; btn.disabled = true; }
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data: profile } = await window._supabase
      .from('profiles').select('services').eq('id', user.id).single();
    const services = Array.isArray(profile && profile.services) ? profile.services : [];

    const svcRecord = {
      type:         svcType,
      connected_at: new Date().toISOString(),
      platform:     svcType,
    };
    if (svcType === 'tiktok') {
      const codeInput = document.getElementById('spark-ad-code-input');
      const code = codeInput && codeInput.value && codeInput.value.trim() || '';
      if (code) svcRecord.spark_ad_code = code;
    }

    const idx = services.findIndex(s => s.type === svcType);
    if (idx >= 0) services[idx] = svcRecord; else services.push(svcRecord);

    const { error } = await window._supabase.from('profiles')
      .update({ services, updated_at: new Date().toISOString() }).eq('id', user.id);
    if (error) throw error;

    showToast((svcType === 'instagram' ? 'Instagram Reel' : 'TikTok Post') + ' service connected!', 'success');
    hideAddService();
  } catch (e) {
    console.error('[Services] save error:', e.message);
    showToast('Could not connect service. Please try again.', 'error');
  } finally {
    if (btn) { btn.textContent = _activeSvcType === 'instagram' ? 'Connect Instagram' : _activeSvcType === 'tiktok' ? 'Connect TikTok' : 'Connect account'; btn.disabled = false; }
  }
}

/*
 * connectMetaBusinessAccount — Meta Business Account OAuth (v6.11).
 * Opens Meta login popup; on success calls _onMetaOAuthSuccess().
 */
function connectMetaBusinessAccount() {
  const META_APP_ID   = window.META_APP_ID || 'YOUR_META_APP_ID';
  const REDIRECT_URI  = encodeURIComponent(window.location.origin + '/meta-oauth-callback');
  const SCOPE         = encodeURIComponent('ads_management,business_management,pages_read_engagement');
  const STATE         = btoa(JSON.stringify({ ts: Date.now(), src: 'vyralist_svc' }));
  const oauthUrl =
    'https://www.facebook.com/v19.0/dialog/oauth' +
    '?client_id=' + META_APP_ID +
    '&redirect_uri=' + REDIRECT_URI +
    '&scope=' + SCOPE +
    '&state=' + STATE +
    '&response_type=code';

  const popup = window.open(oauthUrl, 'meta_oauth', 'width=600,height=700,left=200,top=100');
  const handler = async (event) => {
    if (!event.data || event.data.type !== 'META_OAUTH_SUCCESS') return;
    window.removeEventListener('message', handler);
    if (popup && !popup.closed) popup.close();
    await _onMetaOAuthSuccess(event.data.code);
  };
  window.addEventListener('message', handler);
  showToast('Opening Meta login...', 'default');
}

async function _onMetaOAuthSuccess(code) {
  if (!code) return;
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;
    const { data: tokenData, error: tokenErr } = await window._supabase.functions.invoke('meta-oauth-exchange', {
      body: { code, user_id: user.id },
    });
    if (tokenErr) throw tokenErr;
    const { error } = await window._supabase.from('profiles').update({
      meta_business_account_id: (tokenData && tokenData.business_account_id) || null,
      meta_ads_connected:       true,
      updated_at:               new Date().toISOString(),
    }).eq('id', user.id);
    if (error) throw error;
    showToast('Meta Business Account connected!', 'success');
    hideAddService();
  } catch (e) {
    console.error('[Meta OAuth] error:', e.message);
    showToast('Meta connection failed. Please try again.', 'error');
  }
}

function showAddService() {
  const sheet = document.getElementById('add-service-sheet');
  if (sheet) sheet.style.display = 'flex';
  const listView   = document.getElementById('svc-list-view');
  const detailView = document.getElementById('svc-detail-view');
  if (listView)   listView.style.display   = 'flex';
  if (detailView) detailView.style.display = 'none';
  _activeSvcType = null;
}
function hideAddService() {
  const sheet = document.getElementById('add-service-sheet');
  if (sheet) sheet.style.display = 'none';
  _activeSvcType = null;
}

/* ── Extra video examples — upload + save paths to Supabase ─ */
/*
 * handlePvpUpload previously only showed a fake progress bar and
 * never persisted paths.  Now it uploads to Supabase Storage and
 * saves the path to profiles.extra_video_paths[] so slots survive reload.
 * Slots 1-3 map to extra_video_paths indices 0-2.
 * Slot 0 (primary pitch) is handled separately by detail.js.
 */
async function handlePvpUpload(input, idx) {
  const file = input.files[0];
  if (!file) return;
  const thumb = document.getElementById('pvp-thumb-' + idx);
  if (!thumb) return;

  const overlay = document.createElement('div');
  overlay.id = 'pvp-overlay-' + idx;
  overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.55);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;z-index:10;';
  overlay.innerHTML =
    '<div style="font-size:13px;color:#fff;font-weight:600;">' + (file.name.length > 18 ? file.name.slice(0,15)+'...' : file.name) + '</div>' +
    '<div style="width:80%;height:5px;background:rgba(255,255,255,0.25);border-radius:3px;overflow:hidden;"><div id="pvp-bar-' + idx + '" style="width:0%;height:100%;background:#fff;border-radius:3px;transition:width 0.3s;"></div></div>' +
    '<div id="pvp-pct-' + idx + '" style="font-size:12px;color:rgba(255,255,255,0.8);">0%</div>';
  thumb.appendChild(overlay);

  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const ext      = file.name.split('.').pop() || 'mp4';
    const filePath = user.id + '/extra_videos/' + Date.now() + '_slot' + idx + '.' + ext;

    // Bug 4 fix: onUploadProgress is not supported by Supabase JS v2 Storage.
    // Use a fake ticker (same pattern as tasks.js) so the bar visually advances.
    let _fakeP = 0;
    const _fakeIv = setInterval(() => {
      if (_fakeP < 85) { _fakeP += Math.floor(Math.random() * 9) + 3; _fakeP = Math.min(_fakeP, 85); }
      const barEl = document.getElementById('pvp-bar-' + idx);
      const pctEl = document.getElementById('pvp-pct-' + idx);
      if (barEl) barEl.style.width = _fakeP + '%';
      if (pctEl) pctEl.textContent  = _fakeP + '%';
    }, 300);

    const { error: uploadErr } = await window._supabase.storage
      .from('videos')
      .upload(filePath, file, { upsert: true, contentType: file.type });
    clearInterval(_fakeIv);
    if (uploadErr) throw uploadErr;

      const { data: pubUrlData } = window._supabase.storage.from('videos').getPublicUrl(filePath);
    const publicUrl = pubUrlData?.publicUrl || filePath;

    const { data: profile } = await window._supabase
      .from('profiles').select('extra_video_paths').eq('id', user.id).single();
    const paths = Array.isArray(profile && profile.extra_video_paths) ? [...profile.extra_video_paths] : [null, null, null];
    const arrayIdx = idx - 1;  // slot 1-3 -> index 0-2
    if (arrayIdx >= 0) {
      while (paths.length <= arrayIdx) paths.push(null);
      paths[arrayIdx] = publicUrl;  // store full URL so brands app can use it directly
    }

    const { error: dbErr } = await window._supabase.from('profiles')
      .update({ extra_video_paths: paths, updated_at: new Date().toISOString() }).eq('id', user.id);
    if (dbErr) throw dbErr;

    setTimeout(function() {
      const ov = document.getElementById("pvp-overlay-" + idx);
      if (ov) ov.remove();
      const vi = document.getElementById("pvp-video-" + idx);
      if (vi) {
        vi.src = URL.createObjectURL(file);
        vi.load();
        vi._pvpBound = false;
        vi.addEventListener("loadedmetadata", () => {
          if (typeof _pvpBind === "function") _pvpBind(idx);
        });
      }
      showToast("Video uploaded!", "success");
    }, 400);

  } catch (e) {
    console.error('[PvpUpload] error:', e.message);
    const ov = document.getElementById('pvp-overlay-' + idx);
    if (ov) ov.remove();
    showToast('Upload failed. Please try again.', 'error');
  }
}

/* ── Video pitch custom thumbnail (frame picker) ─────────── */
/*
 * Billo v5.22 — creator scrubs a video to the desired frame and
 * taps "Use this frame". We capture via canvas and save the JPEG
 * to profiles.pitch_thumbnail_url.
 */
function openPitchFramePicker(videoSrc) {
  const existing = document.getElementById('frame-picker-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'frame-picker-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:950;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML =
    '<div style="width:100%;max-width:400px;display:flex;flex-direction:column;align-items:center;gap:14px;">' +
      '<div style="font-size:17px;font-weight:700;color:white;">Pick a thumbnail frame</div>' +
      '<video id="frame-picker-video" src="' + videoSrc + '" controls muted playsinline style="width:100%;border-radius:12px;background:#000;max-height:50vh;object-fit:contain;"></video>' +
      '<div style="font-size:13px;color:rgba(255,255,255,.65);">Scrub to the frame you want, then tap below.</div>' +
      '<div style="display:flex;gap:12px;width:100%;">' +
        '<button onclick="_captureAndSavePitchThumb()" style="flex:1;padding:14px;background:var(--brand);color:white;border:none;border-radius:100px;font-size:15px;font-weight:800;cursor:pointer;font-family:\'Satoshi\',sans-serif;">Use this frame</button>' +
        '<button onclick="document.getElementById(\'frame-picker-modal\').remove()" style="padding:14px 18px;background:rgba(255,255,255,.12);color:white;border:none;border-radius:100px;font-size:15px;font-weight:700;cursor:pointer;font-family:\'Satoshi\',sans-serif;">Cancel</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
}

async function _captureAndSavePitchThumb() {
  const video = document.getElementById('frame-picker-video');
  const modal = document.getElementById('frame-picker-modal');
  if (!video) return;

  const canvas  = document.createElement('canvas');
  canvas.width  = video.videoWidth  || 640;
  canvas.height = video.videoHeight || 360;
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob(async function(blob) {
    if (!blob) { showToast('Could not capture frame.', 'error'); return; }
    try {
      const { data: { user } } = await window._supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const filePath = 'pitch_thumbs/' + user.id + '/thumb_' + Date.now() + '.jpg';
      const { error: upErr } = await window._supabase.storage
        .from('videos').upload(filePath, blob, { contentType: 'image/jpeg', upsert: true });
      if (upErr) throw upErr;

      const { data: urlData } = window._supabase.storage.from('videos').getPublicUrl(filePath);
      const publicUrl = urlData && urlData.publicUrl;

      const { error: dbErr } = await window._supabase.from('profiles')
        .update({ pitch_thumbnail_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (dbErr) throw dbErr;

      const thumbEl = document.getElementById('pvp-thumb-0');
      if (thumbEl && publicUrl) {
        var img = thumbEl.querySelector('img') || document.createElement('img');
        img.src = publicUrl;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;position:absolute;inset:0;border-radius:inherit;';
        if (!img.parentNode) thumbEl.appendChild(img);
      }

      showToast('Thumbnail saved!', 'success');
      if (modal) modal.remove();
    } catch (e) {
      console.error('[FramePicker] save error:', e.message);
      showToast('Could not save thumbnail. Please try again.', 'error');
    }
  }, 'image/jpeg', 0.88);
}

/* ── Shipping info save ──────────────────────────────────── */
async function saveShippingInfo() {
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;
    const f = id => document.getElementById(id)?.value?.trim() || '';
    const country = f('ship-country') || 'CA';

    /* Validate required fields */
    const required = [
      { id: 'ship-address', label: 'Street address' },
      { id: 'ship-city',    label: 'City' },
      { id: 'ship-postal',  label: 'Postal code' },
      { id: 'ship-phone',   label: 'Phone number' },
    ];
    for (const field of required) {
      if (!f(field.id)) {
        showToast(`${field.label} is required`, 'error');
        document.getElementById(field.id)?.focus();
        return;
      }
    }
    const payload = {
      shipping_address: f('ship-address'), shipping_city: f('ship-city'),
      shipping_postal: f('ship-postal'), shipping_country: country,
      shipping_region: f('ship-region'), shipping_phone: f('ship-phone'),
      shipping_delivery_instructions: f('ship-delivery-instructions'),
      updated_at: new Date().toISOString(),
    };
    const btn = document.querySelector('#screen-shipping .btn-primary');
    if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }
    const { error } = await window._supabase.from('profiles').update(payload).eq('id', user.id);
    if (btn) { btn.textContent = 'Save'; btn.disabled = false; }
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Shipping info saved!', 'success');
    if (window._profileSignals) { window._profileSignals.hasShipping = !!(payload.shipping_address && payload.shipping_city); }
    goBack();
  } catch(e) { showToast('Could not save. Please try again.', 'error'); }
}

async function _prefillShippingForm() {
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;
    const { data: p } = await window._supabase.from('profiles')
      .select('shipping_address,shipping_city,shipping_postal,shipping_country,shipping_region,shipping_phone,shipping_delivery_instructions,country')
      .eq('id', user.id).single();
    if (!p) return;
    const country = p.shipping_country || p.country || 'CA';
    const shipCountryEl = document.getElementById('ship-country');
    if (shipCountryEl) { shipCountryEl.value = country; onShippingCountryChange(country); }
    const fields = { 'ship-address': p.shipping_address, 'ship-city': p.shipping_city, 'ship-postal': p.shipping_postal, 'ship-phone': p.shipping_phone, 'ship-delivery-instructions': p.shipping_delivery_instructions };
    Object.entries(fields).forEach(([id, val]) => { const el = document.getElementById(id); if (el && val) el.value = val; });
    if (p.shipping_region) { const regionEl = document.getElementById('ship-region'); if (regionEl) regionEl.value = p.shipping_region; }
    const deliveryEl = document.getElementById('ship-delivery-instructions');
    const countEl    = document.getElementById('delivery-count');
    if (deliveryEl && countEl) countEl.textContent = (deliveryEl.value.length) + '/500';
  } catch(e) { console.warn('[Shipping] prefill error:', e.message); }
}

/* ── Video Pitch Screen — load approved pitch + extra slots ── */
/*
 * Called every time the creator opens "My video pitch".
 * - Card 0: shows the real approved video (pitch_video_url) when pitch_status === 'approved'.
 *           While pending/denied the mock placeholder remains with a status badge.
 * - Cards 1-3: shows any extra videos the creator has uploaded (extra_video_paths).
 */
async function initVideoPitchScreen() {
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await window._supabase
      .from('profiles')
      .select('pitch_video_url, pitch_status, extra_video_paths')
      .eq('id', user.id)
      .single();

    if (!profile) return;

    /* ── Card 0: creator's own pitch ──
       The card is pre-built in HTML with:
         #pvp-video-0    — <video> element, hidden until approved
         #pvp-placeholder-0 — emoji placeholder div, visible by default
         #pvp-badge-0    — badge container, hidden by default
       We just set src + show/hide the right elements. */
    const v0          = document.getElementById('pvp-video-0');
    const placeholder = document.getElementById('pvp-placeholder-0');
    const badge       = document.getElementById('pvp-badge-0');

    if (v0 && placeholder && badge) {
      if (profile.pitch_status === 'approved' && profile.pitch_video_url) {
        v0.src = profile.pitch_video_url;
        v0.style.display = 'block';
        placeholder.style.display = 'none';
        badge.style.display = 'block';
        badge.innerHTML = '<span style="background:rgba(18,161,80,0.92);color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;">✓ Approved</span>';
        v0.addEventListener('loadedmetadata', () => {
          if (typeof _pvpBind === 'function') _pvpBind(0);
        });
      } else if (profile.pitch_status === 'pending') {
        badge.style.display = 'block';
        badge.innerHTML = '<span style="background:rgba(217,119,6,0.9);color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;">⏳ Pending review</span>';
      } else if (profile.pitch_status === 'denied') {
        badge.style.display = 'block';
        badge.innerHTML = '<span style="background:rgba(220,38,38,0.88);color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:20px;">✕ Not approved</span>';
      }
      /* no pitch yet: placeholder stays, no badge */
    }

    /* ── Cards 1-3: override with creator's own uploaded examples if any ──
       If a creator has uploaded extra videos to Supabase, those replace the
       default example videos. Otherwise the bundled /videos/example*.mp4 stay. */
    const paths = Array.isArray(profile.extra_video_paths) ? profile.extra_video_paths : [];
    for (let i = 1; i <= 3; i++) {
      const rawPath = paths[i - 1];
      if (!rawPath) continue; /* keep the bundled example */

      const { data: pubData } = window._supabase.storage
        .from('videos').getPublicUrl(rawPath);
      if (!pubData?.publicUrl) continue;

      const vi = document.getElementById('pvp-video-' + i);
      if (!vi) continue;
      vi._pvpBound = false;
      vi.src = pubData.publicUrl;
      vi.load();
      vi.addEventListener('loadedmetadata', () => {
        if (typeof _pvpBind === 'function') _pvpBind(i);
      });
    }

  } catch (e) {
    console.warn('[VideoPitchScreen] init error:', e.message);
  }
}

/* ── Init on DOM ready ───────────────────────────────────── */
document.addEventListener('DOMContentLoaded', renderProfileStats);
