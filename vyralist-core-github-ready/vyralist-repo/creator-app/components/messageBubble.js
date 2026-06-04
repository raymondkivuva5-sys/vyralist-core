/* ============================================================
   MESSAGEBUBBLE.JS — Chat system: thread list, bubble render,
   XSS-safe _esc helper, send, and context menu.

   Features added vs. original:
   ✅ loadConversation(threadId)  — replaces mock CHAT_DATA
   ✅ sendChatMessage() persistence — writes to Supabase + updates last_message
   ✅ Read receipts  — single tick (sent) → double tick (read by brand)
   ✅ Typing indicator — "Brand is typing…" dot animation
   ✅ File/image attachment — image picker → upload to Storage → message row
   ✅ Brand unresponsive CTA — 48 h timer surfaces "Contact support"
   ============================================================ */

/* ── HTML escape — prevents XSS in all innerHTML paths ───── */
function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Thread cache (populated from DB) ────────────────────── */
let chatPreviousScreen = 'messages';

/* Live data from Supabase — keyed by conversation id */
window._chatThreads    = [];   // [{id, brand_name, brand_initials, brand_gradient, last_message, last_message_at, task_id, task_status}]
window._chatMessages   = {};   // { conversationId: [ {id, sender, text, image_url, created_at, read_by_brand} ] }
window._chatChannel    = null; // active realtime subscription
window._typingChannel  = null; // realtime presence channel for typing
window._isTypingTimer  = null; // debounce handle for hiding typing indicator

/* ── CSS injected once for typing bubble & read ticks ─────── */
(function _injectChatStyles() {
  if (document.getElementById('_chatExtraStyles')) return;
  const s = document.createElement('style');
  s.id = '_chatExtraStyles';
  s.textContent = `
    /* ── Typing indicator ─────────────────────────────────── */
    .chat-typing-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0 2px 4px;
      opacity: 0;
      transition: opacity .2s;
      min-height: 28px;
    }
    .chat-typing-wrap.visible { opacity: 1; }
    .chat-typing-dots {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .chat-typing-dots span {
      width: 7px; height: 7px;
      background: var(--text-3, #9ca3af);
      border-radius: 50%;
      animation: _typingBounce 1.2s infinite ease-in-out;
    }
    .chat-typing-dots span:nth-child(2) { animation-delay: .2s; }
    .chat-typing-dots span:nth-child(3) { animation-delay: .4s; }
    @keyframes _typingBounce {
      0%, 80%, 100% { transform: translateY(0); }
      40%           { transform: translateY(-5px); }
    }
    .chat-typing-label {
      font-size: 12px;
      color: var(--text-3, #9ca3af);
      font-style: italic;
    }

    /* ── Read receipts ────────────────────────────────────── */
    .bubble-ticks {
      font-size: 11px;
      margin-left: 4px;
      line-height: 1;
      display: inline-block;
    }
    .bubble-ticks.sent { color: var(--text-3, #9ca3af); }
    .bubble-ticks.read { color: #4ade80; }

    /* ── Image attachment in bubble ───────────────────────── */
    .bubble-img {
      max-width: 200px;
      max-height: 200px;
      border-radius: 10px;
      margin-bottom: 4px;
      display: block;
      object-fit: cover;
      cursor: pointer;
    }
    .bubble-img-loading {
      width: 120px; height: 80px;
      background: var(--border, #e5e7eb);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      color: var(--text-3, #9ca3af);
      margin-bottom: 4px;
    }

    /* ── Attach button next to input ─────────────────────── */
    #chat-attach-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 6px;
      font-size: 20px;
      color: var(--text-2, #6b7280);
      flex-shrink: 0;
      display: flex;
      align-items: center;
    }
    #chat-attach-btn:active { opacity: .6; }
    #chat-file-input { display: none; }

    /* ── Unresponsive CTA ─────────────────────────────────── */
    .chat-cta-warn {
      background: #FEF3C7;
      color: #92400E;
      border: 1px solid #FCD34D;
      border-radius: 20px;
      padding: 10px 18px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }
  `;
  document.head.appendChild(s);
})();

