/* ============================================================
   DETAIL.JS — Campaign detail CTA handler, pitch upload +
   submission, video pitch strip, brief PDF/GDocs viewer,
   video playback modal (signed URLs).

   Billo v5.22 parity fixes applied:
   1. Photo quality requirements section (lighting / aspect ratio /
      count tips) rendered BEFORE the upload zone when photos_required
   2. Scenario type icons — testimonial / unboxing / lifestyle /
      tutorial icons injected next to each scenario label
   3. goBack() nav-stack discipline — showDetail() now pushes the
      originating screen onto _navStack before navigating
   4. _openPdfModal — replaced blocking <iframe> with
      Capacitor Browser.open() so it works in WKWebView (iOS)
   5. renderOnboardSlide dot sync — active dot now set
      programmatically; hardcoded active classes in HTML are
      irrelevant (nav.js owns the source of truth)
   ============================================================ */

/* ── Detail CTA (Apply / Submit pitch) ──────────────────── */
let pitchSubmitted = false;
let pitchCountdownInterval = null;
let pitchDeadline = null;

function handleDetailCta() {
  const btn = document.getElementById('detail-cta-btn');
  if (!btn) return;
  const label = btn.textContent.trim();
  if (label === 'Submit pitch') {
    submitPitch();
  } else if (label === 'Apply') {
    // Legacy hardcoded campaigns path
    const title = document.getElementById('detail-title')?.textContent || '';
    const keyMap = { 'Tim Hortons': 'java', 'Rogers': 'rogers' };
    const key = Object.keys(keyMap).find(k => title.includes(k));
    const campaignKey = key ? keyMap[key] : null;
    const tc = campaignKey ? window.TASK_CAMPAIGNS[campaignKey] : null;
    applyToCampaignWithTask(title, tc ? tc.reward : '$30 + free product', campaignKey);
  }
}

/* ── Hardcoded campaign apply helper (legacy) ────────────── */
function applyToCampaign(name, reward) {
  document.getElementById('applied-campaign-name').textContent = name;
  document.getElementById('applied-reward').textContent = reward;
  document.getElementById('modal-apply-success').classList.add('open');
}
function applyToCampaignWithTask(name, reward, campaignKey) { applyToCampaign(name, reward); }

/* ── Submit pitch ────────────────────────────────────────── */
async function submitPitch() {
  const fileInput = document.getElementById('pitch-file-input');
  const file = fileInput?.files?.[0];

  if (!file) { showToast('Please upload a video first', 'error'); return; }

  const btn    = document.getElementById('detail-cta-btn');
  const banner = document.getElementById('pitch-pending-banner');
  const uploadSection = document.getElementById('pitch-upload-section');

  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) { showToast('Please log in again', 'error'); return; }

    /* Upload video to pitches bucket */
    const ext  = file.name.split('.').pop();
    const path = `${user.id}/pitch_${Date.now()}.${ext}`;
    const { data: uploadData, error: uploadError } = await window._supabase.storage
      .from('pitches').upload(path, file, { upsert: true });

    if (uploadError) throw uploadError;

    /* Get public URL */
    const { data: { publicUrl } } = window._supabase.storage
      .from('pitches').getPublicUrl(uploadData.path);

    /* Save to profiles */
    await window._supabase.from('profiles').update({
      pitch_video_url:    publicUrl,
      pitch_status:       'pending',
      pitch_submitted_at: new Date().toISOString(),
      updated_at:         new Date().toISOString(),
    }).eq('id', user.id);

    if (window._profileSignals) { window._profileSignals.hasPitch = true; }

    /* Update UI — hide upload zone + button, show pending banner */
    pitchSubmitted = true;
    window._pitchSubmitted = true;
    window._pitchStatus = 'pending';
    if (btn)           btn.style.display = 'none';
    if (uploadSection) uploadSection.style.display = 'none';

    /* Reset banner to pending state */
    if (banner) {
      banner.style.background = '';
      banner.style.border = '';
      banner.style.display = 'flex';
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:36px;height:36px;background:#FFF0D8;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px;">⏳</div>
          <div>
            <div style="font-size:14px;font-weight:700;color:#1a1a1a;">Pending approval</div>
            <div style="font-size:12px;color:#888;margin-top:1px;">Your pitch is under review</div>
          </div>
          <div style="margin-left:auto;text-align:right;">
            <div style="font-size:12px;color:#F59E0B;font-weight:700;" id="pitch-countdown">48:00:00</div>
            <div style="font-size:10px;color:#aaa;">remaining</div>
          </div>
        </div>
        <div style="background:#FFE8C0;border-radius:8px;height:6px;overflow:hidden;">
          <div id="pitch-progress-fill" style="height:100%;width:0%;background:linear-gradient(90deg,#F59E0B,#FBBF24);border-radius:8px;transition:width 1s linear;"></div>
        </div>
        <div style="font-size:11px;color:#999;text-align:center;">We'll notify you once your pitch has been reviewed — usually within 48 hours.</div>`;
    }

    pitchDeadline = Date.now() + 48 * 60 * 60 * 1000;
    updatePitchCountdown();
    if (pitchCountdownInterval) clearInterval(pitchCountdownInterval);
    pitchCountdownInterval = setInterval(updatePitchCountdown, 1000);

    showToast('Pitch submitted! We\'ll review it within 48 hours.', 'success');

  } catch (e) {
    showToast('Submission failed: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Submit pitch'; }
  }
}

