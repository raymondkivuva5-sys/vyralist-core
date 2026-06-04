/* ============================================================
   MESSAGES.JS — v2.0  Full upgrade

   Changes vs v1:
   - renderNotificationsScreen() fully clears hardcoded items
   - Notifications: bell badge wired via _syncNotifBadge()
   - Earnings toggle: smooth animated expand/collapse
   - _notifEmptyState() with illustrated zero-state
   - _notifTypeConfig map extended with all admin-sent types
   ============================================================ */

function renderNotificationsScreen() {
  const list = document.getElementById('notif-list');
  if (!list) return;

  /* Remove all hardcoded items — belt-and-suspenders */
  list.querySelectorAll('[data-hardcoded], [data-hardcoded="true"]').forEach(el => el.remove());

  const notifs = window._db.notifications || [];

  if (!notifs.length) {
    list.innerHTML = _notifEmptyState();
    _syncNotifBadge(0);
    return;
  }

  const _typeIcon = {
    application   : '📋', accepted      : '🎉', selected      : '🎉',
    submitted     : '🎬', payout        : '💸', revision      : '📝',
    offer         : '🌟', shipping      : '📦', approved      : '✅',
    rating_request: '⭐', system        : '🔔',
  };
  const _typeBg = {
    application   : '#F3E8FF', accepted      : '#FEF3C7', selected      : '#FEF3C7',
    submitted     : '#E3F2FD', payout        : '#D1FAE5', revision      : '#FEE2E2',
    offer         : '#F3E5F5', shipping      : '#FEF3C7', approved      : '#D1FAE5',
    rating_request: '#FEF9C3', system        : '#F3F4F6',
  };
  const _ne = s => String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const unreadCount = notifs.filter(n => !n.read).length;
  _syncNotifBadge(unreadCount);

  list.innerHTML = notifs.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}"
         onclick="_handleNotifClick(this,'${_ne(n.id)}')"
         role="button" tabindex="0">
      <div class="notif-icon-wrap" style="background:${_typeBg[n.type]||'#F3E8FF'};">${_typeIcon[n.type]||'🔔'}</div>
      <div class="notif-content">
        <h4>${_ne(n.title)}</h4>
        <p>${_ne(n.body)}</p>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
        <span class="notif-time">${relTime(n.created_at)}</span>
        ${!n.read ? '<div class="unread-dot"></div>' : ''}
      </div>
    </div>`).join('');
}

function _handleNotifClick(el, id) {
  if (!el.classList.contains('unread')) return;
  el.classList.remove('unread');
  el.querySelector('.unread-dot')?.remove();
  const remaining = document.querySelectorAll('.notif-item.unread').length;
  _syncNotifBadge(remaining);
  dbMarkNotifRead(id);
}

function _notifEmptyState() {
  return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 32px;text-align:center;">
      <div style="width:72px;height:72px;background:#EDE8FD;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:16px;">🔔</div>
      <div style="font-size:17px;font-weight:700;color:var(--text);margin-bottom:8px;">No notifications yet</div>
      <div style="font-size:14px;color:var(--text-3);line-height:1.6;max-width:260px;">You'll be notified when brands respond to your applications, ship products, or approve your videos.</div>
    </div>`;
}

function _syncNotifBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  badge.textContent = count > 0 ? String(count > 99 ? '99+' : count) : '';
  badge.style.display = count > 0 ? '' : 'none';
}

/* ── Earnings toggle — smooth animated expand ── */
function toggleEarning(el) {
  const detail = el.nextElementSibling;
  if (!detail) return;
  const isHidden = detail.classList.contains('hidden');
  const toggle   = el.querySelector('.see-toggle');
  if (isHidden) {
    detail.classList.remove('hidden');
    detail.style.maxHeight = '0px';
    detail.style.overflow  = 'hidden';
    detail.style.transition = 'max-height .28s ease';
    requestAnimationFrame(() => { detail.style.maxHeight = detail.scrollHeight + 'px'; });
    setTimeout(() => { detail.style.maxHeight = ''; detail.style.overflow = ''; }, 300);
    if (toggle) toggle.textContent = 'See less';
  } else {
    detail.style.overflow  = 'hidden';
    detail.style.maxHeight = detail.scrollHeight + 'px';
    detail.style.transition = 'max-height .25s ease';
    requestAnimationFrame(() => { detail.style.maxHeight = '0px'; });
    setTimeout(() => { detail.classList.add('hidden'); detail.style.maxHeight = ''; detail.style.overflow = ''; }, 260);
    if (toggle) toggle.textContent = 'See more';
  }
}

/* ── Mark all notifications read ── */
function markAllRead() {
  const notifs = window._db.notifications || [];
  const hasUnread = notifs.some(n => !n.read);
  /* Mark all unread items in any rendered list */
  document.querySelectorAll('.notif-item.unread').forEach(el => {
    el.classList.remove('unread');
    el.querySelector('.unread-dot')?.remove();
  });
  _syncNotifBadge(0);
  if (!hasUnread) { showToast('All caught up!', 'success'); return; }
  /* Update in-memory state */
  notifs.forEach(n => { n.read = true; });
  dbMarkAllNotifsRead()
    .then(() => showToast('All notifications marked as read', 'success'))
    .catch(() => showToast('Could not mark all read', 'error'));
}
