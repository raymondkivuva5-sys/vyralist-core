/* ============================================================
   TASKS.JS — Tasks screen (applied / completed tabs), DB task
   loading, video upload pipeline, organic posting submission.
   ============================================================ */

/* ── Render tasks screen (applied + completed tabs) ─────── */
function renderTasksScreen() {
  const apps = window._db.applications;
  const invitations = apps.filter(a => a.status === 'invited');
  const pendingApps = apps.filter(a => a.status !== 'completed' && a.status !== 'invited');

  const appliedChip = document.getElementById('chip-applied');
  if (appliedChip) {
    const cnt = pendingApps.length;
    const invBadge = invitations.length
      ? ` <span style="background:#F59E0B;color:white;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;">${invitations.length}</span>` : '';
    appliedChip.innerHTML = `Applied <span class="todo-count">${cnt}</span>${invBadge}`;
  }

  const completedChip = document.getElementById('chip-completed');
  if (completedChip) {
    const cnt = apps.filter(a => a.status === 'completed').length;
    completedChip.innerHTML = `Completed <span class="todo-count">${cnt}</span>`;
  }

  const appliedList = document.getElementById('todo-applied-dynamic');
  if (appliedList) {
    let html = '';
    if (invitations.length) {
      html += `<div style="padding:12px 16px 4px;font-size:13px;font-weight:700;color:#D97706;letter-spacing:.2px;text-transform:uppercase;">✉️ Invitations (${invitations.length})</div>`;
      html += invitations.map(a => appliedTaskCard(a)).join('');
      if (pendingApps.length) html += `<div style="padding:12px 16px 4px;font-size:13px;font-weight:700;color:var(--text-3);letter-spacing:.2px;text-transform:uppercase;">My applications</div>`;
    }
    if (pendingApps.length) html += pendingApps.map(a => appliedTaskCard(a)).join('');
    if (!html) html = `<div style="padding:60px 32px;text-align:center;color:#999;"><div style="font-size:48px;margin-bottom:12px;">📋</div><div style="font-size:16px;font-weight:600;color:#333;margin-bottom:6px;">No applications yet</div><div style="font-size:14px;line-height:1.6;">Browse offers and apply to campaigns to see them here.</div></div>`;
    appliedList.innerHTML = html;
  }

  const completedList = document.getElementById('todo-completed-dynamic');
  if (completedList) {
    const done = apps.filter(a => a.status === 'completed');
    completedList.innerHTML = done.length
      ? done.map(a => completedTaskCard(a)).join('')
      : `<div style="padding:60px 32px;text-align:center;color:#999;"><div style="font-size:48px;margin-bottom:12px;">🎬</div><div style="font-size:16px;font-weight:600;color:#333;margin-bottom:6px;">No completed videos yet</div><div style="font-size:14px;line-height:1.6;">Your completed campaign videos will appear here once approved.</div></div>`;
  }
}

