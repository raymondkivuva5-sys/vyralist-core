/* ============================================================
   CAMPAIGNCARD.JS — Pure HTML-string factories for offer cards.
   All three card variants: horizontal (suggested), vertical
   (new offers grid), and full (campaign list).
   ============================================================ */

/* ── Shared helpers ─────────────────────────────────────── */

/** Dismiss × button */
function _dismissBtnHtml(campaignId) {
  return `<button class="card-dismiss" onclick="event.stopPropagation();dismissCampaign('${campaignId}')" aria-label="Not interested" style="position:absolute;top:8px;right:8px;width:24px;height:24px;border-radius:50%;background:rgba(0,0,0,.38);border:none;color:#fff;font-size:15px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:3;padding:0;">×</button>`;
}

/**
 * Derives the video duration in seconds from campaign fields.
 * Brands app saves `video_length_sec` (integer) or `duration` (string like "30 seconds").
 */
function _getDurationSec(c) {
  if (c.video_length_sec) return parseInt(c.video_length_sec);
  if (c.duration) {
    const m = String(c.duration).match(/\d+/);
    return m ? parseInt(m[0]) : 30;
  }
  return 30;
}

/**
 * Builds the pay string based on the creator's tier and campaign video length.
 * Rates: Basic (15s=$30, 30s=$40, 60s=$55) | Premium (15s=$70, 30s=$80, 60s=$95)
 */
const _CREATOR_RATES = { basic:{15:30,30:40,60:55}, premium:{15:70,30:80,60:95} };

function _getPayStr(c, short) {
  const len     = _getDurationSec(c);
  const closest = [15,30,60].reduce((a,b) => Math.abs(b-len)<Math.abs(a-len)?b:a);
  const tier    = ((window._creatorProfile && window._creatorProfile.tier) || 'basic').toLowerCase();
  const rates   = _CREATOR_RATES[tier] || _CREATOR_RATES.basic;
  const amt     = rates[closest];
  const extra   = (c.reward_product || c.requires_shipping) ? ' + free product' : '';
  return `From $${amt}${short ? '' : extra}`;
}

/**
 * Builds a comma-separated tags string from all creator requirement fields.
 * Falls back to creator_tag for legacy data.
 */
function _getTagsStr(c) {
  const parts = [];

  // Preferred: new brands-app fields
  if (c.creator_niche)    parts.push(...(Array.isArray(c.creator_niche)    ? c.creator_niche    : [c.creator_niche]));
  if (c.creator_language) parts.push(...(Array.isArray(c.creator_language) ? c.creator_language : [c.creator_language]));
  if (c.creator_gender && c.creator_gender !== 'any' && c.creator_gender !== 'Any') {
    parts.push(...(Array.isArray(c.creator_gender) ? c.creator_gender : [c.creator_gender]));
  }
  if (c.creator_age)      parts.push(...(Array.isArray(c.creator_age)      ? c.creator_age      : [c.creator_age]));

  // Legacy fallback
  if (parts.length === 0 && c.creator_tag) parts.push(c.creator_tag);

  return parts.filter(Boolean).join(', ');
}

/**
 * Camera icon SVG — adds photo camera icon alongside if photos required.
 */
function _mediaIconHtml(c, size) {
  const s = size || 13;
  const video = `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="3"/><path d="m10 8 6 4-6 4V8z"/></svg>`;
  const photo = `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:3px;"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M3 9h2"/></svg>`;
  return c.photos_required ? video + photo : video;
}

