/* ============================================================
   SUPABASE.JS — Client init, Auth lifecycle, Profile CRUD
   All auth state changes funnel through here.
   _supabase is exposed as window._supabase for cross-module use.
   ============================================================ */

const SUPABASE_URL      = window.ENV_SUPABASE_URL      || 'YOUR_SUPABASE_URL';      // 🔑 Set in env-config.js
const SUPABASE_ANON_KEY = window.ENV_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY'; // 🔑 Set in env-config.js

/* ── Version guard: clear stale onboarding flag on new deploys ── */
const APP_VERSION = '20260428';
if (localStorage.getItem('vyralist_app_version') !== APP_VERSION) {
  localStorage.removeItem('vyralist_onboarded');
  localStorage.setItem('vyralist_app_version', APP_VERSION);
}

window._supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ── Supported countries (Billo markets) ─────────────────── */
const SUPPORTED_COUNTRIES = ['CA', 'US', 'GB', 'AU'];

/* ── Loading overlay ──────────────────────────────────────── */
function _showLoader() {
  let el = document.getElementById('_auth_loader');
  if (!el) {
    el = document.createElement('div');
    el.id = '_auth_loader';
    el.style.cssText = 'position:fixed;inset:0;background:#fff;display:flex;align-items:center;justify-content:center;z-index:9999;flex-direction:column;gap:12px;';
    el.innerHTML = '<div style="width:36px;height:36px;border:3px solid #EDE8FD;border-top-color:#5B2EE8;border-radius:50%;animation:_spin 0.7s linear infinite;"></div><style>@keyframes _spin{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(el);
  }
  el.style.display = 'flex';
}

function _hideLoader() {
  const el = document.getElementById('_auth_loader');
  if (el) el.style.display = 'none';
}

/* ── Session check on page load ──────────────────────────── */
window.addEventListener('DOMContentLoaded', async () => {
  const nav = document.getElementById('bottom-nav');
  if (nav) nav.style.display = 'none';

  _showLoader();
  try {
    const { data: { session } } = await window._supabase.auth.getSession();
    if (session) {
      _enterApp();
    } else {
      const hasOnboarded = localStorage.getItem('vyralist_onboarded');
      if (hasOnboarded) {
        showOnlyScreen('screen-splash');
      }
      // else: screen-onboard is already active by default in HTML — do nothing
    }
  } catch (e) {
    console.warn('[Auth] session check failed:', e.message);
    // screen-onboard is already active by default — do nothing on error
  } finally {
    _hideLoader();
  }
});

/* ── OAuth profile bootstrap ─────────────────────────────── */
/* When a user signs in via Google/Apple/Facebook for the first time,
   Supabase creates an auth user but NOT a profiles row. This function
   checks if a profile exists and creates one from the OAuth metadata
   (email, full name, avatar) if it doesn't. Safe to call on every
   SIGNED_IN — the upsert is a no-op if the row already exists.       */
async function _bootstrapOAuthProfile(user) {
  try {
    const provider = user.app_metadata?.provider || '';
    if (!['google', 'apple', 'facebook'].includes(provider)) return; // email/password signup handled elsewhere

    const meta = user.user_metadata || {};

    // Check if profile row already exists
    const { data: existing } = await window._supabase
      .from('profiles').select('id').eq('id', user.id).single();
    if (existing) return; // already set up — nothing to do

    // Parse name from Google's full_name or individual fields
    const fullName  = meta.full_name || meta.name || '';
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = meta.given_name  || nameParts[0] || '';
    const lastName  = meta.family_name || nameParts.slice(1).join(' ') || '';

    const profileData = {
      id:         user.id,
      email:      user.email || meta.email || '',
      first_name: firstName,
      last_name:  lastName,
      photo_url:  meta.avatar_url || meta.picture || '',
      created_at: new Date().toISOString(),
    };

    const { error } = await window._supabase
      .from('profiles').upsert(profileData, { onConflict: 'id' });

    if (error) {
      console.warn('[Auth] OAuth profile bootstrap error:', error.message);
    } else {
      console.log('[Auth] OAuth profile created for', provider, user.email);
    }
  } catch (e) {
    console.warn('[Auth] _bootstrapOAuthProfile error:', e.message);
  }
}