/* ══════════════════════════════════════════════════════════
   DB LAYER
   ══════════════════════════════════════════════════════════ */

/* ── Load all conversation threads from DB ───────────────── */
async function dbLoadConversations() {
  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) return;

  const { data, error } = await window._supabase
    .from('conversations')
    .select(`
      id,
      brand_name,
      brand_initials,
      brand_gradient,
      last_message,
      last_message_at,
      task_id,
      task_status,
      unread
    `)
    .eq('creator_id', user.id)
    .order('last_message_at', { ascending: false });

  if (error) {
    console.error('[DB] conversations load failed:', error.message, '— Run MIGRATION_messaging_rls.sql in Supabase SQL Editor');
    const body = document.getElementById('messages-body');
    if (body) body.innerHTML = `
      <div style="padding:40px 24px;text-align:center;color:var(--text-2);">
        <div style="font-size:36px;margin-bottom:12px;">⚠️</div>
        <div style="font-weight:700;margin-bottom:6px;">Could not load messages</div>
        <div style="font-size:13px;line-height:1.6;">${error.message}</div>
      </div>`;
    return;
  }

  window._chatThreads = data || [];

  /* Sync _msgReadState from DB-supplied unread flags */
  window._chatThreads.forEach(t => {
    window._msgReadState[t.id] = !t.unread;
  });
  if (typeof syncUnreadCount === 'function') syncUnreadCount();
}

/* ── Load messages for one conversation (replaces mock CHAT_DATA) */
async function loadConversation(conversationId) {
  return dbLoadMessages(conversationId);
}

async function dbLoadMessages(conversationId) {
  /* Use RPC to bypass RLS — auth check is inside the SECURITY DEFINER function */
  const { data, error } = await window._supabase
    .rpc('get_messages_for_conversation', { conv_id: conversationId });

  if (error) {
    console.error('[Chat] get_messages_for_conversation RPC failed:', error.message,
      '— Make sure you ran FIX_rpc_get_messages.sql in Supabase SQL Editor');
    window._chatMessages[conversationId] = [];
    return [];
  }

  /* Normalise: both (sender/text) and (sender_type/message_text) column pairs */
  const normalised = (data || []).map(m => ({
    ...m,
    sender:     m.sender      || m.sender_type  || 'brand',
    text:       m.text        || m.message_text || '',
    image_url:  m.image_url   || null,
  }));

  window._chatMessages[conversationId] = normalised;
  return normalised;
}

/* ── Send a message to DB + update conversation last_message  */
async function dbSendMessage(conversationId, text, imageUrl = null) {
  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) return null;

  const payload = {
    conversation_id: conversationId,
    sender:          'creator',
    text:            text || null,
    image_url:       imageUrl || null,
    read_by_brand:   false,
    created_at:      new Date().toISOString(),
  };

  const { data, error } = await window._supabase
    .from('messages')
    .insert(payload)
    .select('id')
    .single();

  if (error) {
    console.warn('[DB] send message:', error.message);
    return null;
  }

  /* Update conversation last_message preview */
  await window._supabase
    .from('conversations')
    .update({
      last_message:    imageUrl ? '📎 Image' : text,
      last_message_at: payload.created_at,
    })
    .eq('id', conversationId);

  return data?.id || null;
}

/* ── Upload an image attachment to Supabase Storage ─────── */
async function dbUploadAttachment(conversationId, file) {
  const ext  = file.name.split('.').pop() || 'jpg';
  const path = `chat/${conversationId}/${Date.now()}.${ext}`;

  const { error } = await window._supabase.storage
    .from('chat-attachments')
    .upload(path, file, { upsert: false });

  if (error) {
    console.warn('[DB] upload attachment:', error.message);
    return null;
  }

  const { data } = window._supabase.storage
    .from('chat-attachments')
    .getPublicUrl(path);

  return data?.publicUrl || null;
}