/* ── Applied task card ───────────────────────────────────── */
function appliedTaskCard(a) {
  const c = a.campaigns || {};
  const statusLabel = ({
    invited:'✉️ Brand invited you — express interest',
    applied:'⏳ Awaiting brand review',
    selected:'🎉 Selected! Product shipping soon',
    selected_digital:'🎉 Selected! Ready to film',
    shipped:'📦 Product shipped — confirm receipt',
    confirm:'📦 Confirm you received the product',
    filming:'🎬 Filming — submit your video',
    filming_digital:'🎬 Filming — submit your video',
    submitted:'✅ Video submitted — under review',
    revision:'📝 Revision requested — re-submit your video',
  })[a.status] || a.status;

  const isInvited   = a.status === 'invited';
  const isFilming   = a.status === 'filming' || a.status === 'filming_digital';
  const isSubmitted = a.status === 'submitted';
  const isRevision  = a.status === 'revision';

  // Billo gives 48h for edit requests — use revision_deadline if set, else assume 48h window
  const revDeadlineMs = isRevision
    ? (a.revision_deadline ? Math.max(0, new Date(a.revision_deadline) - Date.now()) : 48 * 3600000)
    : 0;
  const revLabel  = revDeadlineMs <= 0 ? 'Overdue' : `${Math.floor(revDeadlineMs/3600000)}h ${Math.floor((revDeadlineMs%3600000)/60000)}m remaining`;
  const revUrgent = revDeadlineMs > 0 && revDeadlineMs < 6 * 3600000;

  const hasOrganic  = !!(c.organic_posting);
  const orgReward   = c.org_reward_extra ? `+$${c.org_reward_extra}` : '+bonus';
  const showOrganic = hasOrganic && (isFilming || isSubmitted);

  return `
    <div class="task-card" style="margin:12px 16px;border-radius:16px;overflow:hidden;border:${isInvited ? '2px solid #F59E0B' : '1px solid var(--border)'};background:white;">
      ${isInvited ? `<div style="background:#FFFBEB;padding:6px 14px;font-size:11px;font-weight:700;color:#D97706;letter-spacing:.3px;text-transform:uppercase;">✉️ Brand invitation</div>` : ''}
      <div style="height:90px;background:${c.gradient_css||'linear-gradient(135deg,#6C3EF0,#A78BFA)'};position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:40px;">
        ${c.thumbnail_url ? `<img src="${c.thumbnail_url}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;" onerror="this.style.display='none';">` : ''}
        <span style="position:relative;">${c.emoji||'🎬'}</span>
      </div>
      <div style="padding:14px;">
        <div style="font-size:13px;font-weight:600;color:${isInvited ? '#D97706' : 'var(--brand)'};margin-bottom:4px;">${statusLabel}</div>
        <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${c.brand_name||'Campaign'}</div>
        <div style="font-size:13px;color:var(--text-2);">${c.title||''}</div>
        ${(c.videos_required > 1) ? (() => {
          const total = c.videos_required;
          const done  = a.videos_submitted || 0;
          const pct   = Math.round((done / total) * 100);
          return `<div style="margin-top:10px;background:#F5F3FF;border-radius:12px;padding:10px 12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:12px;font-weight:700;color:var(--brand);">Video ${done + 1} of ${total}</span>
              <span style="font-size:11px;color:var(--text-3);">${done}/${total} submitted</span>
            </div>
            <div style="background:#DDD6FE;border-radius:4px;height:5px;overflow:hidden;">
              <div style="height:100%;background:var(--brand);width:${pct}%;border-radius:4px;transition:width .3s;"></div>
            </div>
          </div>`;
        })() : ''}
        ${_deadlineBadge(a)}
        ${(c.photos_required > 0 && isFilming) ? `
          <div style="margin-top:12px;">
            <div style="font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:8px;">📸 Photos required (${c.photos_required})</div>
            <div id="photo-slots-${a.id}" style="display:grid;grid-template-columns:repeat(${Math.min(c.photos_required,3)},1fr);gap:8px;">
              ${Array.from({length: c.photos_required}, (_, i) => `
                <label for="photo-file-${a.id}-${i}" style="cursor:pointer;">
                  <input type="file" id="photo-file-${a.id}-${i}" accept="image/*" style="display:none;"
                         onchange="handleTaskCardPhotoSelect(this,'${a.id}',${i})">
                  <div id="photo-slot-${a.id}-${i}" style="aspect-ratio:1;border:2px dashed var(--border);border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:20px;background:#FAFAFA;">
                    📷
                    <div style="font-size:9px;color:var(--text-3);margin-top:2px;">Photo ${i+1}</div>
                  </div>
                </label>`).join('')}
            </div>
          </div>` : ''}
        ${c.brief_document_url ? `
          <button onclick="openBriefDoc('${c.brief_document_url}')" style="margin-top:10px;width:100%;padding:11px;background:none;color:var(--brand);border:1.5px solid var(--brand);border-radius:30px;font-size:13px;font-weight:700;cursor:pointer;font-family:'Satoshi',sans-serif;display:flex;align-items:center;justify-content:center;gap:6px;">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            View brief
          </button>` : ''}
        ${isInvited ? `<button onclick="dbExpressInterest('${a.id}','${a.campaign_id}')" style="margin-top:12px;width:100%;padding:12px;background:var(--brand);color:white;border:none;border-radius:30px;font-size:14px;font-weight:700;cursor:pointer;font-family:'Satoshi',sans-serif;">Express interest</button>` : ''}
        ${a.status === 'confirm' ? `<button onclick="dbConfirmProduct('${a.id}')" style="margin-top:12px;width:100%;padding:12px;background:var(--brand);color:white;border:none;border-radius:30px;font-size:14px;font-weight:700;cursor:pointer;">Confirm receipt</button>` : ''}
        ${a.status === 'applied' ? `<button onclick="showRevokeSheet('${a.id}')" style="margin-top:10px;width:100%;padding:11px;background:none;color:#EF4444;border:1.5px solid #FCA5A5;border-radius:30px;font-size:13px;font-weight:700;cursor:pointer;font-family:'Satoshi',sans-serif;">Withdraw application</button>` : ''}
        ${isFilming ? `
          <div id="submit-zone-${a.id}" style="margin-top:12px;">
            <input type="file" id="submit-file-${a.id}" accept="video/*" style="display:none;" onchange="handleCampaignVideoSelect(this,'${a.id}')">
            <div id="submit-empty-${a.id}" style="border:2px dashed var(--border);border-radius:12px;padding:16px;text-align:center;cursor:pointer;" onclick="document.getElementById('submit-file-${a.id}').click()">
              <div style="font-size:28px;margin-bottom:6px;">🎬</div>
              <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px;">Tap to choose your video</div>
              <div style="font-size:11px;color:var(--text-3);">MP4, MOV — any size</div>
            </div>
            <div id="submit-uploading-${a.id}" style="display:none;">
              <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;" id="submit-filename-${a.id}"></div>
              <div style="background:var(--border);border-radius:4px;height:6px;overflow:hidden;margin-bottom:6px;">
                <div id="submit-bar-${a.id}" style="height:100%;background:var(--brand);width:0%;transition:width 0.3s;border-radius:4px;"></div>
              </div>
              <div style="font-size:11px;color:var(--text-3);" id="submit-pct-${a.id}">0%</div>
            </div>
            <button id="submit-btn-${a.id}" onclick="dbSubmitVideo('${a.id}')" disabled style="margin-top:10px;width:100%;padding:12px;background:#ccc;color:white;border:none;border-radius:30px;font-size:14px;font-weight:700;cursor:not-allowed;">Submit video</button>
          </div>` : ''}
        ${isRevision ? `
          <div style="margin-top:12px;">
            <div style="background:#FEF2F2;border:1.5px solid #FECACA;border-radius:14px;padding:14px;margin-bottom:10px;">
              <div style="font-size:13px;font-weight:700;color:#B91C1C;margin-bottom:4px;">📝 Revision requested</div>
              ${a.revision_note ? `<div style="font-size:12px;color:#991B1B;line-height:1.55;margin-bottom:10px;padding:8px 10px;background:#FFF5F5;border-radius:8px;border-left:3px solid #FCA5A5;">"${a.revision_note}"</div>` : '<div style="font-size:12px;color:#991B1B;margin-bottom:10px;">The brand has requested changes. See your brief for details.</div>'}
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="font-size:11px;font-weight:700;color:#B91C1C;text-transform:uppercase;letter-spacing:.4px;">Deadline</span>
                <span style="font-size:13px;font-weight:700;color:${revUrgent ? '#EF4444' : '#B91C1C'};">${revLabel}</span>
              </div>
            </div>
            <input type="file" id="submit-file-${a.id}" accept="video/*" style="display:none;" onchange="handleCampaignVideoSelect(this,'${a.id}')">
            <div id="submit-empty-${a.id}" style="border:2px dashed #FECACA;border-radius:12px;padding:16px;text-align:center;cursor:pointer;background:#FFF5F5;" onclick="document.getElementById('submit-file-${a.id}').click()">
              <div style="font-size:28px;margin-bottom:6px;">🔄</div>
              <div style="font-size:13px;font-weight:700;color:#B91C1C;margin-bottom:2px;">Upload revised video</div>
              <div style="font-size:11px;color:#EF4444;">MP4, MOV — any size</div>
            </div>
            <div id="submit-uploading-${a.id}" style="display:none;">
              <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:6px;" id="submit-filename-${a.id}"></div>
              <div style="background:#FEE2E2;border-radius:4px;height:6px;overflow:hidden;margin-bottom:6px;">
                <div id="submit-bar-${a.id}" style="height:100%;background:#EF4444;width:0%;transition:width 0.3s;border-radius:4px;"></div>
              </div>
              <div style="font-size:11px;color:#EF4444;" id="submit-pct-${a.id}">0%</div>
            </div>
            <button id="submit-btn-${a.id}" onclick="dbSubmitRevision('${a.id}')" disabled style="margin-top:10px;width:100%;padding:12px;background:#ccc;color:white;border:none;border-radius:30px;font-size:14px;font-weight:700;cursor:not-allowed;">Submit revision</button>
          </div>` : ''}
        ${showOrganic ? `
          <div style="margin-top:12px;background:#F5F3FF;border:1.5px solid var(--brand);border-radius:14px;padding:14px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
              <div style="width:32px;height:32px;border-radius:8px;background:var(--brand-soft);display:flex;align-items:center;justify-content:center;">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--brand)" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              </div>
              <div>
                <div style="font-size:13px;font-weight:700;color:var(--brand);">Organic posting add-on</div>
                <div style="font-size:11px;color:var(--text-2);">Earn <strong>${orgReward}</strong> extra</div>
              </div>
            </div>
            <div style="font-size:12px;color:var(--text-2);line-height:1.5;margin-bottom:10px;">Post this video on your social account for 30 days and submit the link below to unlock your bonus.</div>
            <input type="url" id="organic-link-${a.id}" placeholder="https://tiktok.com/@you/video/..." style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;font-family:'Satoshi',sans-serif;outline:none;margin-bottom:8px;" onfocus="this.style.borderColor='var(--brand)'" onblur="this.style.borderColor='var(--border)'">
            <button onclick="dbSubmitOrganicLink('${a.id}')" style="width:100%;padding:11px;background:var(--brand);color:white;border:none;border-radius:30px;font-size:13px;font-weight:700;cursor:pointer;font-family:'Satoshi',sans-serif;">Submit post link → earn ${orgReward}</button>
          </div>` : ''}
      </div>
    </div>`;
}