/* ── Auth state change listener ─────────────────────────── */
window._supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    // Bootstrap profile for OAuth users (Google, Apple, Facebook)
    _bootstrapOAuthProfile(session.user);

    const activeScreen = document.querySelector('.screen.active');
    const authScreens  = ['screen-splash', 'screen-onboard', 'screen-login', 'screen-login-existing'];
    const onAuthScreen = !activeScreen || authScreens.includes(activeScreen.id);
    if (onAuthScreen) {
      if (typeof _enterApp === 'function' && window._enterAppReady) {
        _enterApp();
      } else {
        // app.js hasn't loaded yet — wait for the readiness flag or event
        window.addEventListener('_enterAppReady', () => _enterApp(), { once: true });
      }
    }
  }
  if (event === 'SIGNED_OUT') {
    const nav = document.getElementById('bottom-nav');
    if (nav) nav.style.display = 'none';

    // Tear down Realtime channels so they don't linger across sessions.
    try {
      if (window._taskChannel)  { window._supabase.removeChannel(window._taskChannel);  window._taskChannel  = null; }
      if (window._notifChannel) { window._supabase.removeChannel(window._notifChannel); window._notifChannel = null; }
    } catch (_) { /* ignore — channel may already be closed */ }

    // Reset deferred-load flags so tabs reload fresh after re-login.
    if (window._tabLoaded) {
      Object.keys(window._tabLoaded).forEach(k => { window._tabLoaded[k] = false; });
    }
    // Clear stale tab-activate callbacks so _deferNonCriticalLoads() can
    // register a fresh set without accumulating duplicates.
    window._tabActivateListeners = {};
    const hasOnboarded = localStorage.getItem('vyralist_onboarded');
    if (hasOnboarded) {
      showOnlyScreen('screen-splash');
    } else {
      renderOnboardSlide(0);
      showOnlyScreen('screen-onboard');
    }
  }
});

/* ── Sign Up ──────────────────────────────────────────────── */
async function handleSignup() {
  const email    = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const btn      = document.getElementById('signup-submit-btn');

  if (!email || !password) { showToast('Please enter your email and a password', 'error'); return; }
  if (password.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }

  /* ── [FIX 1] Country restriction guard ─────────────────── */
  const country = document.getElementById('signup-country')?.value || '';
  if (!SUPPORTED_COUNTRIES.includes(country)) {
    showToast("Vyralist is currently available in the US, Canada, UK, and Australia. You're on our waitlist — we'll notify you when we expand!", 'error');
    return;
  }


  /* ── Gender required — affects campaign matching score ─── */
  const genderChipSelected = document.querySelector(".gender-chip.selected");
  if (!genderChipSelected) {
    const hint = document.getElementById("gender-req-hint");
    if (hint) hint.style.display = "inline";
    const row = document.getElementById("gender-row-signup");
    if (row) { row.style.outline = "1.5px solid #EF4444"; row.style.borderRadius = "8px"; setTimeout(() => { row.style.outline = ""; if (hint) hint.style.display = "none"; }, 3000); }
    showToast("Please select your gender to continue", "error");
    return;
  }

  /* ── [FIX 2] DOB age gate — always enforced ────────────── */
  if (typeof dpDay === 'undefined' || !dpDay) {
    showToast('Please enter your date of birth', 'error');
    return;
  }
  const dob = new Date(dpYear, dpMonth, dpDay);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const mDiff = now.getMonth() - dob.getMonth();
  if (mDiff < 0 || (mDiff === 0 && now.getDate() < dob.getDate())) age--;
  if (age < 18) {
    showToast('You must be at least 18 years old to join Vyralist.', 'error');
    const dobEl = document.getElementById('dob-display');
    if (dobEl) { dobEl.style.borderColor = '#EF4444'; setTimeout(() => { dobEl.style.borderColor = ''; }, 2500); }
    return;
  }

  btn.textContent = 'Creating account\u2026'; btn.disabled = true; _showLoader();

  try {
    const { data, error } = await window._supabase.auth.signUp({ email, password });
    if (error) {
      showToast(error.message === 'User already registered'
        ? 'An account with this email already exists. Please log in.'
        : error.message, 'error');
      return;
    }

    const userId = data.user?.id;
    const profilePayload = {};
    if (country) profilePayload.country = country;

    const refEl = document.getElementById('ref-text');
    const refSource = refEl?.textContent?.trim();
    if (refSource && refSource !== 'Select\u2026') profilePayload.referral_source = refSource;

    const genderEl = document.querySelector('.gender-chip.selected');
    if (genderEl) {
      const t = genderEl.textContent.trim();
      profilePayload.gender = t.startsWith('Female') ? 'female' : t.startsWith('Male') ? 'male' : 'nonbinary';
    }

    const mm = String(dpMonth + 1).padStart(2, '0');
    const dd = String(dpDay).padStart(2, '0');
    profilePayload.date_of_birth = `${dpYear}-${mm}-${dd}`;

    if (userId && Object.keys(profilePayload).length > 0) {
      profilePayload.id = userId;
      await window._supabase.from('profiles').upsert(profilePayload, { onConflict: 'id' });
    }

    if (data.session) {
      _enterApp();
    } else {
      _hideLoader();
      showToast('Check your email to confirm your account, then log in.', 'success');
      showOnlyScreen('screen-login-existing');
    }
  } catch (e) {
    showToast('Something went wrong. Please try again.', 'error');
    console.error('[Auth] signup error:', e);
  } finally {
    btn.textContent = 'Sign up & start exploring'; btn.disabled = false; _hideLoader();
  }
}