/* ── Mark conversation read in DB ────────────────────────── */
async function dbMarkConversationRead(conversationId) {
  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) return;

  await window._supabase
    .from('conversations')
    .update({ unread: false })
    .eq('id', conversationId)
    .eq('creator_id', user.id);
}

/* ── Mark conversation unread in DB ─────────────────────── */
async function dbMarkConversationUnread(conversationId) {
  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) return;

  await window._supabase
    .from('conversations')
    .update({ unread: true })
    .eq('id', conversationId)
    .eq('creator_id', user.id);
}

/* ── Request a brand rating (Billo "Ask for a review") ──── */
async function requestRating(conversationId) {
  const { data: { user } } = await window._supabase.auth.getUser();
  if (!user) return;

  const thread = _threadById(conversationId);
  if (!thread) return;

  const { error } = await window._supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender:          'system_rating_request',
      text:            '⭐ The creator has requested a rating for this collaboration.',
      created_at:      new Date().toISOString(),
    });

  if (error) { console.warn('[DB] requestRating:', error.message); return; }

  await window._supabase
    .from('notifications')
    .insert({
      user_id: user.id,
      type:    'rating_request',
      title:   'Rating requested',
      body:    `You asked ${thread.brand_name} for a review.`,
      read:    false,
    }).catch(() => {});

  showToast('⭐ Rating request sent to brand', 'success');
  _rerenderChatFooter(conversationId);
}

/* ── Re-invite past brand to collaborate ─────────────────── */
async function reInviteCollaboration(conversationId) {
  const thread = _threadById(conversationId);
  if (!thread) return;

  const { error } = await window._supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender:          'system_reinvite',
      text:            '🤝 The creator has expressed interest in collaborating again.',
      created_at:      new Date().toISOString(),
    });

  if (error) { console.warn('[DB] reInvite:', error.message); return; }

  showToast('🤝 Re-invite sent to ' + thread.brand_name, 'success');
  _rerenderChatFooter(conversationId);
}

/* ══════════════════════════════════════════════════════════
   REALTIME — messages + typing presence
   ══════════════════════════════════════════════════════════ */

