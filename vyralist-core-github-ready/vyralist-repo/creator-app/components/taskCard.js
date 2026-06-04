/* ============================================================
   TASKCARD.JS — HTML factory for a shoot-tab task card.
   Renders timer badge, shipping badge, title, and reward.

   Billo fixes applied:
   1. TaskCard() wrapper is fully self-contained here — no
      dependency on app.js or screens/*.js at call time.
   2. Multi-video progress pill: when campaign.videos_required > 1,
      renders "Video X of N" pill + progress bar using
      t.videos_submitted for current progress.
   3. Organic posting badge: shootTaskCard() accepts and renders
      the organic_posting context from the campaign, showing a
      badge when c.organic_posting is truthy.
   ============================================================ */

function shootTaskCard(t) {
  const c        = t.campaigns || {};
  const gradient = c.gradient_css || 'linear-gradient(135deg,#6C3EF0,#A78BFA)';
  const emoji    = c.emoji || '🎬';
  const reward   = c.reward_cash
    ? `$${parseFloat(c.reward_cash).toFixed(0)}${c.reward_product ? ' + free product' : ''}` : '';
  const shipping = t.requires_shipping ?? c.requires_shipping ?? false;

  /* ── Timer badge ───────────────────────────────────────── */
  let timerLabel = '';
  let timerColor = '#F59E0B';
  const now = Date.now();

  if (t.state === 'selected' && shipping) {
    const ms = t.shipping_deadline ? new Date(t.shipping_deadline) - now : 0;
    timerLabel = ms > 0 ? formatCountdown(ms) + ' left' : 'Overdue';
  } else if (['filming', 'selected_digital', 'revision'].includes(t.state)) {
    const deadline = t.state === 'revision' ? t.revision_deadline : t.filming_deadline;
    const ms = deadline ? new Date(deadline) - now : 0;
    timerLabel = ms > 0 ? formatCountdown(ms) + ' left' : 'Overdue';
    if (ms < 7200000) timerColor = '#EF4444';
  } else if (t.state === 'submitted') {
    timerLabel = 'Under review';
    timerColor = '#22C55E';
  }

  /* ── Multi-video progress pill ─────────────────────────── */
  const videosRequired  = c.videos_required || 1;
  const videosSubmitted = t.videos_submitted || 0;
  const multiVideoPill  = videosRequired > 1 ? (() => {
    const pct = Math.round((videosSubmitted / videosRequired) * 100);
    return `
      <div style="margin-top:10px;background:#F5F3FF;border-radius:12px;padding:10px 12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:12px;font-weight:700;color:var(--brand);">Video ${videosSubmitted + 1} of ${videosRequired}</span>
          <span style="font-size:11px;color:var(--text-3);">${videosSubmitted}/${videosRequired} submitted</span>
        </div>
        <div style="background:#DDD6FE;border-radius:4px;height:5px;overflow:hidden;">
          <div style="height:100%;background:var(--brand);width:${pct}%;border-radius:4px;transition:width .3s;"></div>
        </div>
      </div>`;
  })() : '';

  /* ── Organic posting badge ─────────────────────────────── */
  const hasOrganic  = !!(c.organic_posting);
  const orgReward   = c.org_reward_extra ? `+$${c.org_reward_extra}` : '+bonus';
  const organicBadge = hasOrganic
    ? `<div style="display:inline-flex;align-items:center;gap:5px;background:#ECFDF5;border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600;color:#059669;margin-top:6px;">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Organic post required · ${orgReward}
       </div>`
    : '';

  /* ── Workflow state badge ───────────────────────────────── */
  const STATE_UI = {
    selected:         { label: '📦 Awaiting shipment',    bg: '#FFFBEB', color: '#92400E' },
    confirm:          { label: '📬 Package on the way',   bg: '#EDE8FD', color: '#4C1D95' },
    selected_digital: { label: '⏱ 24h to film',          bg: '#EDE8FD', color: '#4C1D95' },
    filming:          { label: '🎬 Filming now',          bg: '#ECFDF5', color: '#065F46' },
    submitted:        { label: '⏳ Awaiting review',      bg: '#F3F4F6', color: '#374151' },
    revision:         { label: '🔄 Revision requested',   bg: '#FEF2F2', color: '#991B1B' },
    approved:         { label: '✅ Approved',             bg: '#ECFDF5', color: '#065F46' },
    auto_approved:    { label: '✅ Auto-approved',        bg: '#ECFDF5', color: '#065F46' },
  };
  const stateUI = STATE_UI[t.state] || null;
  const stateBadge = stateUI ? `
    <div style="margin:4px 0 6px;display:inline-flex;align-items:center;padding:4px 10px;background:${stateUI.bg};border-radius:20px;font-size:11px;font-weight:700;color:${stateUI.color};">
      ${stateUI.label}
    </div>` : '';

  return `
    <div onclick="openTaskDetail('${t.id}')" data-task-id="${t.id}" style="margin:0 16px 14px;border-radius:16px;overflow:hidden;border:1px solid var(--border);background:white;cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.07);">
      <div style="height:170px;background:${gradient};position:relative;display:flex;align-items:center;justify-content:center;font-size:72px;overflow:hidden;">
        ${c.thumbnail_url ? `<img src="${c.thumbnail_url}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;" onerror="this.style.display='none';">` : ''}
        <span style="position:relative;">${emoji}</span>
        ${timerLabel ? `<div style="position:absolute;bottom:12px;right:12px;background:rgba(255,255,255,.92);border-radius:20px;padding:5px 12px;display:flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:#1a1a1a;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${timerColor}" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>${timerLabel}</div>` : ''}
        ${shipping
          ? `<div style="position:absolute;bottom:12px;left:12px;background:rgba(255,255,255,.92);border-radius:20px;padding:5px 12px;display:flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--brand);"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>Shipping</div>`
          : `<div style="position:absolute;bottom:12px;left:12px;background:rgba(255,255,255,.92);border-radius:20px;padding:5px 12px;display:flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--brand);"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12H3a9 9 0 0 0 9 9v-2a7 7 0 0 1-7-7z"/></svg>No shipping</div>`}
      </div>
      <div style="padding:14px 16px;">
        <div style="display:inline-flex;align-items:center;gap:5px;background:var(--bg);border-radius:6px;padding:3px 8px;font-size:11px;font-weight:600;color:var(--text-2);margin-bottom:6px;">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="3"/><path d="m10 8 6 4-6 4V8z"/></svg>UGC video
        </div>
        <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.title||'Campaign'}</div>
        ${stateBadge}
        ${reward ? `<div style="display:flex;align-items:center;gap:5px;font-size:13px;color:var(--text-2);margin-top:4px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>${reward}</div>` : ''}
        ${multiVideoPill}
        ${organicBadge}
      </div>
    </div>`;
}

/* ── TaskCard — top-level entry point ────────────────────── */
/**
 * Unified wrapper. Fully self-contained — no dependency on app.js.
 *
 * @param {Object} task  – task row from Supabase, with task.campaigns populated.
 *                         Expected campaign fields: title, brand_name, reward_cash,
 *                         reward_product, requires_shipping, emoji, gradient_css,
 *                         thumbnail_url, videos_required, organic_posting, org_reward_extra.
 *                         Expected task fields: id, state, videos_submitted,
 *                         shipping_deadline, filming_deadline, revision_deadline,
 *                         requires_shipping.
 */
function TaskCard(task) {
  return shootTaskCard(task);
}
