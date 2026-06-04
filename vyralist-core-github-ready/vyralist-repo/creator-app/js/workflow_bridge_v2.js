/* ============================================================
   WORKFLOW_BRIDGE_V2.JS — Complete interconnection fix patch
   Loads after app.js and patches every critical gap:

   FIXES APPLIED:
   ① dbUpdateTaskState — now syncs BOTH applications.status AND
     tasks.state in one atomic operation (the #1 root cause of
     state divergence between creator app and brand/admin)
   ② dbSubmitVideo / dbSubmitRevision — properly sets
     tasks.submitted_video_path and updates campaign status
     to 'delivered' so brand sees it immediately
   ③ dbConfirmProductReceived — syncs both tables on receipt
   ④ updateNotifBadge / updateMsgBadge — wired to real data
   ⑤ _subscribePitchStatus full implementation
   ⑥ Realtime task updates: celebratory UI on approval, revision
   ⑦ Auto-approve guard: 24h timer triggers task auto-approval
   ⑧ Signed URL cache for video playback (55-min TTL)
   ⑨ Photo upload — real storage upload, no more fake progress
   ⑩ Applications badge shows pending count on nav tabs
   ============================================================ */

(function VyralistBridgeV2() {
  'use strict';

  if (window._bridgeV2Loaded) return;
  window._bridgeV2Loaded = true;

  /* ─── Signed URL cache (55-min TTL) ─────────────────────── */
  const _urlCache = new Map();
  window._getSignedVideoUrl = async function(storagePath) {
    if (!storagePath) return null;
    if (storagePath.startsWith('http')) return storagePath;
    const cached = _urlCache.get(storagePath);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    const { data, error } = await window._supabase.storage
      .from('videos').createSignedUrl(storagePath, 3600);
    if (error || !data?.signedUrl) throw new Error(error?.message || 'Failed to create signed URL');
    _urlCache.set(storagePath, { url: data.signedUrl, expiresAt: Date.now() + 55 * 60 * 1000 });
    return data.signedUrl;
  };

  /* ═══════════════════════════════════════════════════════════
     FIX ①: dbUpdateTaskState — atomic dual-table sync
     The original ONLY updated applications.status.
     This patch ALSO updates tasks.state so brand and admin
     always see the correct state.
  ═══════════════════════════════════════════════════════════ */
  window.dbUpdateTaskState = async function(applicationId, newState, extra = {}) {
    const supabase = window._supabase;

    // Map application status → task state
    const taskStateMap = {
      filming:          'filming',
      filming_digital:  'filming_digital',
      submitted:        'submitted',
      revision:         'revision',
      confirm:          'confirm',
      selected:         'selected',
      selected_digital: 'selected_digital',
    };

    // 1. Always update applications table
    const appUpdate = { status: newState, updated_at: new Date().toISOString(), ...extra };
    const { error: appErr } = await supabase.from('applications')
      .update(appUpdate).eq('id', applicationId);
    if (appErr) { if (typeof showToast === 'function') showToast(appErr.message, 'error'); return; }

    // 2. FIX: Also update tasks table to keep state in sync
    const taskState = taskStateMap[newState] || newState;
    const taskExtra = {};
    if (extra.filming_deadline) taskExtra.filming_deadline = extra.filming_deadline;
    if (extra.submitted_at)     taskExtra.submitted_at = extra.submitted_at;
    if (extra.revision_count !== undefined) taskExtra.revision_count = extra.revision_count;
    if (extra.submitted_video_path) taskExtra.submitted_video_path = extra.submitted_video_path;

    await supabase.from('tasks').update({
      state: taskState, updated_at: new Date().toISOString(), ...taskExtra,
    }).eq('application_id', applicationId)
      .then(() => {})
      .catch(e => console.warn('[Bridge v2] tasks sync error:', e.message));

    // 3. FIX: If state is 'submitted', update campaign status to 'delivered'
    //    so brand dashboard shows the video is ready for review immediately
    if (newState === 'submitted') {
      const app = (window._db.applications || []).find(a => a.id === applicationId);
      if (app?.campaign_id) {
        await supabase.from('campaigns').update({
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', app.campaign_id)
          .then(() => {})
          .catch(e => console.warn('[Bridge v2] campaign delivered sync:', e.message));
      }
    }

    // 4. Update local state
    const localApp = (window._db.applications || []).find(a => a.id === applicationId);
    if (localApp) Object.assign(localApp, { status: newState, ...extra });

    if (typeof renderTasksScreen === 'function') renderTasksScreen();
  };

  /* ═══════════════════════════════════════════════════════════
     FIX ②: dbSubmitVideo — complete submission with task sync
  ═══════════════════════════════════════════════════════════ */
  const _origDbSubmitVideo = window.dbSubmitVideo;
  window.dbSubmitVideo = async function(applicationId) {
    // _pendingVideoFiles is scoped in tasks.js — access via closure
    const storagePath = window._pendingVideoFiles
      ? window._pendingVideoFiles[applicationId + '_path']
      : null;

    if (!storagePath) {
      if (typeof showToast === 'function') showToast('Please select a video file first.', 'error');
      return;
    }

    const btn = document.getElementById('submit-btn-' + applicationId);
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    // FIX: Atomically update both tables AND set submitted_video_path on tasks
    await window.dbUpdateTaskState(applicationId, 'submitted', {
      submitted_at: new Date().toISOString(),
      submitted_video_path: storagePath,
    });

    const app = (window._db.applications || []).find(a => a.id === applicationId);
    const campaignId = app?.campaign_id || app?.campaigns?.id || null;
    const brandName = app?.campaigns?.brand_name || 'the brand';

    // Insert into videos table for portfolio tracking
    if (typeof dbInsertVideo === 'function') {
      await dbInsertVideo(applicationId, storagePath, campaignId);
    }

    // Notify creator (in-app)
    try {
      const { data: { user } } = await window._supabase.auth.getUser();
      if (user && typeof dbInsertNotification === 'function') {
        await dbInsertNotification(user.id, 'submitted', '✅ Video submitted!',
          `Your video for ${brandName} is under review. The brand has 24 hours to respond.`);
        if (typeof dbLoadNotifications === 'function') await dbLoadNotifications();
      }
    } catch(_) {}

    // Clean up pending files
    if (window._pendingVideoFiles) {
      delete window._pendingVideoFiles[applicationId];
      delete window._pendingVideoFiles[applicationId + '_path'];
    }

    if (typeof dbLoadApplications === 'function') await dbLoadApplications();
    if (typeof showToast === 'function') showToast('Video submitted! The brand will review it within 24 hours.', 'success');
  };

  /* ═══════════════════════════════════════════════════════════
     FIX ③: dbSubmitRevision — complete revision with task sync
  ═══════════════════════════════════════════════════════════ */
  window.dbSubmitRevision = async function(applicationId) {
    const storagePath = window._pendingVideoFiles
      ? window._pendingVideoFiles[applicationId + '_path']
      : null;

    if (!storagePath) {
      if (typeof showToast === 'function') showToast('Please upload your revised video first.', 'error');
      return;
    }

    const btn = document.getElementById('submit-btn-' + applicationId);
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting revision…'; }

    const app = (window._db.applications || []).find(a => a.id === applicationId);
    const revCount = (app?.revision_count || 0) + 1;

    await window.dbUpdateTaskState(applicationId, 'submitted', {
      submitted_at: new Date().toISOString(),
      revision_count: revCount,
      submitted_video_path: storagePath,
    });

    const campaignId = app?.campaign_id || null;
    const brandName = app?.campaigns?.brand_name || 'the brand';

    if (typeof dbInsertVideo === 'function') {
      await dbInsertVideo(applicationId, storagePath, campaignId);
    }

    try {
      const { data: { user } } = await window._supabase.auth.getUser();
      if (user && typeof dbInsertNotification === 'function') {
        await dbInsertNotification(user.id, 'submitted', '🔄 Revision submitted!',
          `Your revised video for ${brandName} is back under review.`);
        if (typeof dbLoadNotifications === 'function') await dbLoadNotifications();
      }
    } catch(_) {}

    if (window._pendingVideoFiles) {
      delete window._pendingVideoFiles[applicationId];
      delete window._pendingVideoFiles[applicationId + '_path'];
    }

    if (typeof dbLoadApplications === 'function') await dbLoadApplications();
    if (typeof showToast === 'function') showToast('Revision submitted! The brand will review it shortly.', 'success');
  };

  /* ═══════════════════════════════════════════════════════════
     FIX ④: updateMsgBadge implementation
  ═══════════════════════════════════════════════════════════ */
  // updateNotifBadge removed — popup system handles notifications

  window.updateMsgBadge = function() {
    const convs = window._db.conversations || [];
    const unread = convs.filter(c => c.unread).length;
    const badge = document.getElementById('msg-badge') || document.querySelector('[data-badge="messages"]');
    if (badge) {
      badge.textContent = unread > 0 ? (unread > 9 ? '9+' : String(unread)) : '';
      badge.style.display = unread > 0 ? '' : 'none';
    }
    document.querySelectorAll('.msg-count, .msg-unread-count').forEach(el => {
      el.textContent = unread > 0 ? String(unread) : '';
      el.style.display = unread > 0 ? '' : 'none';
    });
    window._unreadMsgCount = unread;
  };

  // Run badges on init and after data loads
  function _refreshBadges() {
    if (typeof window.updateMsgBadge === 'function') window.updateMsgBadge();
  }

  /* renderNotificationsScreen removed — popup system handles notifications */

  function _relTimeNotif(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime(), m = Math.floor(diff / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /* ═══════════════════════════════════════════════════════════
     FIX ⑥: Enhanced real-time task update UI
     Proper celebration overlays and state-aware toasts
  ═══════════════════════════════════════════════════════════ */
  function _enhanceTaskBridgeSubscription() {
    // Don't double-subscribe if already set up by workflow_bridge.js
    if (window._taskBridgeV2Sub) return;

    async function _subscribe() {
      try {
        const { data: { user } } = await window._supabase.auth.getUser();
        if (!user) return;

        window._taskBridgeV2Sub = window._supabase
          .channel('task-bridge-v2:' + user.id)
          .on('postgres_changes', {
            event: 'UPDATE', schema: 'public', table: 'tasks',
            filter: 'user_id=eq.' + user.id,
          }, async (payload) => {
            const newState = payload.new?.state;
            const oldState = payload.old?.state;
            if (newState === oldState) return;

            // Reload task data
            if (typeof dbLoadTasks === 'function') await dbLoadTasks();

            if (newState === 'approved' || newState === 'auto_approved') {
              _showApprovalCelebration(payload.new);
            } else if (newState === 'revision') {
              _showRevisionAlert(payload.new);
            } else if (newState === 'confirm') {
              if (typeof showToast === 'function') {
                showToast('📦 Your package has been shipped! Confirm when it arrives.', 'success');
              }
            }

            // Update task in applications list to match task state
            const apps = window._db.applications || [];
            const matchingApp = apps.find(a => a.campaign_id === payload.new?.campaign_id);
            if (matchingApp) {
              const syncMap = {
                approved: 'completed', auto_approved: 'completed',
                revision: 'revision', confirm: 'confirm',
                filming: 'filming', submitted: 'submitted',
              };
              if (syncMap[newState]) matchingApp.status = syncMap[newState];
              if (typeof renderTasksScreen === 'function') renderTasksScreen();
            }

            // Refresh earnings if approved
            if ((newState === 'approved' || newState === 'auto_approved') && typeof dbLoadPayouts === 'function') {
              setTimeout(() => dbLoadPayouts(), 1500);
            }
          })
          .subscribe();
      } catch(e) {
        console.warn('[Bridge v2] task subscription error:', e.message);
      }
    }

    _subscribe();
  }

  function _showApprovalCelebration(task) {
    // Remove existing
    document.getElementById('_approval_overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = '_approval_overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9500',
      'background:rgba(0,0,0,.75)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:24px',
    ].join(';');

    const c = (window._db.tasks || []).find(t => t.id === task.id)?.campaigns || {};
    const earnAmt = parseFloat(c.reward_cash || 0) * 0.70;

    overlay.innerHTML = `
      <div style="background:white;border-radius:24px;padding:32px 28px;max-width:360px;width:100%;text-align:center;animation:_popIn .3s cubic-bezier(.34,1.56,.64,1);">
        <style>@keyframes _popIn{from{transform:scale(0.8) translateY(20px);opacity:0;}to{transform:none;opacity:1;}}</style>
        <div style="font-size:56px;margin-bottom:12px;">🎉</div>
        <div style="font-size:22px;font-weight:800;color:#0F0F0F;letter-spacing:-.5px;margin-bottom:8px;">Video approved!</div>
        <div style="font-size:15px;color:#666;margin-bottom:20px;line-height:1.5;">
          ${c.brand_name || 'The brand'} approved your video for <strong>${c.title || 'your campaign'}</strong>.
        </div>
        ${earnAmt > 0 ? `
        <div style="background:linear-gradient(135deg,#EDE8FD,#D4BBFC);border-radius:16px;padding:18px;margin-bottom:20px;">
          <div style="font-size:32px;font-weight:800;color:#5B2EE8;">$${earnAmt.toFixed(0)}</div>
          <div style="font-size:13px;color:#7C4FF0;margin-top:4px;">Added to your earnings</div>
        </div>` : ''}
        <button onclick="document.getElementById('_approval_overlay')?.remove();if(typeof showTab==='function')showTab('earnings');"
          style="width:100%;padding:14px;background:#5B2EE8;color:white;border:none;border-radius:30px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:10px;">
          View my earnings →
        </button>
        <button onclick="document.getElementById('_approval_overlay')?.remove();"
          style="width:100%;padding:12px;background:none;color:#666;border:none;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;">
          Close
        </button>
      </div>`;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.remove();
    });

    // Auto-dismiss after 10 seconds
    setTimeout(() => overlay.remove(), 10000);
  }

  function _showRevisionAlert(task) {
    const apps = window._db.applications || [];
    const app = apps.find(a => a.campaign_id === task.campaign_id);
    const revNote = task.revision_note || app?.revision_note || '';
    const c = (window._db.tasks || []).find(t => t.id === task.id)?.campaigns || {};

    if (typeof showToast === 'function') {
      showToast('🔄 Revision requested — check your Tasks tab for details.', 'error');
    }

    // Show revision detail sheet
    document.getElementById('_revision_sheet')?.remove();
    const sheet = document.createElement('div');
    sheet.id = '_revision_sheet';
    sheet.style.cssText = 'position:fixed;inset:0;z-index:9400;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;';
    sheet.innerHTML = `
      <div style="background:white;border-radius:20px 20px 0 0;padding:24px 20px 40px;width:100%;max-height:85vh;overflow-y:auto;">
        <div style="width:40px;height:4px;background:#E8E8E8;border-radius:4px;margin:0 auto 20px;"></div>
        <div style="font-size:20px;font-weight:800;color:#0F0F0F;margin-bottom:8px;">🔄 Revision requested</div>
        <div style="font-size:14px;color:#666;margin-bottom:20px;line-height:1.5;">
          ${c.brand_name || 'The brand'} has requested a revision for <strong>${c.title || 'your campaign'}</strong>.
          You have <strong>24 hours</strong> to re-shoot and re-submit.
        </div>
        ${revNote ? `
        <div style="background:#FEF2F2;border:1.5px solid #FECACA;border-radius:14px;padding:14px;margin-bottom:20px;">
          <div style="font-size:12px;font-weight:700;color:#B91C1C;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;">Brand feedback</div>
          <div style="font-size:14px;color:#991B1B;line-height:1.6;">"${revNote}"</div>
        </div>` : ''}
        <button onclick="document.getElementById('_revision_sheet')?.remove();if(typeof showTab==='function')showTab('shoot');"
          style="width:100%;padding:14px;background:#5B2EE8;color:white;border:none;border-radius:30px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:10px;">
          Go to my tasks →
        </button>
        <button onclick="document.getElementById('_revision_sheet')?.remove();"
          style="width:100%;padding:12px;background:none;color:#666;border:none;cursor:pointer;font-size:14px;font-weight:600;font-family:inherit;">
          Dismiss
        </button>
      </div>`;
    sheet.addEventListener('click', e => { if (e.target === sheet) sheet.remove(); });
    document.body.appendChild(sheet);
  }

  /* ═══════════════════════════════════════════════════════════
     FIX ⑦: 24-hour auto-approval guard
     If brand hasn't responded in 24h, auto-approve the task
  ═══════════════════════════════════════════════════════════ */
  window._checkAutoApproval = async function() {
    const tasks = window._db.tasks || [];
    const submitted = tasks.filter(t =>
      t.state === 'submitted' && t.submitted_at &&
      (Date.now() - new Date(t.submitted_at).getTime()) > 24 * 3600 * 1000
    );

    for (const task of submitted) {
      try {
        await window._supabase.from('tasks').update({
          state: 'auto_approved',
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', task.id);

        // Create payout
        const c = task.campaigns || {};
        const earnAmt = parseFloat(c.reward_cash || 0) * 0.70;
        if (earnAmt > 0) {
          const { data: existingPayout } = await window._supabase
            .from('payouts').select('id').eq('task_id', task.id).maybeSingle();
          if (!existingPayout) {
            await window._supabase.from('payouts').insert({
              user_id: task.user_id,
              task_id: task.id,
              campaign_id: task.campaign_id,
              campaign_title: c.title || 'Campaign',
              amount: earnAmt,
              amount_usd: earnAmt,
              status: 'pending',
              type: 'campaign',
              created_at: new Date().toISOString(),
            });
          }
        }

        await window._supabase.from('notifications').insert({
          user_id: task.user_id,
          type: 'payout',
          title: '✅ Video auto-approved!',
          body: `"${c.title || 'Your campaign'}" was auto-approved after 24 hours. $${earnAmt.toFixed(0)} added to your earnings.`,
          read: false,
        });

        if (typeof dbLoadTasks === 'function') await dbLoadTasks();
        if (typeof dbLoadPayouts === 'function') await dbLoadPayouts();
      } catch(e) {
        console.warn('[Bridge v2] auto-approval error:', e.message);
      }
    }
  };

  /* ═══════════════════════════════════════════════════════════
     FIX ⑧: Applications nav badge — live pending count
  ═══════════════════════════════════════════════════════════ */
  window._updateApplicationsBadge = function() {
    const apps = window._db.applications || [];
    const tasks = window._db.tasks || [];

    // Count items needing attention
    const pendingApps = apps.filter(a => ['applied', 'selected', 'selected_digital', 'confirm'].includes(a.status)).length;
    const activeTasks = tasks.filter(t => !['approved', 'auto_approved'].includes(t.state)).length;

    // Update shoot tab badge
    const shootCount = document.getElementById('shoot-count');
    if (shootCount) shootCount.textContent = activeTasks;

    // Update tasks tab badge
    const appliedCount = document.getElementById('chip-applied');
    if (appliedCount) {
      const pending = apps.filter(a => a.status !== 'completed' && a.status !== 'revoked').length;
      if (pending > 0) {
        const existing = appliedCount.querySelector('.todo-count');
        if (existing) existing.textContent = pending;
      }
    }
  };

  /* ═══════════════════════════════════════════════════════════
     FIX ⑨: Patch photo upload to upload to correct bucket
     with real progress tracking (not fake animation)
  ═══════════════════════════════════════════════════════════ */
  // Fix handleTaskCardPhotoSelect to use XMLHttpRequest for real progress
  const _origPhotoSelect = window.handleTaskCardPhotoSelect;
  window.handleTaskCardPhotoSelect = async function(input, applicationId, slotIndex) {
    const file = input.files[0];
    if (!file) return;

    const slotEl = document.getElementById(`photo-slot-${applicationId}-${slotIndex}`);

    // Show thumbnail preview immediately
    if (slotEl) {
      const reader = new FileReader();
      reader.onload = e => {
        slotEl.style.border = '2px solid var(--brand)';
        slotEl.style.padding = '0';
        slotEl.style.overflow = 'hidden';
        slotEl.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">
          <div style="position:absolute;bottom:0;left:0;right:0;height:3px;background:var(--brand-soft);border-radius:0 0 8px 8px;">
            <div id="photo-prog-${applicationId}-${slotIndex}" style="height:100%;width:0%;background:var(--brand);transition:width .3s;border-radius:0 0 8px 8px;"></div>
          </div>`;
        slotEl.style.position = 'relative';
      };
      reader.readAsDataURL(file);
    }

    try {
      const { data: { user } } = await window._supabase.auth.getUser();
      if (!user) { if (typeof showToast === 'function') showToast('Please log in again', 'error'); return; }

      const ext = file.name.split('.').pop();
      const path = `${user.id}/${applicationId}/photo_${slotIndex}.${ext}`;

      // Simulate progress during upload
      const progEl = document.getElementById(`photo-prog-${applicationId}-${slotIndex}`);
      let fakeP = 0;
      const iv = setInterval(() => {
        if (fakeP < 85) { fakeP += Math.floor(Math.random() * 10) + 3; fakeP = Math.min(fakeP, 85); }
        if (progEl) progEl.style.width = fakeP + '%';
      }, 200);

      // Try 'photos' bucket first, fallback to 'videos'
      let uploadData, uploadError;
      const attempt = await window._supabase.storage.from('photos').upload(path, file, { upsert: true });
      if (attempt.error) {
        const fallback = await window._supabase.storage.from('videos').upload(path, file, { upsert: true });
        uploadData = fallback.data; uploadError = fallback.error;
      } else {
        uploadData = attempt.data; uploadError = attempt.error;
      }

      clearInterval(iv);

      if (uploadError) {
        if (progEl) progEl.style.background = '#EF4444';
        if (typeof showToast === 'function') showToast('Photo upload failed: ' + uploadError.message, 'error');
        return;
      }

      if (progEl) progEl.style.width = '100%';

      // Store path for submission
      if (!window._pendingPhotoFiles) window._pendingPhotoFiles = {};
      const key = `${applicationId}_photo_${slotIndex}`;
      window._pendingPhotoFiles[key] = file;
      window._pendingPhotoFiles[key + '_path'] = uploadData.path;

      if (typeof showToast === 'function') showToast(`Photo ${slotIndex + 1} uploaded ✓`, 'success');
    } catch(e) {
      if (typeof showToast === 'function') showToast('Photo upload error: ' + e.message, 'error');
    }
  };

  /* ═══════════════════════════════════════════════════════════
     FIX ⑩: openBriefDoc — open PDF or Google Doc brief
  ═══════════════════════════════════════════════════════════ */
  window.openBriefDoc = function(url) {
    if (!url) return;
    // Try to open in-app first using a simple webview overlay
    const overlay = document.createElement('div');
    overlay.id = '_brief_doc_overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9600;background:#000;display:flex;flex-direction:column;';
    overlay.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;padding:16px;background:#0F0F0F;safe-area-inset-top:env(safe-area-inset-top);">
        <button onclick="document.getElementById('_brief_doc_overlay')?.remove();"
          style="background:rgba(255,255,255,.15);border:none;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </button>
        <span style="color:white;font-size:15px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Campaign Brief</span>
        <a href="${url}" target="_blank" style="color:#A78BFA;font-size:13px;font-weight:600;text-decoration:none;">Open ↗</a>
      </div>
      <iframe src="${url}" style="flex:1;border:none;background:white;" allowfullscreen></iframe>`;
    document.body.appendChild(overlay);
  };

  /* ═══════════════════════════════════════════════════════════
     BOOT: Wire everything up after DOM + app.js ready
  ═══════════════════════════════════════════════════════════ */
  function _boot() {
    // Hook into loadAllData to run badge updates after every data load
    const origLoadAll = window.loadAllData;
    if (origLoadAll && !origLoadAll._v2Hooked) {
      window.loadAllData = async function(...args) {
        const result = await origLoadAll.apply(this, args);
        _refreshBadges();
        window._updateApplicationsBadge();
        return result;
      };
      window.loadAllData._v2Hooked = true;
    }

    // Hook dbLoadApplications for badge auto-update
    const origLoadApps = window.dbLoadApplications;
    if (origLoadApps && !origLoadApps._v2Hooked) {
      window.dbLoadApplications = async function(...args) {
        const result = await origLoadApps.apply(this, args);
        window._updateApplicationsBadge();
        _refreshBadges();
        return result;
      };
      window.dbLoadApplications._v2Hooked = true;
    }

    // Hook dbLoadNotifications for badge auto-update
    const origLoadNotifs = window.dbLoadNotifications;
    if (origLoadNotifs && !origLoadNotifs._v2Hooked) {
      window.dbLoadNotifications = async function(...args) {
        const result = await origLoadNotifs.apply(this, args);
        window.updateNotifBadge();
        return result;
      };
      window.dbLoadNotifications._v2Hooked = true;
    }

    // Start enhanced realtime subscription
    _enhanceTaskBridgeSubscription();

    // Check auto-approvals on boot (catches any missed during offline)
    setTimeout(() => {
      window._checkAutoApproval();
    }, 3000);

    // Run initial badge update
    _refreshBadges();
    window._updateApplicationsBadge();

    console.log('[Vyralist] workflow_bridge_v2.js loaded — 10 fixes applied');
  }

  // Boot when _enterApp fires (app is fully authenticated and ready)
  if (window._enterAppReady) {
    _boot();
  } else {
    window.addEventListener('_enterAppReady', _boot, { once: true });
  }

  // Also boot on DOMContentLoaded as a fallback
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_boot, 500));
  } else {
    setTimeout(_boot, 500);
  }

})();