/* ── Real-time subscription on messages table ────────────── */
function _subscribeChatMessages(conversationId) {
  if (window._chatChannel) {
    window._supabase.removeChannel(window._chatChannel);
    window._chatChannel = null;
  }

  window._chatChannel = window._supabase
    .channel('messages:' + conversationId)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'messages',
        filter: 'conversation_id=eq.' + conversationId,
      },
      (payload) => {
        const msg = payload.new;

        const cache = window._chatMessages[conversationId] || [];
        if (!cache.find(m => m.id === msg.id)) {
          cache.push(msg);
          window._chatMessages[conversationId] = cache;
        }

        const chatScreen = document.getElementById('screen-chat');
        if (chatScreen && chatScreen.classList.contains('active')) {
          /* Only append if NOT already rendered (optimistic creator bubbles
             are in the DOM before the realtime INSERT fires — without this
             check every creator message appears twice). */
          const alreadyRendered = !!document.querySelector(`.chat-bubble[data-msg-id="${msg.id}"]`);
          if (!alreadyRendered) _appendBubble(msg, false);
          window._msgReadState[conversationId] = true;
          dbMarkConversationRead(conversationId);
          if (typeof syncUnreadCount === 'function') syncUnreadCount();
        } else {
          window._msgReadState[conversationId] = false;
          if (typeof syncUnreadCount === 'function') syncUnreadCount();
          showToast('💬 New message from ' + (_threadById(conversationId)?.brand_name || 'Brand'));
        }
      }
    )
    /* ── Read receipt: brand updated read_by_brand → true ─── */
    .on(
      'postgres_changes',
      {
        event:  'UPDATE',
        schema: 'public',
        table:  'messages',
        filter: 'conversation_id=eq.' + conversationId,
      },
      (payload) => {
        const updated = payload.new;
        if (!updated.read_by_brand) return;

        /* Update local cache */
        const cache = window._chatMessages[conversationId] || [];
        const idx = cache.findIndex(m => m.id === updated.id);
        if (idx !== -1) cache[idx] = { ...cache[idx], read_by_brand: true };

        /* Flip tick on the rendered bubble to double blue */
        const el = document.querySelector(`.chat-bubble[data-msg-id="${updated.id}"] .bubble-ticks`);
        if (el) {
          el.className = 'bubble-ticks read';
          el.innerHTML = `<svg class="tick-svg tick-double" viewBox="0 0 18 9" xmlns="http://www.w3.org/2000/svg"><polyline points="1,4.5 4,7.5 11,1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><polyline points="6,4.5 9,7.5 16,1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        }
      }
    )
    .subscribe();
}

/* ── Typing indicator — Supabase Presence ───────────────── */
function _subscribeTypingPresence(conversationId) {
  if (window._typingChannel) {
    window._supabase.removeChannel(window._typingChannel);
    window._typingChannel = null;
  }

  window._typingChannel = window._supabase
    .channel('typing:' + conversationId, { config: { presence: { key: 'brand' } } })
    .on('presence', { event: 'sync' }, () => {
      const state = window._typingChannel.presenceState();
      const isBrandTyping = Object.keys(state).some(k => k === 'brand');
      _setTypingVisible(isBrandTyping);
    })
    .subscribe();
}

function _setTypingVisible(visible) {
  const wrap = document.getElementById('chat-typing-indicator');
  if (!wrap) return;
  if (visible) {
    wrap.classList.add('visible');
    /* Auto-hide after 5 s in case presence event is missed */
    clearTimeout(window._isTypingTimer);
    window._isTypingTimer = setTimeout(() => _setTypingVisible(false), 5000);
  } else {
    wrap.classList.remove('visible');
    clearTimeout(window._isTypingTimer);
  }
}

/* ── Build typing indicator DOM (called once when chat opens) */
function _ensureTypingIndicator() {
  if (document.getElementById('chat-typing-indicator')) return;
  const body = document.getElementById('chat-messages-body');
  if (!body) return;

  const wrap = document.createElement('div');
  wrap.id        = 'chat-typing-indicator';
  wrap.className = 'chat-typing-wrap';
  wrap.innerHTML = `
    <div class="chat-typing-dots">
      <span></span><span></span><span></span>
    </div>
    <span class="chat-typing-label">Brand is typing\u2026</span>`;

  body.parentNode.insertBefore(wrap, body.nextSibling);
}

/* ── Wire up hidden file input for the static attach button ── */
function _ensureAttachButton() {
  /* Static HTML already has the visible button with id="chat-attach-btn".
     We only need to inject the hidden <input type=file> and wire it up.
     Guard against running more than once. */
  if (document.getElementById('chat-file-input')) return;

  const input = document.getElementById('chat-input');
  if (!input) return;

  const fileInput = document.createElement('input');
  fileInput.id     = 'chat-file-input';
  fileInput.type   = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', _handleFileSelected);
  input.parentNode.appendChild(fileInput);

  /* Wire the static button to open the file picker */
  const btn = document.getElementById('chat-attach-btn');
  if (btn) btn.onclick = () => fileInput.click();
}

/* ── Handle file selected from picker ───────────────────── */
async function _handleFileSelected(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Only images are supported', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('Image must be under 10 MB', 'error');
    return;
  }

  const conversationId = window._activeChatId;
  if (!conversationId) return;

  /* Optimistic placeholder bubble */
  const placeholderId = 'opt_img_' + Date.now();
  const placeholder = {
    id:            placeholderId,
    sender:        'creator',
    text:          null,
    image_url:     '__uploading__',
    read_by_brand: false,
    created_at:    new Date().toISOString(),
  };
  const cache = window._chatMessages[conversationId] || [];
  cache.push(placeholder);
  window._chatMessages[conversationId] = cache;
  _appendBubble(placeholder, false);

  /* Upload */
  const imageUrl = await dbUploadAttachment(conversationId, file);
  if (!imageUrl) {
    showToast('Image upload failed', 'error');
    document.querySelector(`.chat-bubble[data-msg-id="${placeholderId}"]`)?.remove();
    return;
  }

  /* Replace placeholder with real image */
  const placeholderEl = document.querySelector(`.chat-bubble[data-msg-id="${placeholderId}"] .bubble-img-loading`);
  if (placeholderEl) {
    const img = document.createElement('img');
    img.src       = imageUrl;
    img.className = 'bubble-img';
    img.onclick   = () => window.open(imageUrl, '_blank');
    placeholderEl.replaceWith(img);
  }

  /* Persist to DB */
  const realId = await dbSendMessage(conversationId, null, imageUrl);
  if (realId) {
    const idx = cache.findIndex(m => m.id === placeholderId);
    if (idx !== -1) cache[idx] = { ...cache[idx], id: realId, image_url: imageUrl };
    const bubbleEl = document.querySelector(`.chat-bubble[data-msg-id="${placeholderId}"]`);
    if (bubbleEl) bubbleEl.dataset.msgId = realId;
  }
}

/* ══════════════════════════════════════════════════════════
   OPEN CHAT
   ══════════════════════════════════════════════════════════ */

async function openChat(conversationId) {
  chatPreviousScreen = currentTab || 'messages';

  const thread = _threadById(conversationId);
  if (!thread) { showToast('Chat not found', 'error'); return; }

  document.getElementById('chat-partner-name').textContent    = thread.brand_name;

  const avatarEl = document.getElementById('chat-avatar-initials');
  if (avatarEl) {
    avatarEl.textContent = thread.brand_initials || thread.brand_name.charAt(0);
    if (thread.brand_gradient) avatarEl.style.background = thread.brand_gradient;
  }

  const body = document.getElementById('chat-messages-body');
  body.innerHTML = '<div class="chat-day-label">Loading\u2026</div>';

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const chatScreen = document.getElementById('screen-chat');
  chatScreen.classList.add('active');

  /* Scroll to top so chat screen starts at viewport top, not mid-page */
  window.scrollTo(0, 0);

  /* CSS .chat-screen rule uses position:fixed anchored to the viewport
     (top:0, bottom: navH + safe-area) so sizing is handled entirely by CSS.
     Only set display:flex here to activate the flex layout. */
  chatScreen.style.cssText = 'display:flex';

  previousTab = chatPreviousScreen;

  /* Load messages from DB (no more mock CHAT_DATA) */
  const messages = await loadConversation(conversationId);

  if (messages.length === 0) {
    body.innerHTML = `
      <div class="chat-day-label">Today</div>
      <div id="chat-empty-state" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;text-align:center;opacity:.7;">
        <div style="font-size:40px;margin-bottom:12px;">💬</div>
        <div style="font-size:14px;color:var(--text-3);line-height:1.6;">No messages yet.<br>Send a message below to start the conversation.</div>
      </div>`;
  } else {
    body.innerHTML = '<div class="chat-day-label">Today</div>';
    messages.forEach(msg => _appendBubble(msg, true));
  }
  body.scrollTop = body.scrollHeight;

  /* Mark read */
  window._msgReadState[conversationId] = true;
  dbMarkConversationRead(conversationId);
  if (typeof syncUnreadCount === 'function') syncUnreadCount();

  /* Inject typing indicator & attach button */
  _ensureTypingIndicator();
  _ensureAttachButton();

  /* Render context-aware footer CTAs */
  _rerenderChatFooter(conversationId);

  /* Subscribe to realtime updates for this thread */
  _subscribeChatMessages(conversationId);
  _subscribeTypingPresence(conversationId);

  window._activeChatId = conversationId;
}

/* ══════════════════════════════════════════════════════════
   BUBBLE RENDER
   ══════════════════════════════════════════════════════════ */

function _appendBubble(msg, skipScroll) {
  const body = document.getElementById('chat-messages-body');
  if (!body) return;

  /* Remove empty state on first real message */
  document.getElementById('chat-empty-state')?.remove();

  const isMe     = msg.sender === 'creator';
  const isSystem = msg.sender?.startsWith('system_');

  /* ── System message ──────────────────────────────────── */
  if (isSystem) {
    const div = document.createElement('div');
    div.className = 'chat-system-msg';
    div.style.cssText = 'text-align:center;color:var(--text-3);font-size:12px;padding:8px 16px;font-style:italic;';
    div.textContent = msg.text;
    body.appendChild(div);
    if (!skipScroll) body.scrollTop = body.scrollHeight;
    return;
  }

  const div     = document.createElement('div');
  div.className = 'chat-bubble ' + (isMe ? 'mine' : 'theirs');
  div.dataset.msgId = msg.id;

  const time = msg.created_at ? relTime(msg.created_at) : 'Just now';

  /* ── Image content ───────────────────────────────────── */
  let mediaHTML = '';
  if (msg.image_url) {
    if (msg.image_url === '__uploading__') {
      mediaHTML = `<div class="bubble-img-loading">Uploading\u2026</div>`;
    } else {
      mediaHTML = `<img class="bubble-img" src="${_esc(msg.image_url)}" alt="Attachment"
                        onclick="window.open('${_esc(msg.image_url)}','_blank')" />`;
    }
  }

  /* ── Text content ────────────────────────────────────── */
  const textHTML = msg.text ? `<div class="bubble-text">${_esc(msg.text)}</div>` : '';

  /* ── Read receipt ticks (creator-sent bubbles only) ───
       Single tick = delivered (grey)
       Double tick = read_by_brand is true (blue)           */
  let tickHTML = '';
  if (isMe) {
    const isRead = msg.read_by_brand === true;
    const tick1 = `<svg class="tick-svg" viewBox="0 0 12 9" xmlns="http://www.w3.org/2000/svg"><polyline points="1,4.5 4,7.5 11,1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const tick2 = `<svg class="tick-svg tick-double" viewBox="0 0 18 9" xmlns="http://www.w3.org/2000/svg"><polyline points="1,4.5 4,7.5 11,1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><polyline points="6,4.5 9,7.5 16,1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    tickHTML = `<span class="bubble-ticks ${isRead ? 'read' : 'sent'}">  ${isRead ? tick2 : tick1}</span>`;
  }

  div.innerHTML = `
    ${mediaHTML}
    ${textHTML}
    <div class="bubble-time">${_esc(time)}${tickHTML}</div>`;

  body.appendChild(div);
  if (!skipScroll) body.scrollTop = body.scrollHeight;
}

/* ══════════════════════════════════════════════════════════
   FOOTER CTAs
   ══════════════════════════════════════════════════════════ */

function _rerenderChatFooter(conversationId) {
  const thread = _threadById(conversationId);
  if (!thread) return;

  const footer = document.getElementById('chat-cta-bar');
  if (!footer) return;

  const ctaBtns = [];

  /* ── Brand unresponsive escalation (48 h no brand reply) ── */
  const lastBrandReply = _lastBrandReplyTime(conversationId);
  const hoursSince = lastBrandReply
    ? (Date.now() - new Date(lastBrandReply).getTime()) / 36e5
    : Infinity;

  if (hoursSince >= 48) {
    ctaBtns.push(`
      <button class="chat-cta-btn chat-cta-warn"
              onclick="window.open('mailto:support@vyralist.com?subject=Unresponsive%20brand%20-%20${encodeURIComponent(thread.brand_name)}','_blank')">
        ⚠️ Brand hasn't replied — Contact support
      </button>`);
  }

  /* ── Re-invite for completed tasks ─────────────────────── */
  if (thread.task_status === 'completed') {
    ctaBtns.push(`
      <button class="chat-cta-btn"
              onclick="reInviteCollaboration('${_esc(conversationId)}')"
              style="background:var(--brand-soft);color:var(--brand);border:1px solid var(--brand);border-radius:20px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;">
        🤝 Invite to collaborate again
      </button>`);

    ctaBtns.push(`
      <button class="chat-cta-btn"
              onclick="requestRating('${_esc(conversationId)}')"
              style="background:#FFF9C4;color:#7C6300;border:1px solid #F9E000;border-radius:20px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;">
        ⭐ Ask for a review
      </button>`);
  }

  footer.innerHTML = ctaBtns.length
    ? `<div style="display:flex;flex-direction:column;gap:8px;padding:8px 0 4px;">${ctaBtns.join('')}</div>`
    : '';
  footer.style.display = ctaBtns.length ? '' : 'none';
}

/* ══════════════════════════════════════════════════════════
   SEND MESSAGE
   ══════════════════════════════════════════════════════════ */

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;

  const conversationId = window._activeChatId;
  if (!conversationId) { showToast('No active chat', 'error'); return; }

  /* Optimistic UI — single tick (sent, not yet read) */
  const fakeMsg = {
    id:              'optimistic_' + Date.now(),
    sender:          'creator',
    text,
    image_url:       null,
    read_by_brand:   false,
    created_at:      new Date().toISOString(),
    conversation_id: conversationId,
  };
  const cache = window._chatMessages[conversationId] || [];
  cache.push(fakeMsg);
  window._chatMessages[conversationId] = cache;
  _appendBubble(fakeMsg, false);
  input.value = '';
  input.style.height = 'auto';

  /* Persist to DB — also updates conversations.last_message */
  const realId = await dbSendMessage(conversationId, text);

  /* Swap optimistic id for real DB id */
  if (realId) {
    const idx = cache.findIndex(m => m.id === fakeMsg.id);
    if (idx !== -1) cache[idx] = { ...cache[idx], id: realId };
    const bubbleEl = document.querySelector(`.chat-bubble[data-msg-id="${fakeMsg.id}"]`);
    if (bubbleEl) bubbleEl.dataset.msgId = realId;
  }
}