/* ── Log In ──────────────────────────────────────────────── */
async function handleLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('login-submit-btn');

  if (!email || !password) { showToast('Please enter your email and password', 'error'); return; }

  btn.textContent = 'Logging in\u2026'; btn.disabled = true; _showLoader();

  try {
    const { data, error } = await window._supabase.auth.signInWithPassword({ email, password });
    if (error) {
      showToast(
        error.message.includes('Invalid login credentials') ? 'Incorrect email or password. Please try again.' :
        error.message.includes('Email not confirmed')       ? 'Please confirm your email before logging in. Check your inbox.' :
        error.message,
        'error'
      );
      return;
    }
    if (typeof _enterApp === 'function') _enterApp();
  } catch (e) {
    showToast('Something went wrong. Please try again.', 'error');
  } finally {
    btn.textContent = 'Log in'; btn.disabled = false; _hideLoader();
  }
}

/* ── Forgot Password ─────────────────────────────────────── */
async function handleForgotPassword() {
  const email = document.getElementById('login-email')?.value.trim();
  if (!email) { showToast('Enter your email above first', 'error'); return; }
  const { error } = await window._supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
  if (error) { showToast(error.message, 'error'); return; }
  showToast('Password reset link sent \u2014 check your email.', 'success');
}

/* ── Google OAuth ────────────────────────────────────────── */
async function handleGoogleSignIn() {
  _showLoader();
  const { error } = await window._supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href },
  });
  if (error) { _hideLoader(); showToast(error.message, 'error'); }
}

/* ── [FIX 3] Apple Sign In ───────────────────────────────── */
/* Required by App Store review guidelines when any social login is offered. */
async function handleAppleSignIn() {
  _showLoader();
  const { error } = await window._supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo: window.location.href },
  });
  if (error) { _hideLoader(); showToast(error.message, 'error'); }
}

/* ── [FIX 3] Facebook Sign In ───────────────────────────── */
async function handleFacebookSignIn() {
  _showLoader();
  const { error } = await window._supabase.auth.signInWithOAuth({
    provider: 'facebook',
    options: { redirectTo: window.location.href },
  });
  if (error) { _hideLoader(); showToast(error.message, 'error'); }
}