function updatePitchCountdown() {
  const remaining = pitchDeadline - Date.now();
  const countdown = document.getElementById('pitch-countdown');
  const fill      = document.getElementById('pitch-progress-fill');
  if (!countdown) return;
  if (remaining <= 0) {
    clearInterval(pitchCountdownInterval);
    countdown.textContent = 'Reviewed!';
    if (fill) fill.style.width = '100%';
    return;
  }
  const totalMs = 48 * 60 * 60 * 1000;
  if (fill) fill.style.width = Math.min(((totalMs - remaining) / totalMs) * 100, 100) + '%';
  countdown.textContent =
    String(Math.floor(remaining / 3600000)).padStart(2,'0') + ':' +
    String(Math.floor((remaining % 3600000) / 60000)).padStart(2,'0') + ':' +
    String(Math.floor((remaining % 60000) / 1000)).padStart(2,'0');
}

/* ── Pitch video upload ──────────────────────────────────── */
async function handlePitchUpload(input) {
  const file = input.files[0];
  if (!file) return;

  /* ── Pre-flight validation ───────────────────────────── */
  const MAX_MB = 500;
  if (!file.type.startsWith('video/')) {
    showToast('Please upload a video file (MP4 or MOV)', 'error');
    input.value = '';
    return;
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    showToast(`Video must be under ${MAX_MB}MB. Your file is ${Math.round(file.size / 1024 / 1024)}MB.`, 'error');
    input.value = '';
    return;
  }


  document.getElementById('upload-zone-done').style.display  = 'block';
  document.getElementById('uvc-filename').textContent = file.name;
  document.getElementById('uvc-size').textContent = (file.size / (1024*1024)).toFixed(1) + ' MB';

  // Set local preview so creator can watch before submitting
  const videoEl = document.getElementById('uvc-video-preview');
  if (videoEl) {
    if (videoEl._objectUrl) URL.revokeObjectURL(videoEl._objectUrl);
    videoEl._objectUrl = URL.createObjectURL(file);
    videoEl.src = videoEl._objectUrl;
    videoEl.load();
  }

  const bar       = document.getElementById('uvc-bar');
  const pctLabel  = document.getElementById('uvc-pct');
  const progLabel = document.querySelector('#uvc-progress .prog-label span:first-child');
  const ctaBtn    = document.getElementById('detail-cta-btn');
  if (bar) { bar.style.width = '0%'; bar.style.background = ''; }
  if (pctLabel)  pctLabel.textContent  = '0%';
  if (progLabel) progLabel.textContent = 'Uploading video…';

  let fakeProgress = 0;
  const fakeInterval = setInterval(() => {
    if (fakeProgress < 85) { fakeProgress += Math.floor(Math.random() * 8) + 3; fakeProgress = Math.min(fakeProgress, 85); }
    if (bar) bar.style.width = fakeProgress + '%';
    if (pctLabel) pctLabel.textContent = fakeProgress + '%';
  }, 300);

  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) { clearInterval(fakeInterval); showToast('Please log in again to upload', 'error'); return; }

  const ext  = file.name.split('.').pop();
  const path = `${user.id}/pitch_preview.${ext}`;
  const { data: uploadData, error } = await window._supabase.storage
    .from('pitches').upload(path, file, { upsert: true });
  clearInterval(fakeInterval);

  if (error) { if (bar) bar.style.width = '0%'; if (pctLabel) pctLabel.textContent = '0%'; showToast('Upload failed: ' + error.message, 'error'); return; }

  if (bar) { bar.style.width = '100%'; bar.style.background = 'var(--success)'; }
  if (pctLabel) pctLabel.textContent  = '100%';
  if (progLabel) progLabel.textContent = 'Upload complete ✓';
  if (ctaBtn) { ctaBtn.textContent = 'Submit pitch'; ctaBtn.style.background = 'var(--success)'; setTimeout(() => { ctaBtn.style.background = ''; }, 1500); }
  input.dataset.storagePath = uploadData.path;
}