/* ══════════════════════════════════════════════════════════
   THREAD LIST RENDER
   ══════════════════════════════════════════════════════════ */

async function renderMessages() {
  const body = document.getElementById('messages-body');
  if (!body) return;

  await dbLoadConversations();

  const threads = window._chatThreads;

  const sorted = [...threads].sort((a, b) => {
    const aUnread = !window._msgReadState[a.id] ? 1 : 0;
    const bUnread = !window._msgReadState[b.id] ? 1 : 0;
    if (bUnread !== aUnread) return bUnread - aUnread;
    return new Date(b.last_message_at) - new Date(a.last_message_at);
  });

  body.innerHTML = sorted.length ? `
    <div class="msg-list" id="msg-list-inner">
      ${sorted.map(t => _msgRowHTML(t)).join('')}
    </div>
    <div id="msg-context-menu" style="display:none;position:fixed;z-index:300;background:white;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.18);overflow:hidden;min-width:180px;">
      <div id="msg-ctx-readbtn" style="padding:14px 20px;font-size:14px;font-weight:600;cursor:pointer;color:var(--text);border-bottom:1px solid var(--border);" onclick="_msgCtxToggleRead()"></div>
      <div style="padding:14px 20px;font-size:14px;font-weight:500;cursor:pointer;color:var(--text-2);" onclick="_closeMsgCtx()">Cancel</div>
    </div>` : `
    <div class="empty-state">
      <div style="font-size:64px;margin-bottom:8px;">💬</div>
      <h3>No messages yet</h3>
      <p style="color:var(--text-2);font-size:14px;">Your brand conversations will appear here once you're selected for a campaign.</p>
    </div>`;

  body.addEventListener('click', e => {
    const menu = document.getElementById('msg-context-menu');
    if (menu && !menu.contains(e.target)) _closeMsgCtx();
  });
}