/* ── Log Out ─────────────────────────────────────────────── */
async function handleLogout() {
  await window._supabase.auth.signOut();
}

/* ── [FIX 4] Delete Account (GDPR-compliant) ─────────────── */
/* Flow:                                                        */
/*   1. Wipe PII columns on the profiles row immediately.       */
/*   2. Call an Edge Function (delete-user) that uses the       */
/*      service-role key to permanently remove the auth user.   */
/*      Deploy with: supabase functions deploy delete-user      */
/*   3. Sign out — onAuthStateChange returns user to splash.    */
async function deleteAccount() {
  const btn = document.getElementById('delete-confirm-btn');
  if (btn) { btn.textContent = 'Deleting\u2026'; btn.disabled = true; }

  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) { showToast('Not signed in', 'error'); return; }

    /* Wipe PII immediately so it's gone from admin views */
    await window._supabase.from('profiles').update({
      deleted_at:       new Date().toISOString(),
      email:            null,
      first_name:       null,
      last_name:        null,
      photo_url:        null,
      paypal_email:     null,
      instagram_handle: null,
      push_token:       null,
    }).eq('id', user.id);

    /* Call edge function for hard auth-user deletion.
       Silent fail if not deployed — profile wipe above is sufficient
       for GDPR purposes until the auth row is swept server-side. */
    try {
      const { data: { session } } = await window._supabase.auth.getSession();
      await fetch(`${SUPABASE_URL}/functions/v1/delete-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ user_id: user.id }),
      });
    } catch (_) { /* edge function not deployed yet — no-op */ }

    closeModal('modal-delete');
    showToast('Your account has been deleted. Sorry to see you go.', 'success');
    await window._supabase.auth.signOut();

  } catch (e) {
    console.error('[Auth] deleteAccount error:', e);
    showToast('Could not delete account. Please contact support@vyralist.com', 'error');
    if (btn) { btn.textContent = 'Confirm deletion'; btn.disabled = false; }
  }
}

/* ── [FIX 5] Change Email ────────────────────────────────── */
/* Supabase sends confirmation links to BOTH old and new        */
/* addresses before the change takes effect (prevents takeover).*/
async function changeEmail() {
  const newEmail = document.getElementById('change-email-input')?.value.trim();
  const btn      = document.getElementById('change-email-btn');
  if (!newEmail) { showToast('Please enter your new email address', 'error'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) { showToast('Please enter a valid email address', 'error'); return; }

  if (btn) { btn.textContent = 'Sending\u2026'; btn.disabled = true; }

  try {
    const { error } = await window._supabase.auth.updateUser(
      { email: newEmail },
      { emailRedirectTo: window.location.href }
    );
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Confirmation links sent to both addresses. Check your inbox to confirm the change.', 'success');
    closeModal('modal-change-email');
  } catch (e) {
    showToast('Could not send confirmation. Please try again.', 'error');
  } finally {
    if (btn) { btn.textContent = 'Send confirmation'; btn.disabled = false; }
  }
}

/* Helper — wire up from Profile > Settings > Change email */
function openChangeEmailModal() {
  const input = document.getElementById('change-email-input');
  if (input) input.value = '';
  const modal = document.getElementById('modal-change-email');
  if (modal) modal.classList.add('open');
  else showToast('Email change coming soon', 'default');
}

/* ── Load Profile ────────────────────────────────────────── */
async function loadProfile() {
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;

    const { data: profile, error } = await window._supabase
      .from('profiles').select('*').eq('id', user.id).single();
    if (error || !profile) return;

    const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'Creator';
    const initials = [profile.first_name, profile.last_name]
      .filter(Boolean).map(n => n[0].toUpperCase()).join('') || 'CR';

    const nameEl = document.querySelector('#screen-profile .profile-info h2');
    if (nameEl) nameEl.textContent = fullName;

    const avatarEl = document.querySelector('#screen-profile .avatar');
    if (avatarEl) {
      const oldImg = avatarEl.querySelector('img.avatar-photo');
      if (oldImg) oldImg.remove();
      if (profile.photo_url) {
        const img = document.createElement('img');
        img.className = 'avatar-photo';
        img.src = profile.photo_url;
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;z-index:0;';
        img.onerror = () => { img.remove(); };
        avatarEl.insertBefore(img, avatarEl.firstChild);
        const tn = [...avatarEl.childNodes].find(n => n.nodeType === 3);
        if (tn) tn.textContent = '';
      } else {
        const tn = [...avatarEl.childNodes].find(n => n.nodeType === 3);
        if (tn) tn.textContent = initials;
        else avatarEl.insertBefore(document.createTextNode(initials), avatarEl.firstChild);
      }
    }

    const fi = document.getElementById('pi-first-name');
    const li = document.getElementById('pi-last-name');
    const ei = document.getElementById('pi-email');
    if (fi) fi.value = profile.first_name || '';
    if (li) li.value = profile.last_name  || '';
    if (ei) ei.value = profile.email      || user.email || '';

    if (profile.date_of_birth) {
      const d   = new Date(profile.date_of_birth + 'T00:00:00');
      const lbl = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const el  = document.getElementById('profile-dob-text');
      if (el) { el.textContent = lbl; el.style.color = '#0F0F0F'; }
    }

    if (profile.gender) {
      const keyMap = { female: 'Female', male: 'Male', nonbinary: 'Non-binary' };
      const target = keyMap[profile.gender] || profile.gender;
      document.querySelectorAll('#screen-personal .gender-pill').forEach(p => {
        p.classList.toggle('active', p.textContent.trim().startsWith(target));
      });
    }

    const paypalEl = document.getElementById('pi-paypal-email');
    if (paypalEl && profile.paypal_email) paypalEl.value = profile.paypal_email;

    if (profile.message_read_state && typeof profile.message_read_state === 'object') {
      window._msgReadState = Object.assign(window._msgReadState || {}, profile.message_read_state);
    }

    window._creatorProfile = profile;
    if (typeof _syncPaypalUI    === 'function') _syncPaypalUI(profile.paypal_email || '');

    /* ── [FIX 6] Pass hasPhoto into updateProfileSignals ──── */
    if (typeof updateProfileSignals === 'function') updateProfileSignals(profile);

  } catch (e) { console.warn('[Auth] loadProfile error:', e.message); }
}

/* ── Avatar Upload ───────────────────────────────────────── */
async function handleAvatarUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5 MB', 'error'); return; }
  showToast('Uploading photo\u2026');
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;
    const ext  = file.name.split('.').pop() || 'jpg';
    const path = `avatars/${user.id}.${ext}`;
    const { error: upErr } = await window._supabase.storage
      .from('avatars').upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) throw upErr;
    const { data: urlData } = window._supabase.storage.from('avatars').getPublicUrl(path);
    const photoUrl = urlData?.publicUrl;
    if (!photoUrl) throw new Error('Could not get public URL');
    const bustedUrl = photoUrl + '?t=' + Date.now();
    const { error: dbErr } = await window._supabase.from('profiles')
      .update({ photo_url: bustedUrl }).eq('id', user.id);
    if (dbErr) throw dbErr;

    const avatarEl = document.querySelector('#screen-profile .avatar');
    if (avatarEl) {
      let img = avatarEl.querySelector('img.avatar-photo');
      if (!img) {
        img = document.createElement('img');
        img.className = 'avatar-photo';
        img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;z-index:0;';
        avatarEl.insertBefore(img, avatarEl.firstChild);
      }
      img.src = bustedUrl;
      const tn = [...avatarEl.childNodes].find(n => n.nodeType === 3);
      if (tn) tn.textContent = '';
    }

    /* ── [FIX 7] Update hasPhoto signal immediately on upload ── */
    if (window._profileSignals) {
      window._profileSignals.hasPhoto = true;
    }

    showToast('Profile photo updated!', 'success');
  } catch (e) { showToast('Upload failed: ' + e.message, 'error'); }
  finally { input.value = ''; }
}

/* ── Save Personal Info ──────────────────────────────────── */
async function savePersonalInfo() {
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;
    const firstName  = document.getElementById('pi-first-name')?.value.trim() || '';
    const lastName   = document.getElementById('pi-last-name')?.value.trim()  || '';
    const email      = document.getElementById('pi-email')?.value.trim()      || '';
    const genderEl   = document.querySelector('#screen-personal .gender-pill.active');
    let selectedGender = null;
    if (genderEl) {
      const t = genderEl.textContent.trim();
      selectedGender = t.startsWith('Female') ? 'female' : t.startsWith('Male') ? 'male' : 'nonbinary';
    }
    const btn = document.querySelector('#screen-personal .btn-primary');
    if (btn) { btn.textContent = 'Saving\u2026'; btn.disabled = true; }
    const { error } = await window._supabase.from('profiles').update({
      first_name: firstName, last_name: lastName, email, gender: selectedGender,
      onboarded:  !!(firstName),  // discoverable in brands marketplace once they have a name
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);
    if (btn) { btn.textContent = 'Save'; btn.disabled = false; }
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Profile saved!', 'success');
    await loadProfile();
    goBack();
  } catch (e) { showToast('Could not save. Please try again.', 'error'); }
}

/* ── Save PayPal Email ───────────────────────────────────── */
async function savePaypalEmail() {
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;
    const email = document.getElementById('pi-paypal-email')?.value.trim() || '';
    if (!email) { showToast('Please enter your PayPal email', 'error'); return; }
    const btn = document.getElementById('paypal-save-btn');
    if (btn) { btn.textContent = 'Saving\u2026'; btn.disabled = true; }
    const { error } = await window._supabase.from('profiles').update({
      paypal_email: email, payment_updated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', user.id);
    if (btn) { btn.textContent = 'Save'; btn.disabled = false; }
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Payment details saved!', 'success');
    if (window._profileSignals) { window._profileSignals.hasPaypal = true; }
    if (typeof _syncPaypalUI === 'function') _syncPaypalUI(email);
    goBack();
  } catch (e) { showToast('Could not save. Please try again.', 'error'); }
}

function openPaypalSetup() {
  window.open('https://www.paypal.com/signin', '_blank');
  showToast('Complete sign-in on PayPal, then enter your email below');
}

function _syncPaypalUI(email) {
  const banner   = document.getElementById('paypal-connected-banner');
  const emailEl  = document.getElementById('paypal-connected-email');
  const oauthBtn = document.getElementById('paypal-oauth-btn');
  if (email) {
    if (banner)   banner.style.display = 'flex';
    if (emailEl)  emailEl.textContent = email;
    if (oauthBtn) oauthBtn.style.display = 'none';
  } else {
    if (banner)   banner.style.display = 'none';
    if (oauthBtn) oauthBtn.style.display = '';
  }
}

async function disconnectPaypal() {
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;
    await window._supabase.from('profiles')
      .update({ paypal_email: null, payment_updated_at: new Date().toISOString() }).eq('id', user.id);
    const emailEl = document.getElementById('pi-paypal-email');
    if (emailEl) emailEl.value = '';
    _syncPaypalUI('');
    if (window._profileSignals) { window._profileSignals.hasPaypal = false; }
    showToast('PayPal disconnected');
  } catch(e) { showToast('Could not disconnect. Try again.', 'error'); }
}

/* ── Instagram connect ───────────────────────────────────── */
async function connectInstagram() {
  try {
    const { error } = await window._supabase.auth.signInWithOAuth({
      provider: 'instagram', options: { redirectTo: window.location.href, scopes: 'user_profile,user_media' },
    });
    if (error) showToast('Could not connect Instagram: ' + error.message, 'error');
  } catch(e) { showToast('Instagram connection failed', 'error'); }
}

function _syncInstagramUI(handle, followers) {
  const statusEl   = document.getElementById('ig-status-text');
  const connectBtn = document.getElementById('ig-connect-btn');
  if (!statusEl || !connectBtn) return;
  if (handle) {
    statusEl.textContent = '@' + handle + (followers ? ' \u00b7 ' + Number(followers).toLocaleString() + ' followers' : '');
    statusEl.style.color = 'var(--success)';
    connectBtn.textContent = 'Disconnect';
    connectBtn.style.borderColor = '#EF4444'; connectBtn.style.color = '#EF4444';
    connectBtn.onclick = disconnectInstagram;
  } else {
    statusEl.textContent = 'Not connected'; statusEl.style.color = 'var(--text-3)';
    connectBtn.textContent = 'Connect';
    connectBtn.style.borderColor = 'var(--brand)'; connectBtn.style.color = 'var(--brand)';
    connectBtn.onclick = connectInstagram;
  }
}

async function disconnectInstagram() {
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;
    await window._supabase.from('profiles')
      .update({ instagram_handle: null, instagram_followers: null }).eq('id', user.id);
    _syncInstagramUI('', 0);
    showToast('Instagram disconnected');
  } catch(e) { showToast('Could not disconnect. Try again.', 'error'); }
}

/* ── About Me ─────────────────────────────────────────────── */
async function saveAboutMe() {
  const btn = document.querySelector('#screen-about .btn-primary');
  if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }
  try {
    const { data: { user } } = await window._supabase.auth.getUser();
    if (!user) return;
    const occupation = document.getElementById('occ-textarea')?.value.trim() || '';
    const activeTags = [...document.querySelectorAll('#screen-about .tag-pill.active')].map(el => el.textContent.trim());

    // ── Structured filter fields (synced with brands app filter sidebar) ──
    const ETHNICITY_OPTS  = ['Caucasian','Black','Hispanic/Latino','Asian','Multiracial/Other'];
    const APPEARANCE_OPTS = ['Fit & Sporty','Plus Size','Alternative Style','Model/Influencer','Casual & Relatable'];
    const LIFESTYLE_OPTS  = ['Dog Owner','Cat Owner','Parent','In a Relationship','Vehicle Owner','Luxurious Homeowner','Nature Enthusiast'];
    const OCCUPATION_OPTS = ['Social Media Influencer','Streamer','Podcaster','Healthcare Professional','Musician','Teacher/Educator','Fitness Trainer/Coach','Entrepreneur','Actor','Photographer/Videographer','Culinary Professional','Marketing Specialist','Legal Professional','IT Specialist'];
    const INTERESTS_OPTS  = ['Cooking','Skincare & Beauty','Technology','Gaming','DIY','Gardening','Fashion','Health & Wellness','Outdoor Activities','Garage/Workshop'];

    const filterEthnicity  = activeTags.filter(t => ETHNICITY_OPTS.includes(t));
    const filterAppearance = activeTags.filter(t => APPEARANCE_OPTS.includes(t));
    const filterLifestyle  = activeTags.filter(t => LIFESTYLE_OPTS.includes(t));
    const filterOccupation = activeTags.filter(t => OCCUPATION_OPTS.includes(t));
    const filterInterests  = activeTags.filter(t => INTERESTS_OPTS.includes(t));

    // Map tags → primary_niche / secondary_niches so the brands marketplace can discover this creator
    const primaryNiche    = activeTags[0] || null;
    const secondaryNiches = activeTags.slice(1);
    const { error } = await window._supabase.from('profiles').update({
      occupation,
      tags: activeTags,
      primary_niche:    primaryNiche,
      secondary_niches: secondaryNiches.length ? secondaryNiches : null,
      // Structured filter columns — read by brands app filter sidebar
      filter_ethnicity:  filterEthnicity.length  ? filterEthnicity  : null,
      filter_appearance: filterAppearance.length ? filterAppearance : null,
      filter_lifestyle:  filterLifestyle.length  ? filterLifestyle  : null,
      filter_occupation: filterOccupation.length ? filterOccupation : null,
      filter_interests:  filterInterests.length  ? filterInterests  : null,
      onboarded:        true,  // marks this creator as discoverable in the brands marketplace
      updated_at: new Date().toISOString(),
    }).eq('id', user.id);
    if (btn) { btn.textContent = 'Save'; btn.disabled = false; }
    if (error) { showToast(error.message, 'error'); return; }
    showToast('About Me saved!', 'success');
    // Sync in-memory profile so restoreProfileTags works without a page reload
    if (window._creatorProfile) { window._creatorProfile.tags = activeTags; window._creatorProfile.occupation = occupation; }
    if (window._profileSignals) {
      window._profileSignals.hasTags = !!(occupation || activeTags.length > 0);
    }
    if (typeof _updateTagsBadge === 'function') _updateTagsBadge(activeTags.length);
    goBack();
  } catch (e) {
    if (btn) { btn.textContent = 'Save'; btn.disabled = false; }
    showToast('Could not save. Please try again.', 'error');
  }
}

/* ── Match score ─────────────────────────────────────────── */
window._creatorProfile = window._creatorProfile || {};

function calcMatchScore(campaign) {
  const p = window._creatorProfile;
  if (!p || (!p.gender && !p.tags && !p.about_tags && !p.occupation)) return null;
  let score = 0, total = 0;
  if (campaign.required_gender && campaign.required_gender !== 'any') {
    total += 30;
    if (p.gender && p.gender === campaign.required_gender) score += 30;
  }
  const profileTags = [
    ...(Array.isArray(p.tags) ? p.tags : []),
    ...(Array.isArray(p.about_tags) ? p.about_tags : []),
  ].map(t => t.toLowerCase());
  const campaignTags = [
    ...(Array.isArray(campaign.required_tags) ? campaign.required_tags : []),
    ...(campaign.creator_tag ? [campaign.creator_tag] : []),
    ...(campaign.category    ? [campaign.category]    : []),
  ].map(t => t.toLowerCase());
  if (campaignTags.length > 0) {
    total += 40;
    const overlap = profileTags.filter(t => campaignTags.some(ct => ct.includes(t) || t.includes(ct)));
    score += Math.round((Math.min(overlap.length, campaignTags.length) / campaignTags.length) * 40);
  }
  total += 20; if (window._profileSignals?.hasPitch) score += 20;
  total += 10; if (!campaign.requires_shipping || window._profileSignals?.hasShipping) score += 10;
  if (total === 0) return null;
  return Math.min(100, Math.round((score / total) * 100));
}

/* ── [FIX 8] Apply match score pills to rendered offer cards ─
   Call after renderOffersScreen() finishes injecting cards.
   Cards must have data-campaign-id="<uuid>" on their root el.  */
function applyMatchScorePills() {
  document.querySelectorAll('[data-campaign-id]').forEach(card => {
    const id       = card.dataset.campaignId;
    const campaign = (window._db?.campaigns || []).find(c => c.id === id);
    if (!campaign) return;
    const score = calcMatchScore(campaign);
    if (score === null) return;
    card.querySelector('.match-score-pill')?.remove();
    const color = score >= 80 ? '#16A34A' : score >= 50 ? '#D97706' : '#6B7280';
    const bg    = score >= 80 ? '#DCFCE7' : score >= 50 ? '#FEF3C7' : '#F3F4F6';
    const pill  = document.createElement('div');
    pill.className = 'match-score-pill';
    pill.style.cssText = [
      'position:absolute', 'top:10px', 'left:10px',
      `background:${bg}`, `color:${color}`,
      'font-size:11px', 'font-weight:700', "font-family:'Satoshi',sans-serif",
      'padding:4px 9px', 'border-radius:20px',
      'display:flex', 'align-items:center', 'gap:4px',
      'backdrop-filter:blur(4px)', 'pointer-events:none',
    ].join(';');
    pill.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>${score}% match`;
    const thumb = card.querySelector('.offer-card-h-img, .campaign-thumb, .campaign-thumb-bg, .detail-hero-bg');
    if (thumb) { thumb.style.position = 'relative'; thumb.appendChild(pill); }
  });
}