/* ── Revoke application — styled bottom sheet (WKWebView-safe) ── */
function showRevokeSheet(applicationId) {
  // Remove any existing sheet
  const existing = document.getElementById('_revokeSheet');
  if (existing) existing.remove();

  const sheet = document.createElement('div');
  sheet.id = '_revokeSheet';
  sheet.innerHTML = `
    <div onclick="document.getElementById('_revokeSheet').remove()"
         style="position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9998;"></div>
    <div style="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:white;border-radius:20px 20px 0 0;padding:24px 20px 40px;box-shadow:0 -4px 32px rgba(0,0,0,0.15);">
      <div style="width:40px;height:4px;background:var(--border);border-radius:4px;margin:0 auto 20px;"></div>
      <div style="font-size:18px;font-weight:800;color:var(--text);margin-bottom:6px;text-align:center;">Withdraw application?</div>
      <div style="font-size:14px;color:var(--text-2);text-align:center;line-height:1.55;margin-bottom:24px;">This will remove your application from the brand's review. You can re-apply if the campaign is still open.</div>
      <button onclick="dbRevokeApplication('${applicationId}');document.getElementById('_revokeSheet').remove();"
              style="width:100%;padding:14px;background:#EF4444;color:white;border:none;border-radius:30px;font-size:15px;font-weight:700;cursor:pointer;font-family:'Satoshi',sans-serif;margin-bottom:10px;">
        Yes, withdraw
      </button>
      <button onclick="document.getElementById('_revokeSheet').remove()"
              style="width:100%;padding:14px;background:none;color:var(--text-2);border:1.5px solid var(--border);border-radius:30px;font-size:15px;font-weight:600;cursor:pointer;font-family:'Satoshi',sans-serif;">
        Cancel
      </button>
    </div>`;
  document.body.appendChild(sheet);
}