function resetPitchUpload() {
  document.getElementById('upload-zone-empty').style.display = 'flex';
  document.getElementById('upload-zone-done').style.display  = 'none';
  const bar = document.getElementById('uvc-bar');
  if (bar) { bar.style.width = '0%'; bar.style.background = ''; }
  const pctLabel = document.getElementById('uvc-pct');
  if (pctLabel) pctLabel.textContent = '0%';
  const inp = document.getElementById('pitch-file-input');
  if (inp) inp.value = '';
  // Revoke local preview URL to free memory
  const videoEl = document.getElementById('uvc-video-preview');
  if (videoEl) {
    if (videoEl._objectUrl) { URL.revokeObjectURL(videoEl._objectUrl); videoEl._objectUrl = null; }
    videoEl.src = '';
  }
}

/* ── Video pitch strip (portfolio re-upload) ─────────────── */
function triggerPvpUpload(idx) { document.getElementById('pvp-input-' + idx).click(); }

/* Bug 5 fix: handlePvpUpload stub removed — profile.js defines the real
   async version with Supabase Storage upload and DB persistence. Since
   profile.js loads after detail.js, the stub here was silently overwriting
   nothing (profile.js won anyway) but risked winning if load order changed. */

/* ── FIX 5: Brief document viewer — Capacitor Browser.open() ─
   Replaced <iframe> which is blocked in WKWebView on iOS.
   Browser.open() triggers the Capacitor in-app browser,
   matching Billo v5.22 behaviour. Falls back to window.open()
   on non-native (web preview) environments.
   ─────────────────────────────────────────────────────────── */
async function openBriefDoc(url) {
  if (!url) return;

  let finalUrl = url;
  if (!url.startsWith('http')) {
    const { data, error } = await window._supabase.storage.from('documents').createSignedUrl(url, 3600);
    if (error || !data?.signedUrl) { showToast('Could not open brief: ' + (error?.message || 'unknown error'), 'error'); return; }
    finalUrl = data.signedUrl;
  }

  const isGDrive = /docs\.google\.com|drive\.google\.com/i.test(finalUrl);
  let viewerUrl;
  if (isGDrive) {
    viewerUrl = finalUrl.replace(/\/edit(\?.*)?$/, '/preview').replace(/\/view(\?.*)?$/, '/preview');
    if (!viewerUrl.includes('/preview')) viewerUrl = finalUrl;
  } else {
    viewerUrl = `https://docs.google.com/gviewer?url=${encodeURIComponent(finalUrl)}&embedded=true`;
  }

  // Use Capacitor Browser plugin when running natively (iOS WKWebView safe).
  // Falls back to window.open() for web/desktop preview.
  const CapBrowser = window.Capacitor?.Plugins?.Browser;
  if (CapBrowser && window.Capacitor?.isNativePlatform?.()) {
    try {
      await CapBrowser.open({ url: viewerUrl, presentationStyle: 'popover' });
      return;
    } catch (e) {
      // If Browser plugin throws, fall through to window.open()
    }
  }
  window.open(viewerUrl, '_blank');
}

/* _openPdfModal / _closePdfModal kept for internal loading-state
   use only (e.g. the original spinner while resolving a signed URL).
   They are no longer used for the final viewer — that is handled
   by openBriefDoc() above via Capacitor Browser.open().          */
