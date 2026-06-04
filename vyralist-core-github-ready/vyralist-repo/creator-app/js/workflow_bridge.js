/* ============================================================
   WORKFLOW_BRIDGE.JS — v1.0
   Vyralist Creator App — Full Brand↔Creator Pipeline Bridge

   Handles the complete job lifecycle on the creator side:
   ① Brand publishes campaign → creator sees it in Offers
   ② Creator applies → application submitted
   ③ Brand accepts → creator gets "You got the job!" notification
      → task created → appears in Shoot tab
   ④ If shipping: brand marks shipped → creator gets notified
      → "Product on the way" screen → creator taps received
      → 24h filming timer begins
   ⑤ If digital: task starts immediately with 24h timer
   ⑥ Creator submits video → brand reviews (24h window)
   ⑦ Brand requests revision (1 allowed) → creator gets 24h
   ⑧ Brand approves → creator gets notified → earnings posted
   ============================================================ */

/* ── Boot: called after auth, extends existing _enterApp ─── */
(function () {
  'use strict';

  /* ─── Guard: only run once ─────────────────────────────── */
  if (window._workflowBridgeLoaded) return;
  window._workflowBridgeLoaded = true;

  /* ─── Wait for supabase + DB to be ready ──────────────── */
  function _whenReady(fn) {
    if (window._supabase && window._db) { fn(); return; }
    const iv = setInterval(() => {
      if (window._supabase && window._db) { clearInterval(iv); fn(); }
    }, 200);
  }

  /* ─── Countdown formatter (hh:mm:ss) ──────────────────── */
  function _countdown(ms) {
    if (ms <= 0) return '00:00:00';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (h >= 24) {
      const d = Math.floor(h / 24);
      return d + 'd ' + String(h % 24).padStart(2, '0') + 'h';
    }
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  /* ════════════════════════════════════════════════════════
     1.  REALTIME: Subscribe to task state changes
         Fires whenever the brand updates the task row.
  ════════════════════════════════════════════════════════ */
  async function _subscribeTaskBridge() {
    if (window._taskBridgeSub) return;
    try {
      const { data: { user } } = await window._supabase.auth.getUser();
      if (!user) return;

      window._taskBridgeSub = window._supabase
        .channel('task-bridge:' + user.id)
        .on('postgres_changes', {
          event: 'UPDATE', schema: 'public', table: 'tasks',
          filter: 'user_id=eq.' + user.id,
        }, async (payload) => {
          const newState = payload.new?.state;
          const oldState = payload.old?.state;
          if (newState === oldState) return;

          /* Reload tasks so UI is up-to-date */
          if (typeof dbLoadTasks === 'function') await dbLoadTasks();

          /* State-specific toasts / UI triggers */
          if (newState === 'selected' || newState === 'selected_digital') {
            _showJobAcceptedCelebration(payload.new);
          } else if (newState === 'confirm') {
            _showPackageShippedBanner(payload.new);
            showToast('📦 Your package has been shipped! Confirm when it arrives.', 'success');
          } else if (newState === 'revision') {
            _showRevisionBanner(payload.new);
            showToast('🔄 Brand requested a revision — 24 hours to re-shoot.', 'error');
          } else if (newState === 'approved') {
            _showApprovedCelebration(payload.new);
            showToast('✅ Video approved! Earnings added to your account.', 'success');
          }
        })
        .subscribe();
    } catch (e) {
      console.warn('[Bridge] _subscribeTaskBridge:', e.message);
    }
  }

  /* ════════════════════════════════════════════════════════
     2.  JOB ACCEPTED — full-screen celebration
  ════════════════════════════════════════════════════════ */
  function _showJobAcceptedCelebration(task) {
    const shipping = task.requires_shipping;
    const c = (window._db?.tasks?.find(t => t.id === task.id)?.campaigns) || {};

    let el = document.getElementById('bridge-job-accepted');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bridge-job-accepted';
      el.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:9900',
        'background:linear-gradient(160deg,#1a0533 0%,#2d1b69 50%,#4C1D95 100%)',
        'display:flex', 'flex-direction:column', 'align-items:center',
        'justify-content:center', 'padding:32px 24px', 'text-align:center',
        'animation:bridgeFadeIn .35s ease',
      ].join(';');
      document.body.appendChild(el);
    }

    el.innerHTML = `
      <style>
        @keyframes bridgeFadeIn{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
        @keyframes confettiFall{0%{transform:translateY(-10px) rotate(0deg);opacity:1}100%{transform:translateY(100vh) rotate(720deg);opacity:0}}
        .bridge-confetti{position:absolute;width:8px;height:8px;border-radius:2px;animation:confettiFall 2.8s ease-in forwards;}
      </style>
      ${_confettiHTML()}
      <div style="font-size:72px;margin-bottom:16px;filter:drop-shadow(0 0 24px rgba(164,245,99,.6));">🎉</div>
      <div style="font-size:28px;font-weight:800;color:#fff;margin-bottom:8px;letter-spacing:-0.5px;">You got the job!</div>
      <div style="font-size:16px;color:rgba(255,255,255,.75);margin-bottom:8px;max-width:280px;line-height:1.5;">
        ${c.brand_name || 'A brand'} selected you for <strong style="color:#A4F563;">${c.title || 'their campaign'}</strong>
      </div>
      <div style="margin:20px 0;background:rgba(255,255,255,.12);border-radius:16px;padding:16px 24px;width:100%;max-width:320px;">
        ${shipping ? `
          <div style="font-size:13px;color:rgba(255,255,255,.65);margin-bottom:4px;">What happens next</div>
          <div style="font-size:15px;color:#fff;font-weight:700;">📦 Brand will ship your product</div>
          <div style="font-size:13px;color:rgba(255,255,255,.6);margin-top:4px;">Up to 5 days · Confirm receipt to start filming</div>
        ` : `
          <div style="font-size:13px;color:rgba(255,255,255,.65);margin-bottom:4px;">What happens next</div>
          <div style="font-size:15px;color:#fff;font-weight:700;">⏱ 24 hours to film & submit</div>
          <div style="font-size:13px;color:rgba(255,255,255,.6);margin-top:4px;">Timer starts now — head to Shoot Videos</div>
        `}
      </div>
      <button onclick="document.getElementById('bridge-job-accepted').remove();if(typeof showTab==='function')showTab('tasks');"
        style="background:#A4F563;color:#0a0a0a;border:none;border-radius:50px;padding:14px 36px;font-size:16px;font-weight:800;cursor:pointer;margin-top:8px;">
        View my task →
      </button>
      <button onclick="document.getElementById('bridge-job-accepted').remove();"
        style="background:transparent;color:rgba(255,255,255,.5);border:none;font-size:14px;margin-top:12px;cursor:pointer;padding:8px;">
        Dismiss
      </button>
    `;

    /* Auto-dismiss after 10s */
    setTimeout(() => { el?.remove(); }, 10000);
  }

  function _confettiHTML() {
    const colors = ['#A4F563','#6C3EF0','#F59E0B','#EC4899','#10B981','#fff'];
    let html = '';
    for (let i = 0; i < 28; i++) {
      const color = colors[i % colors.length];
      const left  = Math.random() * 100;
      const delay = Math.random() * 1.5;
      const size  = 6 + Math.random() * 8;
      html += `<div class="bridge-confetti" style="left:${left}%;top:-10px;background:${color};width:${size}px;height:${size}px;animation-delay:${delay}s;"></div>`;
    }
    return html;
  }

  /* ════════════════════════════════════════════════════════
     3.  PACKAGE SHIPPED — inline banner on task detail
  ════════════════════════════════════════════════════════ */
  function _showPackageShippedBanner(task) {
    /* Inject/update banner in task detail screen if it's open */
    const stateShipping = document.getElementById('task-state-shipping');
    if (!stateShipping) return;

    /* Update shipping step dots to "shipped" state */
    if (typeof _setShippingStep === 'function') _setShippingStep('shipped');

    /* Update CTA */
    const ctaEl = document.getElementById('task-detail-cta');
    if (ctaEl) {
      ctaEl.innerHTML = `
        <button class="btn-primary" onclick="dbConfirmProductReceived()" style="width:100%;">
          I've received my product ✓
        </button>
        <p style="font-size:12px;color:var(--text-3);text-align:center;margin-top:8px;">
          Tap when your package arrives to start your 24-hour filming window
        </p>
      `;
    }

    /* Also show the package shipped notification in the shoot task card */
    if (typeof renderShootTab === 'function') renderShootTab();
  }

  /* ════════════════════════════════════════════════════════
     4.  REVISION BANNER — shown in task detail when brand
         requests a revision
  ════════════════════════════════════════════════════════ */
  function _showRevisionBanner(task) {
    /* If task detail is currently visible, refresh it */
    const detailScreen = document.getElementById('screen-task-detail');
    if (detailScreen?.classList.contains('active') && window._activeTask?.id === task.id) {
      window._activeTask = { ...window._activeTask, ...task };
      if (typeof openTaskDetail === 'function') openTaskDetail(task.id);
    }

    /* Inject revision note into the task state revision section */
    const revNote = document.getElementById('task-revision-note');
    if (revNote && task.revision_note) {
      revNote.textContent = `Brand's note: "${task.revision_note}"`;
      revNote.style.display = 'block';
    }
  }

  /* ════════════════════════════════════════════════════════
     5.  APPROVED — celebration + earnings update
  ════════════════════════════════════════════════════════ */
  function _showApprovedCelebration(task) {
    /* Reload earnings so the new payout row appears */
    if (typeof dbLoadPayouts === 'function') {
      setTimeout(() => dbLoadPayouts(), 1500);
    }

    /* Brief toast already fired by the subscription handler.
       If task detail is open, refresh it. */
    const detailScreen = document.getElementById('screen-task-detail');
    if (detailScreen?.classList.contains('active') && window._activeTask?.id === task.id) {
      window._activeTask = { ...window._activeTask, state: 'approved' };
      if (typeof openTaskDetail === 'function') openTaskDetail(task.id);
    }

    /* Show inline approved badge in shoot tab */
    if (typeof renderShootTab === 'function') renderShootTab();
    if (typeof renderPortfolioEarnings === 'function') renderPortfolioEarnings();
  }

  /* ════════════════════════════════════════════════════════
     6.  INJECT: revision note UI into task detail HTML
         (adds a DOM element that existing openTaskDetail
          will populate via _showRevisionBanner)
  ════════════════════════════════════════════════════════ */
  function _injectRevisionNoteEl() {
    const revSection = document.getElementById('task-state-revision');
    if (!revSection || document.getElementById('task-revision-note')) return;
    const el = document.createElement('div');
    el.id = 'task-revision-note';
    el.style.cssText = [
      'display:none', 'margin-top:10px', 'padding:12px 14px',
      'background:rgba(239,68,68,.08)', 'border-radius:10px',
      'font-size:13px', 'color:#7F1D1D', 'line-height:1.5',
      'border:1px solid rgba(239,68,68,.2)',
    ].join(';');
    revSection.appendChild(el);
  }

  /* ════════════════════════════════════════════════════════
     7.  CAMPAIGNS DB SYNC
         Patches dbLoadCampaigns to join with applications
         so "applied" badge shows on offer cards.
  ════════════════════════════════════════════════════════ */
  function _patchLoadCampaigns() {
    const orig = window.dbLoadCampaigns;
    if (!orig || window._campaignsPatchApplied) return;
    window._campaignsPatchApplied = true;

    window.dbLoadCampaigns = async function () {
      await orig();
      /* Tag campaigns the creator has already applied to */
      const apps = window._db?.applications || [];
      const appliedIds = new Set(apps.map(a => a.campaign_id));
      (window._db?.campaigns || []).forEach(c => {
        c._applied = appliedIds.has(c.id);
        c._appStatus = apps.find(a => a.campaign_id === c.id)?.status || null;
      });
      /* Re-render offers to show "Applied" badge */
      if (typeof renderOffersScreen === 'function') renderOffersScreen();
    };
  }

  /* ════════════════════════════════════════════════════════
     8.  SHOOT TAB ENHANCEMENT
         Patches shootTaskCard to show richer workflow state
  ════════════════════════════════════════════════════════ */
  function _patchShootTaskCard() {
    if (window._shootCardPatchApplied) return;
    window._shootCardPatchApplied = true;

    /* Extend the state labels used in shootTaskCard */
    const STATE_LABELS = {
      selected:          { label: '📦 Awaiting shipment',      color: '#F59E0B', bg: '#FFFBEB' },
      confirm:           { label: '📬 Package on the way',     color: '#6366F1', bg: '#EDE8FD' },
      selected_digital:  { label: '⏱ 24h to film',            color: '#6366F1', bg: '#EDE8FD' },
      filming:           { label: '🎬 Filming window open',    color: '#10B981', bg: '#ECFDF5' },
      submitted:         { label: '⏳ Awaiting brand review',  color: '#6B7280', bg: '#F3F4F6' },
      revision:          { label: '🔄 Revision requested',     color: '#EF4444', bg: '#FEF2F2' },
      approved:          { label: '✅ Approved',               color: '#10B981', bg: '#ECFDF5' },
      auto_approved:     { label: '✅ Auto-approved',          color: '#10B981', bg: '#ECFDF5' },
    };
    window._BRIDGE_STATE_LABELS = STATE_LABELS;
  }

  /* ════════════════════════════════════════════════════════
     9.  TASK CARD TIMER OVERLAY
         Patches renderShootTab to add countdown badges
         for states that don't already have them.
  ════════════════════════════════════════════════════════ */
  function _patchRenderShootTab() {
    if (window._shootTabPatchApplied) return;
    window._shootTabPatchApplied = true;

    /* After the standard render, inject countdown overlays */
    const origRender = window.renderShootTab;
    if (!origRender) return;

    window.renderShootTab = function () {
      origRender();
      _applyCountdownOverlays();
    };
  }

  function _applyCountdownOverlays() {
    const tasks = window._db?.tasks || [];
    tasks.forEach(task => {
      const el = document.querySelector(`[data-task-id="${task.id}"]`);
      if (!el) return;

      const state = task.state;
      const info  = window._BRIDGE_STATE_LABELS?.[state];
      if (!info) return;

      let badge = el.querySelector('.bridge-state-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'bridge-state-badge';
        badge.style.cssText = [
          'margin-top:8px', 'padding:6px 10px', 'border-radius:8px',
          'font-size:12px', 'font-weight:700', 'display:inline-flex',
          'align-items:center', 'gap:6px',
        ].join(';');
        el.appendChild(badge);
      }
      badge.style.background = info.bg;
      badge.style.color = info.color;

      /* Compute countdown if deadline available */
      let countdown = '';
      if (state === 'selected' && task.shipping_deadline) {
        const ms = new Date(task.shipping_deadline) - Date.now();
        countdown = ms > 0 ? ' · ' + _countdown(ms) : ' · Overdue';
      } else if ((state === 'filming' || state === 'selected_digital') && task.filming_deadline) {
        const ms = new Date(task.filming_deadline) - Date.now();
        countdown = ms > 0 ? ' · ' + _countdown(ms) : ' · Time up';
      } else if (state === 'revision' && task.revision_deadline) {
        const ms = new Date(task.revision_deadline) - Date.now();
        countdown = ms > 0 ? ' · ' + _countdown(ms) : ' · Time up';
      } else if (state === 'confirm') {
        const ms = task.shipping_deadline ? new Date(task.shipping_deadline) - Date.now() : 0;
        countdown = ms > 0 ? ' · Expected ' + _countdown(ms) : '';
      }

      badge.textContent = info.label + countdown;
    });
  }

  /* ════════════════════════════════════════════════════════
     10. INJECT: "submitted" campaign status into task when
         creator submits video — patches dbSubmitTaskVideo
         to also update the campaigns table status.
  ════════════════════════════════════════════════════════ */
  function _patchSubmitTask() {
    if (window._submitPatchApplied) return;
    window._submitPatchApplied = true;

    const orig = window.dbSubmitTaskVideo;
    if (!orig) return;

    window.dbSubmitTaskVideo = async function () {
      await orig();

      /* After submit, update campaign status to 'delivered' so brand
         dashboard shows the submitted video for review */
      if (!window._activeTask) return;
      try {
        await window._supabase
          .from('campaigns')
          .update({
            status: 'delivered',
            delivered_at: new Date().toISOString(),
            submitted_video_path: window._activeTask.submitted_video_path || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', window._activeTask.campaign_id);
      } catch (e) {
        console.warn('[Bridge] campaign delivered update:', e.message);
      }
    };
  }

  /* ════════════════════════════════════════════════════════
     11. INJECT: filming_deadline when product received
         Patches dbConfirmProductReceived to use 24h (not
         the old 5-day bug for physical tasks).
  ════════════════════════════════════════════════════════ */
  function _patchConfirmProductReceived() {
    if (window._confirmPatchApplied) return;
    window._confirmPatchApplied = true;

    const orig = window.dbConfirmProductReceived;
    if (!orig) return;

    window.dbConfirmProductReceived = async function () {
      if (!window._activeTask) return;
      const filmingDeadline = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const { error } = await window._supabase.from('tasks').update({
        state: 'filming',
        filming_deadline: filmingDeadline,
        updated_at: new Date().toISOString(),
      }).eq('id', window._activeTask.id);

      if (error) { showToast(error.message, 'error'); return; }
      showToast('Product confirmed! 24-hour filming window started. 🎬', 'success');
      await dbLoadTasks();
      openTaskDetail(window._activeTask.id);

      /* Notify brand that creator received product */
      try {
        const { data: campData } = await window._supabase
          .from('campaigns')
          .select('user_id, title')
          .eq('id', window._activeTask.campaign_id)
          .single();
        if (campData?.user_id) {
          await window._supabase.from('notifications').insert({
            user_id: campData.user_id,
            type: 'task',
            title: '📬 Creator received the product',
            body: `Your creator confirmed product receipt for "${campData.title}". Their 24-hour filming window has started.`,
            read: false,
            created_at: new Date().toISOString(),
          });
        }
      } catch (e) { /* silent */ }
    };
  }

  /* ════════════════════════════════════════════════════════
     12. OFFER CARD BADGE
         Patches offerCardV (if exists) to show "Applied"
         or "Hired" badges on campaign cards in offers feed.
  ════════════════════════════════════════════════════════ */
  function _patchOfferCard() {
    if (window._offerCardPatchApplied) return;
    window._offerCardPatchApplied = true;

    const orig = window.offerCardV;
    if (!orig) return;

    window.offerCardV = function (campaign) {
      const html = orig(campaign);
      if (!campaign._applied) return html;

      const statusColor = campaign._appStatus === 'accepted'
        ? '#10B981' : campaign._appStatus === 'rejected'
        ? '#EF4444' : '#6366F1';
      const statusLabel = campaign._appStatus === 'accepted'
        ? '✓ Hired!' : campaign._appStatus === 'rejected'
        ? 'Not selected' : '✓ Applied';

      /* Inject a badge into the rendered HTML */
      return html.replace(
        'data-campaign-id="' + campaign.id + '"',
        'data-campaign-id="' + campaign.id + '" data-applied="true"'
      ).replace(
        '</div></div><!-- end card -->',
        `<div style="position:absolute;top:8px;right:8px;background:${statusColor};color:white;
          font-size:10px;font-weight:800;padding:3px 8px;border-radius:50px;z-index:2;">${statusLabel}</div></div></div><!-- end card -->`
      );
    };
  }

  /* ════════════════════════════════════════════════════════
     13. EARNINGS: show pending payout notice when approved
  ════════════════════════════════════════════════════════ */
  function _injectEarningsNotice() {
    /* Called after approval — show a banner on the earnings screen */
    const earningsScreen = document.getElementById('screen-earning-details');
    if (!earningsScreen) return;

    const existingBanner = document.getElementById('bridge-earnings-banner');
    if (existingBanner) existingBanner.remove();

    const banner = document.createElement('div');
    banner.id = 'bridge-earnings-banner';
    banner.style.cssText = [
      'margin:16px 16px 0', 'padding:14px 16px',
      'background:linear-gradient(135deg,rgba(164,245,99,.15),rgba(164,245,99,.05))',
      'border:1.5px solid var(--lime,#A4F563)', 'border-radius:14px',
      'font-size:13px', 'color:var(--text)', 'line-height:1.55',
    ].join(';');
    banner.innerHTML = `
      <div style="font-weight:800;font-size:14px;margin-bottom:4px;">💰 New earnings added!</div>
      <div style="color:var(--text-2);">Your approved video earnings are pending payout. Vyralist pays out on the 13th and 26th of each month.</div>
      <button onclick="document.getElementById('bridge-earnings-banner').remove();"
        style="margin-top:8px;background:transparent;border:none;color:var(--brand,#6C3EF0);font-size:12px;font-weight:700;cursor:pointer;padding:0;">
        Dismiss
      </button>
    `;

    const scrollBody = earningsScreen.querySelector('.scroll-body') || earningsScreen;
    scrollBody.insertBefore(banner, scrollBody.firstChild);
  }

  /* ════════════════════════════════════════════════════════
     14. PERIODIC HEARTBEAT
         Every 30s: check for any task state changes that
         the realtime subscription may have missed.
  ════════════════════════════════════════════════════════ */
  let _heartbeatIv = null;
  function _startHeartbeat() {
    if (_heartbeatIv) return;
    _heartbeatIv = setInterval(async () => {
      try {
        if (!window._supabase || !window._db) return;
        const { data: { user } } = await window._supabase.auth.getUser();
        if (!user) return;
        const { data } = await window._supabase
          .from('tasks')
          .select('id, state, updated_at')
          .eq('user_id', user.id)
          .not('state', 'in', '("approved","auto_approved")');
        if (!data) return;
        const local = window._db.tasks || [];
        const changed = data.some(remote => {
          const loc = local.find(t => t.id === remote.id);
          return !loc || loc.state !== remote.state;
        });
        if (changed && typeof dbLoadTasks === 'function') await dbLoadTasks();
      } catch (e) { /* silent heartbeat */ }
    }, 30000);
  }

  /* ════════════════════════════════════════════════════════
     BOOT SEQUENCE
  ════════════════════════════════════════════════════════ */
  function _boot() {
    _injectRevisionNoteEl();
    _patchLoadCampaigns();
    _patchShootTaskCard();
    _patchRenderShootTab();
    _patchSubmitTask();
    _patchConfirmProductReceived();
    _patchOfferCard();
    _subscribeTaskBridge();
    _startHeartbeat();
    console.log('[WorkflowBridge] v1.0 loaded ✓');
  }

  /* Start as soon as the app data layer is ready */
  _whenReady(_boot);

  /* Also hook into the _enterAppReady event in case the
     bridge loads before supabase.js fires it */
  if (window._enterAppReady) {
    _whenReady(_boot);
  } else {
    window.addEventListener('_enterAppReady', () => _whenReady(_boot), { once: true });
  }

  /* Expose helpers for manual testing / console debugging */
  window._workflowBridge = {
    showJobAccepted: _showJobAcceptedCelebration,
    showPackageShipped: _showPackageShippedBanner,
    showRevision: _showRevisionBanner,
    showApproved: _showApprovedCelebration,
    showEarningsNotice: _injectEarningsNotice,
    resubscribe: _subscribeTaskBridge,
  };

})();