/* ── Completed task card ─────────────────────────────────── */
function completedTaskCard(a) {
  const c = a.campaigns || {};
  return `
    <div class="task-card" style="margin:12px 16px;border-radius:16px;overflow:hidden;border:1px solid var(--border);background:white;">
      <div style="height:90px;background:${c.gradient_css||'linear-gradient(135deg,#6C3EF0,#A78BFA)'};position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:40px;">
        ${c.thumbnail_url ? `<img src="${c.thumbnail_url}" style="width:100%;height:100%;object-fit:cover;position:absolute;inset:0;" onerror="this.style.display='none';">` : ''}
        <span style="position:relative;">${c.emoji||'🎬'}</span>
      </div>
      <div style="padding:14px;">
        <div style="font-size:13px;font-weight:600;color:var(--success);margin-bottom:4px;">✅ Completed</div>
        <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${c.brand_name||'Campaign'}</div>
        <div style="font-size:13px;color:var(--text-2);">${c.title||''}</div>
      </div>
    </div>`;
}

/* ── Deadline badge helper ───────────────────────────────── */
function _deadlineBadge(a) {
  const now = Date.now();
  let ms = 0, label = '';
  if (['filming','filming_digital'].includes(a.status) && a.filming_deadline) {
    ms = new Date(a.filming_deadline) - now;
    label = ms <= 0 ? 'Overdue' : _fmtDeadline(ms) + ' to submit';
  } else if (a.status === 'revision' && a.revision_deadline) {
    ms = new Date(a.revision_deadline) - now;
    label = ms <= 0 ? 'Overdue' : _fmtDeadline(ms) + ' for revision';
  } else if (a.status === 'selected' && a.shipping_deadline) {
    ms = new Date(a.shipping_deadline) - now;
    label = ms <= 0 ? 'Awaiting shipment' : _fmtDeadline(ms) + ' to ship';
  } else { return ''; }
  const overdue = ms <= 0, urgent = !overdue && ms < 7200000;
  const bg    = overdue ? '#FEE2E2' : urgent ? '#FEF3C7' : '#EDE8FD';
  const color = overdue ? '#B91C1C' : urgent ? '#92400E' : 'var(--brand)';
  const dot   = overdue ? '#EF4444' : urgent ? '#F59E0B' : 'var(--brand)';
  return `<div style="display:inline-flex;align-items:center;gap:5px;background:${bg};color:${color};border-radius:20px;padding:4px 10px;font-size:11px;font-weight:700;margin-top:8px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="${dot}" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>${label}</div>`;
}
function _fmtDeadline(ms) {
  const d = Math.floor(ms / 86400000); if (d >= 2) return d + 'd';
  const h = Math.floor(ms / 3600000);  if (h >= 1) return h + 'h';
  return Math.floor(ms / 60000) + 'm';
}