/* ── Horizontal card (suggested row) ────────────────────── */
function offerCardH(c, matchScore) {
  const dur    = _getDurationSec(c);
  const pay    = _getPayStr(c, false);
  const tags   = _getTagsStr(c);

  return `
    <div class="offer-card-h" data-cid="${c.id}" onclick="showDetailFromDB('${c.id}')" style="position:relative;">
      <div class="offer-card-h-img" style="background:${c.gradient_css||'linear-gradient(135deg,#6C3EF0,#A78BFA)'};position:relative;overflow:hidden;">
        ${c.thumbnail_url ? `<img src="${c.thumbnail_url}" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.style.display='none';">` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:36px;">${c.emoji||'🎬'}</div>`}
        ${_dismissBtnHtml(c.id)}
      </div>
      <div class="offer-card-h-body">
        <div class="offer-video-badge">${_mediaIconHtml(c, 13)}</div>
        <div class="offer-card-h-title">${dur}s video for ${c.brand_name}</div>
        ${pay ? `<div class="offer-card-h-meta"><span style="font-size:13px;">💰</span>${pay}</div>` : ''}
        ${tags ? `<div class="offer-card-h-meta"><span style="font-size:12px;">🏷️</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${tags}</span></div>` : ''}
      </div>
    </div>`;
}

/* ── Vertical card (new-offers scroll) ───────────────────── */
function offerCardV(c, matchScore) {
  const dur  = _getDurationSec(c);
  const pay  = _getPayStr(c, false);
  const tags = _getTagsStr(c);

  return `
    <div class="offer-card-h" data-cid="${c.id}" onclick="showDetailFromDB('${c.id}')" style="position:relative;">
      <div class="offer-card-h-img" style="background:${c.gradient_css||'linear-gradient(135deg,#6C3EF0,#A78BFA)'};overflow:hidden;position:relative;">
        ${c.thumbnail_url ? `<img src="${c.thumbnail_url}" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.style.display='none';">` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:30px;">${c.emoji||'🎬'}</div>`}
        ${_dismissBtnHtml(c.id)}
      </div>
      <div class="offer-card-h-body">
        <div class="offer-video-badge">${_mediaIconHtml(c, 13)}</div>
        <div class="offer-card-h-title">${dur}s video for ${c.brand_name}</div>
        ${pay ? `<div class="offer-card-h-meta"><span style="font-size:13px;">💰</span>${pay}</div>` : ''}
        ${tags ? `<div class="offer-card-h-meta"><span style="font-size:12px;">🏷️</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${tags}</span></div>` : ''}
      </div>
    </div>`;
}

/* ── Full card (campaign list) ───────────────────────────── */
function offerCardFull(c, matchScore) {
  const dur  = _getDurationSec(c);
  const pay  = _getPayStr(c, false);
  const tags = _getTagsStr(c);

  return `
    <div onclick="showDetailFromDB('${c.id}')" class="campaign-card" data-cid="${c.id}" style="position:relative;">
      <div class="campaign-thumb">
        <div class="campaign-thumb-bg" style="background:${c.gradient_css||'linear-gradient(135deg,#6C3EF0,#A78BFA)'};position:absolute;inset:0;overflow:hidden;">
          ${c.thumbnail_url ? `<img src="${c.thumbnail_url}" style="width:100%;height:100%;object-fit:cover;display:block;" onerror="this.style.display='none';">` : `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:48px;">${c.emoji||'🎬'}</div>`}
          <div class="video-badge">${_mediaIconHtml(c, 12)}UGC video</div>
          ${_dismissBtnHtml(c.id)}
        </div>
      </div>
      <div class="campaign-info">
        <h3>${c.brand_name} – ${c.title}</h3>
        <div class="campaign-meta">
          <div class="meta-row">
            ${_mediaIconHtml(c, 13)}
            <span style="margin-left:4px;">${dur}s video</span>
          </div>
          <div class="meta-row"><span style="font-size:13px;">💰</span>${pay || '—'}</div>
          <div class="meta-row"><span style="font-size:12px;">🏷️</span>${tags || 'N/A'}</div>
        </div>
      </div>
    </div>`;
}

/* ── CampaignCard — top-level entry point ────────────────── */
function CampaignCard(campaign, variant, matchScore) {
  switch (variant) {
    case 'vertical': return offerCardV(campaign, matchScore);
    case 'full':     return offerCardFull(campaign, matchScore);
    default:         return offerCardH(campaign, matchScore);
  }
}