/* ── Single thread row ────────────────────────────────────── */
function _msgRowHTML(t) {
  const unread   = !window._msgReadState[t.id];
  const gradient = t.brand_gradient || 'linear-gradient(135deg,#5B2EE8,#9B59B6)';
  const initials = t.brand_initials || (t.brand_name || '?').charAt(0);
  return `
    <div class="msg-item${unread ? ' msg-item-unread' : ''}" id="msg-row-${_esc(t.id)}"
         onclick="_openChatSafe('${_esc(t.id)}')"
         oncontextmenu="event.preventDefault();_openMsgCtx('${_esc(t.id)}',event);"
         ontouchstart="_msgTouchStart('${_esc(t.id)}',event)"
         ontouchend="_msgTouchEnd()"
         ontouchmove="_msgTouchEnd()">
      <div class="msg-avatar" style="background:${gradient};">${_esc(initials)}</div>
      <div class="msg-meta">
        <h4 style="font-weight:${unread ? '700' : '600'};">${_esc(t.brand_name)}</h4>
        <p style="font-weight:${unread ? '500' : '400'};color:${unread ? 'var(--text-2)' : 'var(--text-3)'};">${_esc(t.last_message || '')}</p>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex-shrink:0;">
        <span class="msg-time">${t.last_message_at ? relTime(t.last_message_at) : ''}</span>
        ${unread ? `<div style="width:9px;height:9px;background:var(--brand);border-radius:50%;"></div>` : ''}
      </div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════ */

/* ── Last timestamp of a brand-sent message ─────────────── */
function _lastBrandReplyTime(conversationId) {
  const msgs = window._chatMessages[conversationId] || [];
  const brandMsgs = msgs.filter(m => m.sender === 'brand');
  if (!brandMsgs.length) return null;
  return brandMsgs[brandMsgs.length - 1].created_at;
}

/* ── Find thread by id ───────────────────────────────────── */
function _threadById(id) {
  return window._chatThreads.find(t => t.id === id) || null;
}

/* ══════════════════════════════════════════════════════════
   CONTEXT MENU — long-press / right-click on thread row
   ══════════════════════════════════════════════════════════ */

let _msgLongPressTimer = null;
function _msgTouchStart(id, e) {
  _msgLongPressTimer = setTimeout(() => {
    e.preventDefault();
    _openMsgCtx(id, e.touches[0]);
  }, 500);
}
function _msgTouchEnd() { clearTimeout(_msgLongPressTimer); _msgLongPressTimer = null; }

window._msgCtxTarget = null;
function _openMsgCtx(id, e) {
  window._msgCtxTarget = id;
  const menu = document.getElementById('msg-context-menu');
  if (!menu) return;
  document.getElementById('msg-ctx-readbtn').textContent = !window._msgReadState[id] ? 'Mark as read' : 'Mark as unread';
  const x = Math.min(e.clientX || e.pageX || 20, window.innerWidth - 200);
  const y = Math.min(e.clientY || e.pageY || 100, window.innerHeight - 120);
  menu.style.left = x + 'px'; menu.style.top = y + 'px'; menu.style.display = 'block';
}
function _closeMsgCtx() {
  const menu = document.getElementById('msg-context-menu');
  if (menu) menu.style.display = 'none';
  window._msgCtxTarget = null;
}

/* ── Toggle read / unread from context menu ─────────────── */
function _msgCtxToggleRead() {
  const id = window._msgCtxTarget;
  if (!id) return;

  const nowRead = !window._msgReadState[id];
  window._msgReadState[id] = nowRead;
  _closeMsgCtx();
  renderMessages();
  if (typeof syncUnreadCount === 'function') syncUnreadCount();
  showToast(nowRead ? 'Marked as read' : 'Marked as unread');

  if (nowRead) {
    dbMarkConversationRead(id);
  } else {
    dbMarkConversationUnread(id);
  }
}

function _openChatSafe(id) {
  const menu = document.getElementById('msg-context-menu');
  if (menu && menu.style.display !== 'none') { _closeMsgCtx(); return; }
  window._msgReadState[id] = true;
  if (typeof syncUnreadCount === 'function') syncUnreadCount();
  if (typeof openChat === 'function') openChat(id);
}