/* ── DB: Confirm product receipt ─────────────────────────── */
async function dbConfirmProduct(applicationId) {
  const app = window._db.applications.find(a => a.id === applicationId);
  const c = app?.campaigns || {};
  // Billo rule: physical products get 5-day filming window; digital = 72h
  const requiresShipping = c.requires_shipping !== false && app?.status !== 'filming_digital';
  const filmingHours = requiresShipping ? 5 * 24 : 72;
  await dbUpdateTaskState(applicationId, 'filming', {
    filming_deadline: new Date(Date.now() + filmingHours * 3600 * 1000).toISOString(),
  });
  const msg = requiresShipping
    ? 'Receipt confirmed! You have 5 days to film.'
    : 'Ready to film! You have 72 hours to submit.';
  showToast(msg, 'success');
}

/* ── Video upload pipeline ───────────────────────────────── */
const _pendingVideoFiles = {};

async function handleCampaignVideoSelect(input, applicationId) {
  const file = input.files[0];
  if (!file) return;

  /* ── Pre-flight validation ───────────────────────────── */
  const MAX_MB = 500;
  const ALLOWED_TYPES = ['video/mp4','video/quicktime','video/x-m4v','video/webm','video/mov'];
  if (!file.type.startsWith('video/') && !ALLOWED_TYPES.includes(file.type)) {
    showToast('Please upload a video file (MP4 or MOV)', 'error');
    input.value = '';
    return;
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    showToast(`Video must be under ${MAX_MB}MB. Your file is ${Math.round(file.size / 1024 / 1024)}MB.`, 'error');
    input.value = '';
    return;
  }

  _pendingVideoFiles[applicationId] = file;

  const emptyZone    = document.getElementById('submit-empty-' + applicationId);
  const uploadingZone = document.getElementById('submit-uploading-' + applicationId);
  const fileNameEl   = document.getElementById('submit-filename-' + applicationId);
  const btn          = document.getElementById('submit-btn-' + applicationId);

  if (emptyZone)     emptyZone.style.display     = 'none';
  if (uploadingZone) uploadingZone.style.display  = 'block';
  if (fileNameEl)    fileNameEl.textContent       = file.name.length > 30 ? file.name.slice(0,27) + '…' : file.name;

  const bar = document.getElementById('submit-bar-' + applicationId);
  const pct = document.getElementById('submit-pct-' + applicationId);

  let fakeP = 0;
  const iv = setInterval(() => {
    if (fakeP < 85) { fakeP += Math.floor(Math.random() * 8) + 3; fakeP = Math.min(fakeP, 85); }
    if (bar) bar.style.width = fakeP + '%';
    if (pct) pct.textContent = fakeP + '%';
  }, 300);

  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) { clearInterval(iv); showToast('Please log in again to upload', 'error'); return; }

  const ext = file.name.split('.').pop();
  const path = `${user.id}/${applicationId}/submission.${ext}`;

  const { data: uploadData, error } = await window._supabase.storage
    .from('videos').upload(path, file, { upsert: true });
  clearInterval(iv);

  if (error) {
    if (bar) { bar.style.width = '0%'; bar.style.background = '#EF4444'; }
    if (pct) pct.textContent = 'Upload failed';
    showToast('Upload failed: ' + error.message, 'error');
    return;
  }

  if (bar) { bar.style.width = '100%'; bar.style.background = 'var(--success)'; }
  if (pct) pct.textContent = '100% — ready to submit';
  if (btn) { btn.disabled = false; btn.style.background = 'var(--brand)'; btn.style.cursor = 'pointer'; }
  _pendingVideoFiles[applicationId + '_path'] = uploadData.path;
}