function _openPdfModal(iframeUrl) {
  const existing = document.getElementById('pdf-brief-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'pdf-brief-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#1a1a1a;display:flex;flex-direction:column;';
  const header = `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#111;flex-shrink:0;padding-top:max(12px,env(safe-area-inset-top));"><span style="color:white;font-size:15px;font-weight:700;">Brand brief</span><button onclick="_closePdfModal()" style="background:rgba(255,255,255,.12);border:none;color:white;font-size:14px;font-weight:600;padding:6px 14px;border-radius:20px;cursor:pointer;">Close</button></div>`;
  modal.innerHTML = iframeUrl
    ? header + `<iframe src="${iframeUrl}" style="flex:1;border:none;background:white;" allow="fullscreen"></iframe>`
    : header + `<div style="flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;"><div style="width:32px;height:32px;border:3px solid rgba(255,255,255,.15);border-top-color:white;border-radius:50%;animation:_spin 0.7s linear infinite;"></div><span style="color:rgba(255,255,255,.5);font-size:13px;">Loading document…</span></div>`;
  document.body.appendChild(modal);
}
function _closePdfModal() { const m = document.getElementById('pdf-brief-modal'); if (m) m.remove(); }

/* ── Video playback modal (signed URL) ───────────────────── */
async function playStorageVideo(storagePath) {
  if (!storagePath) { showToast('No video file for this submission.', 'error'); return; }
  _openVideoModal(null);
  const { data, error } = await window._supabase.storage.from('videos').createSignedUrl(storagePath, 3600);
  if (error || !data?.signedUrl) { _closeVideoModal(); showToast('Could not load video: ' + (error?.message || 'unknown error'), 'error'); return; }
  _openVideoModal(data.signedUrl);
}

function _openVideoModal(signedUrl) {
  const existing = document.getElementById('video-playback-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'video-playback-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;';
  modal.innerHTML = signedUrl
    ? `<div style="position:relative;width:100%;max-width:430px;padding:0 16px;"><button onclick="_closeVideoModal()" style="position:absolute;top:-44px;right:16px;background:none;border:none;color:white;font-size:28px;cursor:pointer;line-height:1;opacity:0.8;">✕</button><video src="${signedUrl}" controls autoplay playsinline style="width:100%;border-radius:12px;max-height:75vh;background:#000;display:block;"></video></div>`
    : `<div style="color:white;font-size:14px;opacity:0.7;">Loading video…</div>`;
  modal.addEventListener('click', e => { if (e.target === modal) _closeVideoModal(); });
  document.body.appendChild(modal);
}

function _closeVideoModal() {
  const modal = document.getElementById('video-playback-modal');
  if (modal) { const video = modal.querySelector('video'); if (video) { video.pause(); video.src = ''; } modal.remove(); }
}

/* ── FIX 2: Photo quality requirements section ────────────
   Billo shows a tips block (lighting, aspect ratio, count)
   ABOVE the upload zone whenever photos_required > 0.
   Renders into #detail-photo-quality-tips, created on demand
   and inserted before the upload zone container.
   ─────────────────────────────────────────────────────────── */
function _renderPhotoQualityTips(photosRequired) {
  // Remove any pre-existing tips block first
  const old = document.getElementById('detail-photo-quality-tips');
  if (old) old.remove();

  const uploadZone = document.getElementById('pitch-upload-section') ||
                     document.querySelector('.photo-upload-zone') ||
                     document.getElementById('detail-photo-section');
  if (!uploadZone || !photosRequired) return;

  const count = typeof photosRequired === 'number' && photosRequired > 1
    ? photosRequired
    : 3; // sensible default when value is truthy but not a specific count

  const tips = document.createElement('div');
  tips.id = 'detail-photo-quality-tips';
  tips.style.cssText = 'margin-bottom:12px;border:1.5px solid var(--border,#EBEBEB);border-radius:16px;overflow:hidden;';
  tips.innerHTML = `
    <div style="padding:12px 16px;border-bottom:1px solid var(--border,#EBEBEB);display:flex;align-items:center;gap:8px;">
      <span style="font-size:16px;">📸</span>
      <span style="font-size:14px;font-weight:700;color:var(--text);">Photo requirements</span>
    </div>
    <div style="padding:12px 16px;display:flex;flex-direction:column;gap:10px;">
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <span style="font-size:16px;flex-shrink:0;">☀️</span>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text);">Lighting</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:2px;">Use natural light or a ring light. Avoid harsh shadows and direct flash.</div>
        </div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <span style="font-size:16px;flex-shrink:0;">📐</span>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text);">Aspect ratio</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:2px;">Shoot in 4:5 portrait (1080×1350 px) or 1:1 square. No letterboxing.</div>
        </div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <span style="font-size:16px;flex-shrink:0;">🔢</span>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--text);">Photo count</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:2px;">Submit exactly <strong>${count}</strong> photo${count !== 1 ? 's' : ''}. All must feature the product clearly.</div>
        </div>
      </div>
    </div>`;
  uploadZone.parentNode.insertBefore(tips, uploadZone);
}

/* ── FIX 3: Scenario type icons ──────────────────────────
   Billo uses distinct icons per scenario type so creators
   immediately identify the video style. Injected next to
   the scenario section heading label.
   ─────────────────────────────────────────────────────── */
const _SCENARIO_ICONS = {
  testimonial: '🗣️',
  unboxing:    '📦',
  lifestyle:   '🌿',
  tutorial:    '🎓',
  demo:        '📱',
  review:      '⭐',
  ugc:         '🎬',
};

function _detectScenarioType(scenario) {
  if (!scenario) return null;
  const lower = scenario.toLowerCase();
  for (const [type, icon] of Object.entries(_SCENARIO_ICONS)) {
    if (lower.includes(type)) return { type, icon };
  }
  return null;
}

function _injectScenarioIcon(scenario) {
  // Find the scenario section heading
  const sectionHeading = document.querySelector(
    '#screen-detail .section-label, #screen-detail .label-sm'
  );
  // More targeted: look for the heading immediately before #detail-scenario-content
  const scenarioContent = document.getElementById('detail-scenario-content');
  if (!scenarioContent) return;

  // Remove any previously injected icon badge
  const prevBadge = document.getElementById('detail-scenario-type-badge');
  if (prevBadge) prevBadge.remove();

  const detected = _detectScenarioType(scenario);
  if (!detected) return;

  const badge = document.createElement('span');
  badge.id = 'detail-scenario-type-badge';
  badge.title = detected.type.charAt(0).toUpperCase() + detected.type.slice(1);
  badge.style.cssText = [
    'display:inline-flex;align-items:center;gap:4px;',
    'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;',
    'color:var(--brand,#6C3EF0);background:var(--brand-soft,#EDE9FE);',
    'border-radius:20px;padding:3px 10px;margin-left:8px;vertical-align:middle;',
  ].join('');
  badge.innerHTML = `${detected.icon} ${detected.type}`;

  // Walk up from scenarioContent to find the nearest section heading sibling
  let heading = scenarioContent.previousElementSibling;
  while (heading && heading.tagName === 'DIV' && !heading.classList.contains('section-label') && !heading.classList.contains('label-sm')) {
    heading = heading.previousElementSibling;
  }
  if (heading) {
    heading.appendChild(badge);
  } else {
    // Fallback: inject inline at the top of the content block
    scenarioContent.prepend(badge);
  }
}

/* ── FIX 4 + FIX 1: Legacy showDetail with nav-stack push
   and calcMatchScore display ───────────────────────────────
   FIX 4: Push the originating screen onto _navStack BEFORE
   switching to screen-detail so goBack() returns to the
   correct place. Previously showDetail() did not push at all.
   ─────────────────────────────────────────────────────────── */
function showDetail(campaign) {
  // FIX 4 — push current screen before navigating
  const fromScreen = (typeof _activeScreenId === 'function' && _activeScreenId()) || currentTab || 'tasks';
  window._navStack = window._navStack || [];
  window._navStack.push(fromScreen);

  previousTab = currentTab;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('screen-detail').classList.add('active');

  const campaigns = {
    java:   { title:'Tim Hortons – Lifestyle Coffee Reel',   desc:'Capture the Tim Hortons experience — the aroma, the ambiance, the community. Create a 30-second lifestyle reel that makes viewers crave their next cup of Java.' },
    rogers: { title:'Rogers – Mobile App Demo 30s',          desc:'Show how easy and convenient it is to use the Rogers app for everyday transactions. Keep it clear, confident, and relatable to everyday Canadians.' },
    pitch:  { title:'Upload your video pitch',               desc:"Ready for your first video on the Vyralist journey? Check out the requirements below to showcase your skills and let brands see what you're capable of!" },
  };

  const c = campaigns[campaign] || campaigns.pitch;
  const isPitch = campaign === 'pitch';
  const tc = window.TASK_CAMPAIGNS?.[campaign] || null;

  document.getElementById('detail-title').textContent = c.title;
  const pitchDescEl = document.getElementById('detail-pitch-desc');
  if (pitchDescEl) pitchDescEl.textContent = c.desc;

  // Set hero background image
  const heroBg = document.querySelector('#screen-detail .detail-hero-bg');
  if (heroBg) {
    if (isPitch) {
      heroBg.style.height = '220px';
      heroBg.style.background = 'none';
      heroBg.innerHTML = `
        <img src="https://images.pexels.com/photos/7676409/pexels-photo-7676409.jpeg?auto=compress&cs=tinysrgb&w=800"
          alt="Creator recording video"
          style="width:100%;height:100%;object-fit:cover;display:block;border-radius:0;" />
        <div class="detail-logo"></div>`;
    } else {
      heroBg.style.height = '';
      heroBg.style.background = '';
      heroBg.innerHTML = `<div class="detail-logo"></div>`;
    }
  }

  const logoEl = document.querySelector('#screen-detail .detail-logo');
  if (logoEl) {
    logoEl.innerHTML = '';
    if (!isPitch) {
      const initialsMap = { java: 'TH', rogers: 'RG' };
      logoEl.textContent = initialsMap[campaign] || '';
    }
  }

  const productSection      = document.getElementById('detail-product-section');
  const pitchProductSection = document.getElementById('detail-pitch-product-section');
  if (productSection)      productSection.style.display      = isPitch ? 'none'  : 'block';
  if (pitchProductSection) pitchProductSection.style.display = isPitch ? 'block' : 'none';

  const exampleSection = document.getElementById('example-videos-section');
  const uploadSection  = document.getElementById('pitch-upload-section');

  // Merge module-level flag with window flag set by _restorePitchPending (app.js)
  const isPitchPending = pitchSubmitted || !!window._pitchSubmitted;
  const isPitchDenied  = window._pitchStatus === 'denied';
  const isPitchApproved = window._pitchStatus === 'approved';
  const showBanner = isPitchPending || isPitchDenied || isPitchApproved;

  if (exampleSection) exampleSection.style.display = isPitch ? 'block' : 'none';
  // Hide upload section when pitch already submitted/pending/denied/approved
  if (uploadSection)  uploadSection.style.display  = (isPitch && !showBanner) ? 'block' : 'none';

  const pendingBanner = document.getElementById('pitch-pending-banner');
  if (pendingBanner) pendingBanner.style.display = (isPitch && showBanner) ? 'flex' : 'none';

  const ctaBtn = document.getElementById('detail-cta-btn');
  if (ctaBtn) {
    ctaBtn.style.display = '';
    if (isPitch && (isPitchPending || isPitchDenied || isPitchApproved)) { ctaBtn.style.display = 'none'; }
    else if (isPitch) { ctaBtn.textContent = 'Submit pitch'; ctaBtn.onclick = handleDetailCta; }
    else { ctaBtn.textContent = 'Apply'; ctaBtn.onclick = handleDetailCta; }
  }

  // FIX 2 — photo quality tips for legacy campaigns
  if (tc) {
    const photoSec = document.getElementById('detail-photo-section');
    if (photoSec) photoSec.style.display = tc.photos_required ? 'block' : 'none';
    _renderPhotoQualityTips(tc.photos_required);
  }

  // FIX 3 — scenario icon for legacy campaign scenario text
  _injectScenarioIcon(c.desc);
}

/* ── FIX 6: renderOnboardSlide — programmatic dot sync ──────
   The original implementation in nav.js only toggled slide
   visibility and the back-button, but never updated the dot
   indicators. Dots were hardcoded with `active` in HTML and
   never changed. This function is called AFTER nav.js's
   renderOnboardSlide so the dots always reflect idx.

   Override strategy: wrap the nav.js implementation so the
   dot sync runs on every call without duplicating slide logic.
   ─────────────────────────────────────────────────────────── */
(function _patchRenderOnboardSlide() {
  // Wait until nav.js has defined renderOnboardSlide
  const _original = window.renderOnboardSlide;

  window.renderOnboardSlide = function(idx) {
    // Call the original nav.js implementation first
    if (typeof _original === 'function') _original(idx);

    // Now sync dots programmatically across ALL slide panels
    // Each slide has its own .onboard-dots container; update the
    // active class in the currently VISIBLE slide only.
    const activeSlide = document.getElementById('onboard-slide-' + idx);
    if (!activeSlide) return;
    const dots = activeSlide.querySelectorAll('.onboard-dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === idx);
    });
  };
})();