async function dbSubmitVideo(applicationId) {
  const storagePath = _pendingVideoFiles[applicationId + '_path'];
  if (!storagePath) { showToast('Please select a video file first.', 'error'); return; }
  const btn = document.getElementById('submit-btn-' + applicationId);
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
  await dbUpdateTaskState(applicationId, 'submitted', { submitted_at: new Date().toISOString() });
  const app = window._db.applications.find(a => a.id === applicationId);
  const campaignId = app?.campaign_id || app?.campaigns?.id || null;
  await dbInsertVideo(applicationId, storagePath, campaignId);
  const { data: { user } } = await window._supabase.auth.getUser();
  if (user) {
    await dbInsertNotification(user.id, 'submitted', 'Video submitted!',
      `Your video for ${app?.campaigns?.brand_name||'the brand'} is under review.`);
    await dbLoadNotifications();
  }
  delete _pendingVideoFiles[applicationId];
  delete _pendingVideoFiles[applicationId + '_path'];
  await dbLoadApplications();
  showToast('Video submitted! Under review.', 'success');
}

async function dbSubmitRevision(applicationId) {
  const storagePath = _pendingVideoFiles[applicationId + '_path'];
  if (!storagePath) { showToast('Please upload your revised video first', 'error'); return; }
  const btn = document.getElementById('submit-btn-' + applicationId);
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting revision…'; }
  const app = window._db.applications.find(a => a.id === applicationId);
  const revCount = (app?.revision_count || 0) + 1;
  await dbUpdateTaskState(applicationId, 'submitted', {
    submitted_at: new Date().toISOString(), revision_count: revCount, submitted_video_path: storagePath,
  });
  const campaignId = app?.campaign_id || app?.campaigns?.id || null;
  await dbInsertVideo(applicationId, storagePath, campaignId);
  const { data: { user } } = await window._supabase.auth.getUser();
  if (user) {
    await dbInsertNotification(user.id, 'submitted', 'Revision submitted!',
      `Your revised video for ${app?.campaigns?.brand_name||'the brand'} is back under review.`);
    await dbLoadNotifications();
  }
  delete _pendingVideoFiles[applicationId];
  delete _pendingVideoFiles[applicationId + '_path'];
  await dbLoadApplications();
  showToast('Revision submitted! The brand will review it shortly.', 'success');
}

/* ── Photo slot handler (photos_required campaigns) ─────── */
/* Bug 8 fix: renamed from handlePhotoSelect to handleTaskCardPhotoSelect.
   app.js defines handlePhotoSelect(input, idx) for the task-upload overlay
   and loads after tasks.js, silently overwriting the 3-param version here.
   The HTML template below is updated to match. */
const _pendingPhotoFiles = {};
async function handleTaskCardPhotoSelect(input, applicationId, slotIndex) {
  const file = input.files[0];
  if (!file) return;
  const key = `${applicationId}_photo_${slotIndex}`;
  _pendingPhotoFiles[key] = file;

  const slotEl = document.getElementById(`photo-slot-${applicationId}-${slotIndex}`);
  if (slotEl) {
    const reader = new FileReader();
    reader.onload = e => {
      slotEl.style.border = '2px solid var(--brand)';
      slotEl.style.padding = '0';
      slotEl.style.overflow = 'hidden';
      slotEl.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
    };
    reader.readAsDataURL(file);
  }

  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) { showToast('Please log in again', 'error'); return; }

  const ext  = file.name.split('.').pop();
  const path = `${user.id}/${applicationId}/photo_${slotIndex}.${ext}`;
  const { data: uploadData, error } = await window._supabase.storage
    .from('photos').upload(path, file, { upsert: true });

  if (error) {
    showToast('Photo upload failed: ' + error.message, 'error');
    return;
  }
  _pendingPhotoFiles[key + '_path'] = uploadData.path;
  showToast(`Photo ${slotIndex + 1} uploaded ✓`, 'success');
}

/* ── Pull-to-refresh on Tasks feed ─────────────────────── */
(function _initTasksPullToRefresh() {
  let startY = 0, pulling = false;
  const THRESHOLD = 70;
  // Bug 10 fix: cache the screen element once, outside the hot event handler
  const tasksScreen = document.getElementById('screen-tasks');

  document.addEventListener('touchstart', e => {
    // Bug 2 fix: nav uses .active class, not display:none
    if (!tasksScreen || !tasksScreen.classList.contains('active')) return;
    startY = e.touches[0].clientY;
    pulling = window.scrollY === 0;
  }, { passive: true });

  document.addEventListener('touchend', async e => {
    if (!pulling) return;
    const dy = e.changedTouches[0].clientY - startY;
    if (dy > THRESHOLD) {
      pulling = false;
      showToast('Refreshing tasks…', 'info');
      await Promise.all([dbLoadTasks?.(), dbLoadApplications?.()]);
      renderTasksScreen();
      showToast('Tasks updated', 'success');
    }
    pulling = false;
  }, { passive: true });
})();

/* ── Bug 1 fix: function declaration was missing — body was orphaned after PTR IIFE ── */
async function dbSubmitOrganicLink(applicationId) {
  const input = document.getElementById('organic-link-' + applicationId);
  const link  = input ? input.value.trim() : '';
  if (!link) {
    showToast('Please paste your post link first', 'error');
    if (input) { input.style.borderColor = '#EF4444'; setTimeout(() => { input.style.borderColor = ''; }, 2000); }
    return;
  }
  try { new URL(link); } catch { showToast('Please enter a valid URL (https://...)', 'error'); return; }
  const app = window._db.applications.find(a => a.id === applicationId);
  if (!app) { showToast('Application not found', 'error'); return; }
  const { error } = await window._supabase.from('applications').update({
    organic_post_url: link, organic_submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', applicationId);
  if (error) { showToast('Could not save: ' + error.message, 'error'); return; }
  const { data: { user } } = await window._supabase.auth.getUser();
  if (user) {
    await dbInsertNotification(user.id, 'submitted', 'Organic post submitted!',
      `Your social post link for ${app?.campaigns?.brand_name||'the brand'} has been received.`);
    await dbLoadNotifications();
  }
  if (app) app.organic_post_url = link;
  showToast('Post link submitted! Bonus pay pending brand confirmation.', 'success');
  if (input) { input.disabled = true; input.style.opacity = '.6'; }
  const submitBtn = input?.nextElementSibling;
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '✓ Submitted'; submitBtn.style.background = 'var(--success)'; }
}
