const SERVER_URL = 'https://fada.natayj.com';

const state = {
  socket: null, username: '', roomCode: null, myId: null, ownerId: null,
  members: {}, peers: {}, myStream: null, locationWatchId: null,
  myLat: null, myLng: null, locationEnabled: false, voiceEnabled: false,
  map: null, markers: {}, focusInterval: null, mutedUsers: [],
};

const COLORS = ['#7c3aed','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#8b5cf6','#14b8a6','#f97316','#3b82f6','#84cc16','#e11d48'];

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const dom = {};

function cacheDom() {
  dom.homeView = $('#home-view');
  dom.roomView = $('#room-view');
  dom.usernameInput = $('#username-input');
  dom.createBtn = $('#create-btn');
  dom.roomInput = $('#room-input');
  dom.joinBtn = $('#join-btn');
  dom.homeError = $('#home-error');
  dom.roomCodeDisplay = $('#room-code-display');
  dom.memberCount = $('#member-count');
  dom.shareBtn = $('#share-btn');
  dom.leaveBtn = $('#leave-btn');
  dom.messages = $('#messages');
  dom.chatInput = $('#chat-input');
  dom.chatSendBtn = $('#chat-send-btn');
  dom.membersList = $('#members-list');
  dom.navTabs = $$('.nav-tab');
  dom.tabContents = $$('.tab-content');
  dom.voiceBtn = $('#voice-btn');
  dom.locationBtn = $('#location-btn');
  dom.mapContainer = $('#map');
  dom.mapFocusBtn = $('#map-focus-btn');
  dom.toastContainer = $('#toast-container');
}

function setConnStatus(status, detail) {
  const dot = $('#conn-dot');
  const text = $('#conn-text');
  const err = $('#home-error');
  dot.className = 'conn-dot ' + status;
  const labels = { connected: 'متصل', connecting: 'جاري الاتصال...', disconnected: 'غير متصل' };
  text.textContent = labels[status] || status;
  if (detail && status === 'disconnected') err.textContent = detail;
}

function showView(name) {
  dom.homeView.classList.toggle('active', name === 'home');
  dom.roomView.classList.toggle('active', name === 'room');
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  const icons = { info: 'fa-info-circle', success: 'fa-check-circle', error: 'fa-exclamation-circle' };
  el.innerHTML = '<i class="fas ' + (icons[type] || icons.info) + '"></i> ' + msg;
  dom.toastContainer.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(40px)'; el.style.transition = 'all 0.3s'; }, 3000);
  setTimeout(() => el.remove(), 3500);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function hashId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) { hash = (hash << 5) - hash + id.charCodeAt(i); hash |= 0; }
  return Math.abs(hash);
}

function addChatMsg(data) {
  const placeholder = dom.messages.querySelector('.msg-placeholder');
  if (placeholder) placeholder.remove();
  if (data.type === 'system') {
    const div = document.createElement('div');
    div.className = 'msg-system';
    div.textContent = data.message;
    dom.messages.appendChild(div);
  } else {
    const isOwn = data.userId === state.myId;
    const div = document.createElement('div');
    div.className = 'msg ' + (isOwn ? 'msg-own' : 'msg-other');
    const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML =
      (isOwn ? '' : '<div class="msg-username">' + escapeHtml(data.username) + '</div>') +
      '<div class="msg-bubble">' + escapeHtml(data.message) + '</div>' +
      '<div class="msg-time">' + time + '</div>';
    dom.messages.appendChild(div);
  }
  dom.messages.scrollTop = dom.messages.scrollHeight;
}

function addSystemMsg(text) {
  addChatMsg({ type: 'system', message: text, timestamp: Date.now() });
}

function renderMembers() {
  const list = dom.membersList;
  const entries = Object.values(state.members);
  if (entries.length === 0) {
    list.innerHTML = '<div class="msg-placeholder"><i class="fas fa-users"></i><p>في انتظار الأعضاء...</p></div>';
    return;
  }
  const isOwner = state.myId === state.ownerId;
  list.innerHTML = entries.map((m) => {
    const isMe = m.id === state.myId;
    const colorIdx = hashId(m.id) % COLORS.length;
    const initial = m.username ? m.username[0].toUpperCase() : '?';
    const isMuted = state.mutedUsers.includes(m.id);
    const muteBtn = (isOwner && !isMe) ? '<button class="member-mute-btn' + (isMuted ? ' muted' : '') + '" data-uid="' + m.id + '" title="' + (isMuted ? 'فتح الصوت' : 'كتم الصوت') + '"><i class="fas fa-fw fa-microphone' + (isMuted ? '-slash' : '') + '"></i></button>' : '';
    const removeBtn = (isOwner && !isMe) ? '<button class="member-remove-btn" data-uid="' + m.id + '" title="إزالة العضو"><i class="fas fa-times"></i></button>' : '';
    return '<div class="member-item" data-uid="' + m.id + '">' +
      '<div class="member-avatar" style="background:' + COLORS[colorIdx] + '">' + (isMe ? state.username[0].toUpperCase() || '?' : initial) + '</div>' +
      '<div class="member-info">' +
        '<div class="member-name">' + (isMe ? state.username + ' (أنت)' : m.username || 'مجهول') + (m.id === state.ownerId ? ' <span class="owner-badge">المالك</span>' : '') + '</div>' +
        '<div class="member-status">' + (m.lat ? '<i class="fas fa-map-pin"></i> الموقع مشترك' : '<i class="fas fa-map-pin"></i> لا يوجد موقع') + (isMuted ? ' <span class="muted-badge">مكتوم</span>' : '') + '</div>' +
      '</div>' +
      '<div class="member-voice off"><i class="fas fa-fw fa-microphone-slash"></i></div>' +
      muteBtn + removeBtn +
    '</div>';
  }).join('');

  list.querySelectorAll('.member-remove-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const userId = btn.dataset.uid;
      if (userId && state.roomCode) {
        state.socket.emit('remove-user', { roomCode: state.roomCode, userId });
      }
    });
  });

  list.querySelectorAll('.member-mute-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const userId = btn.dataset.uid;
      if (userId && state.roomCode) {
        state.socket.emit('mute-user', { roomCode: state.roomCode, userId });
      }
    });
  });
}

function initMap() {
  if (state.map) { state.map.invalidateSize(); return; }
  state.map = L.map(dom.mapContainer, { center: [20, 0], zoom: 2 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(state.map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' }).addTo(state.map);
  setTimeout(() => state.map.invalidateSize(), 100);
  setTimeout(() => state.map.invalidateSize(), 500);
}

function updateMarker(userId, lat, lng) {
  if (state.markers[userId]) { state.markers[userId].setLatLng([lat, lng]); return; }
  const colorIdx = hashId(userId) % COLORS.length;
  const color = COLORS[colorIdx];
  const isMe = userId === state.myId;
  const label = state.members[userId]?.username || 'مجهول';
  const initial = label[0].toUpperCase();
  const size = isMe ? 40 : 34;
  const fontSize = isMe ? 18 : 15;
  const borderColor = isMe ? '#fff' : 'rgba(255,255,255,0.8)';
  const borderWidth = isMe ? 3 : 2;
  const shadow = isMe ? '0 4px 16px rgba(0,0,0,0.3)' : '0 2px 10px rgba(0,0,0,0.25)';
  const icon = L.divIcon({
    className: 'marker-icon',
    html: '<div style="width:' + size + 'px;height:' + size + 'px;background:' + color + ';border:' + borderWidth + 'px solid ' + borderColor + ';border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:' + fontSize + 'px;box-shadow:' + shadow + ';">' + initial + '</div>',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
  const marker = L.marker([lat, lng], { icon }).addTo(state.map);
  marker.bindPopup('<b>' + label + '</b><br/>' + lat.toFixed(4) + ', ' + lng.toFixed(4));
  if (isMe) {
    const pulse = L.circleMarker([lat, lng], { radius: 20, color: color, weight: 1, opacity: 0.3, fillOpacity: 0.1 }).addTo(state.map);
    state.markers['pulse'] = pulse;
    let r = 20, growing = true;
    if (state.focusInterval) clearInterval(state.focusInterval);
    state.focusInterval = setInterval(() => {
      if (growing) { r += 0.5; if (r >= 30) growing = false; } else { r -= 0.5; if (r <= 15) growing = true; }
      if (pulse._map) { pulse.setRadius(r); pulse.setStyle({ opacity: 0.4 - (r - 15) / 50 }); }
    }, 50);
  }
  state.markers[userId] = marker;
  fitMapToMarkers();
}

function fitMapToMarkers() {
  const ids = Object.keys(state.markers).filter((k) => k !== 'pulse');
  if (ids.length === 0) return;
  state.map.fitBounds(L.featureGroup(ids.map((id) => state.markers[id])).getBounds().pad(0.1), { maxZoom: 15 });
}

function startLocation() {
  if (!navigator.geolocation) { toast('الموقع الجغرافي غير مدعوم', 'error'); return; }
  state.locationEnabled = true;
  dom.locationBtn.classList.add('active');
  dom.locationBtn.innerHTML = '<i class="fas fa-location-dot"></i>';
  navigator.geolocation.getCurrentPosition(
    (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
    () => toast('تعذر الحصول على الموقع. تحقق من الأذونات.', 'error'),
    { enableHighAccuracy: true, timeout: 10000 }
  );
  state.locationWatchId = navigator.geolocation.watchPosition(
    (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
    () => {},
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
  );
}

function stopLocation() {
  state.locationEnabled = false;
  dom.locationBtn.classList.remove('active');
  dom.locationBtn.innerHTML = '<i class="fas fa-location-dot" style="color:var(--text-muted)"></i>';
  if (state.locationWatchId !== null) { navigator.geolocation.clearWatch(state.locationWatchId); state.locationWatchId = null; }
}

function sendLocation(lat, lng) {
  state.myLat = lat; state.myLng = lng;
  updateMarker(state.myId, lat, lng);
  state.socket.emit('location-update', { roomCode: state.roomCode, lat, lng });
}

function destroyPeer(userId) {
  if (state.peers[userId]) {
    try { if (state.peers[userId]._audioEl) state.peers[userId]._audioEl.remove(); state.peers[userId].destroy(); } catch (e) {}
    delete state.peers[userId];
  }
}

function handleSignal(from, signal) {
  if (from === state.myId) return;
  if (!state.peers[from]) initVoicePeer(from, false);
  if (state.peers[from]) { try { state.peers[from].signal(signal); } catch (e) {} }
}

async function initVoicePeer(userId, initiator) {
  if (userId === state.myId || state.peers[userId]) return;
  try {
    if (!state.myStream) {
      state.myStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      state.voiceEnabled = true;
      dom.voiceBtn.classList.add('recording');
      dom.voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    }
    const peer = new SimplePeer({ initiator, stream: state.myStream, trickle: false, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] } });
    peer.on('signal', (signal) => { state.socket.emit('signal', { roomCode: state.roomCode, signal, to: userId }); });
    peer.on('stream', (remoteStream) => { const audio = document.createElement('audio'); audio.srcObject = remoteStream; audio.autoplay = true; audio.style.display = 'none'; document.body.appendChild(audio); peer._audioEl = audio; });
    peer.on('error', () => destroyPeer(userId));
    peer.on('close', () => destroyPeer(userId));
    state.peers[userId] = peer;
  } catch (err) {
    toast(err.name === 'NotAllowedError' ? 'تم رفض الوصول إلى الميكروفون' : err.name === 'NotFoundError' ? 'لم يتم العثور على ميكروفون' : 'الصوت غير متاح', 'error');
  }
}

function sendChat() {
  const text = dom.chatInput.value.trim();
  if (!text || !state.roomCode) return;
  state.socket.emit('chat-message', { roomCode: state.roomCode, message: text, username: state.username });
  dom.chatInput.value = '';
}

function connectSocket() {
  console.log('Connecting to server:', SERVER_URL);
  setConnStatus('connecting');
  $('#conn-text').textContent = 'جاري الاتصال بـ ' + SERVER_URL + '...';

  state.socket = io(SERVER_URL, {
    transports: ['polling', 'websocket'], upgrade: false, rememberUpgrade: true,
    reconnection: true, reconnectionAttempts: 20, reconnectionDelay: 2000, reconnectionDelayMax: 10000, timeout: 20000
  });

  state.socket.on('connect', () => { state.myId = state.socket.id; setConnStatus('connected'); dom.homeError.textContent = ''; console.log('Connected:', state.myId); });
  state.socket.on('disconnect', (r) => { setConnStatus('disconnected', 'انقطع الاتصال: ' + r); console.log('Disconnected:', r); });
  state.socket.on('connect_error', (err) => { setConnStatus('connecting'); dom.homeError.textContent = 'خطأ في الخادم: ' + err.message; console.error('Error:', err.message); });
  state.socket.on('reconnect_attempt', (a) => { setConnStatus('connecting'); dom.homeError.textContent = 'جاري إعادة الاتصال (' + a + ')...'; });
  state.socket.on('reconnect', () => { setConnStatus('connected'); dom.homeError.textContent = ''; });
  state.socket.on('reconnect_failed', () => { setConnStatus('disconnected', 'تعذر إعادة الاتصال. قم بتحديث الصفحة.'); });

  state.socket.on('room-created', ({ roomCode }) => {
    state.roomCode = roomCode;
    state.ownerId = state.myId;
    dom.roomCodeDisplay.textContent = roomCode;
    showView('room');
    addSystemMsg('تم إنشاء الغرفة: ' + roomCode);
    initMap();
    startLocation();
  });

  state.socket.on('room-joined', ({ roomCode, ownerId }) => {
    state.roomCode = roomCode;
    state.ownerId = ownerId;
    dom.roomCodeDisplay.textContent = roomCode;
    showView('room');
    addSystemMsg('تم الانضمام للغرفة: ' + roomCode);
    initMap();
    startLocation();
  });

  state.socket.on('users-update', (users) => {
    state.members = {};
    users.forEach((u) => { state.members[u.id] = { id: u.id, lat: u.lat, lng: u.lng, username: u.username }; });
    renderMembers();
    dom.memberCount.innerHTML = '<i class="fas fa-user"></i> ' + users.length;
  });

  state.socket.on('user-joined', ({ userId, username }) => {
    state.members[userId] = { id: userId, username };
    renderMembers();
    initVoicePeer(userId, true);
  });

  state.socket.on('user-left', ({ userId }) => {
    if (state.markers[userId] && state.map) { state.map.removeLayer(state.markers[userId]); delete state.markers[userId]; }
    destroyPeer(userId);
  });

  state.socket.on('user-removed', ({ roomCode }) => {
    toast('تم إزالتك من الغرفة', 'error');
    cleanup();
    dom.messages.innerHTML = '<div class="msg-placeholder"><i class="fas fa-comments"></i><p>لا توجد رسائل بعد. ابدأ المحادثة!</p></div>';
    dom.membersList.innerHTML = '<div class="msg-placeholder"><i class="fas fa-users"></i><p>في انتظار الأعضاء...</p></div>';
    showView('home');
    dom.homeError.textContent = '';
    dom.roomInput.value = '';
  });

  state.socket.on('user-muted', ({ muted }) => {
    toast(muted ? 'تم كتم صوتك' : 'تم فتح صوتك', muted ? 'error' : 'success');
  });

  state.socket.on('mute-update', ({ userId, muted }) => {
    if (muted) {
      if (!state.mutedUsers.includes(userId)) state.mutedUsers.push(userId);
    } else {
      state.mutedUsers = state.mutedUsers.filter(id => id !== userId);
    }
    renderMembers();
  });

  state.socket.on('chat-message', (data) => addChatMsg(data));

  state.socket.on('location-update', ({ userId, lat, lng }) => {
    updateMarker(userId, lat, lng);
    if (state.members[userId]) { state.members[userId].lat = lat; state.members[userId].lng = lng; }
  });

  state.socket.on('signal', ({ signal, from }) => handleSignal(from, signal));

  state.socket.on('voice-toggle', ({ userId, enabled }) => {
    const el = document.querySelector('[data-uid="' + userId + '"] .member-voice i');
    if (el) { el.className = enabled ? 'fas fa-fw fa-microphone' : 'fas fa-fw fa-microphone-slash'; el.parentElement.className = 'member-voice ' + (enabled ? 'on' : 'off'); }
  });
}

async function checkHealth() {
  try {
    const res = await fetch(SERVER_URL + '/health', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    console.log('Health OK:', data);
    return true;
  } catch (err) {
    console.warn('Health check failed:', err.message);
    return false;
  }
}

function cleanup() {
  if (state.locationWatchId !== null) { navigator.geolocation.clearWatch(state.locationWatchId); state.locationWatchId = null; }
  if (state.focusInterval) clearInterval(state.focusInterval);
  if (state.myStream) { state.myStream.getTracks().forEach((t) => t.stop()); state.myStream = null; }
  Object.keys(state.peers).forEach(destroyPeer);
  if (state.map) {
    Object.keys(state.markers).forEach((k) => { if (state.markers[k] && state.markers[k]._map) state.map.removeLayer(state.markers[k]); });
    state.map.remove();
    state.map = null;
  }
  state.markers = {};
  state.members = {};
  state.roomCode = null;
  state.ownerId = null;
  state.mutedUsers = [];
  state.voiceEnabled = false;
  state.locationEnabled = false;
}

document.addEventListener('DOMContentLoaded', function () {
  cacheDom();

  dom.createBtn.addEventListener('click', () => {
    state.username = dom.usernameInput.value.trim() || 'مجهول';
    dom.homeError.textContent = '';
    if (!state.socket.connected) { dom.homeError.textContent = 'غير متصل. يرجى الانتظار...'; return; }
    dom.createBtn.disabled = true;
    dom.createBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإنشاء...';
    state.socket.emit('create-room', { username: state.username }, (res) => {
      dom.createBtn.disabled = false;
      dom.createBtn.innerHTML = '<i class="fas fa-plus-circle"></i> إنشاء غرفة';
      if (res && res.roomCode) {
        state.roomCode = res.roomCode;
        dom.roomCodeDisplay.textContent = res.roomCode;
        showView('room');
        addSystemMsg('تم إنشاء الغرفة: ' + res.roomCode);
        initMap();
        startLocation();
      } else {
        dom.homeError.textContent = 'فشل إنشاء الغرفة. حاول مرة أخرى.';
      }
    });
  });

  dom.joinBtn.addEventListener('click', () => {
    const roomCode = dom.roomInput.value.trim();
    if (!roomCode || roomCode.length < 3) { dom.homeError.textContent = 'يرجى إدخال رمز غرفة صالح'; return; }
    state.username = dom.usernameInput.value.trim() || 'مجهول';
    dom.homeError.textContent = '';
    if (!state.socket.connected) { dom.homeError.textContent = 'غير متصل. يرجى الانتظار...'; return; }
    dom.joinBtn.disabled = true;
    dom.joinBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الانضمام...';
    state.socket.emit('join-room', { roomCode, username: state.username }, (res) => {
      dom.joinBtn.disabled = false;
      dom.joinBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> انضمام';
      if (res && res.success) {
        state.roomCode = res.roomCode;
        state.ownerId = res.ownerId;
        dom.roomCodeDisplay.textContent = res.roomCode;
        showView('room');
        addSystemMsg('تم الانضمام للغرفة: ' + res.roomCode);
        res.users.forEach((u) => { if (u.id !== state.myId) state.members[u.id] = { id: u.id, lat: u.lat, lng: u.lng, username: u.username }; });
        renderMembers();
        dom.memberCount.innerHTML = '<i class="fas fa-user"></i> ' + res.users.length;
        initMap();
        startLocation();
      } else {
        dom.homeError.textContent = (res && res.message) || 'الغرفة غير موجودة';
      }
    });
  });

  dom.roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') dom.joinBtn.click(); });
  dom.chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
  dom.chatSendBtn.addEventListener('click', sendChat);
  dom.mapFocusBtn.addEventListener('click', fitMapToMarkers);
  dom.locationBtn.addEventListener('click', () => { if (state.locationEnabled) stopLocation(); else startLocation(); });

  dom.voiceBtn.addEventListener('click', async () => {
    if (state.voiceEnabled) {
      if (state.myStream) { state.myStream.getTracks().forEach((t) => t.stop()); state.myStream = null; }
      state.voiceEnabled = false;
      dom.voiceBtn.classList.remove('recording');
      dom.voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
      Object.keys(state.peers).forEach(destroyPeer);
      if (state.roomCode) state.socket.emit('voice-toggle', { roomCode: state.roomCode, enabled: false });
    } else {
      try {
        state.myStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        state.voiceEnabled = true;
        dom.voiceBtn.classList.add('recording');
        dom.voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        Object.keys(state.members).forEach((uid) => { if (uid !== state.myId) initVoicePeer(uid, true); });
        if (state.roomCode) state.socket.emit('voice-toggle', { roomCode: state.roomCode, enabled: true });
      } catch (err) { toast('تعذر الوصول إلى الميكروفون', 'error'); }
    }
  });

  dom.shareBtn.addEventListener('click', () => {
    if (!state.roomCode) return;
    const text = 'Join my Fada room! Code: ' + state.roomCode + '\n' + window.location.origin;
    if (navigator.share) { navigator.share({ title: 'غرفة Fada', text }).catch(() => {}); }
    else { navigator.clipboard.writeText(state.roomCode).then(() => toast('تم نسخ رمز الغرفة!', 'success')).catch(() => toast('الغرفة: ' + state.roomCode, 'info')); }
  });

  dom.leaveBtn.addEventListener('click', () => {
    if (state.roomCode) state.socket.emit('leave-room', { roomCode: state.roomCode });
    cleanup();
    dom.messages.innerHTML = '<div class="msg-placeholder"><i class="fas fa-comments"></i><p>لا توجد رسائل بعد. ابدأ المحادثة!</p></div>';
    dom.membersList.innerHTML = '<div class="msg-placeholder"><i class="fas fa-users"></i><p>في انتظار الأعضاء...</p></div>';
    showView('home');
    dom.homeError.textContent = '';
    dom.roomInput.value = '';
  });

  dom.navTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      dom.navTabs.forEach((t) => t.classList.remove('active'));
      dom.tabContents.forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'map' && state.map) {
        setTimeout(() => state.map.invalidateSize(), 100);
      }
    });
  });

  checkHealth().then((ok) => {
    if (!ok) { dom.homeError.textContent = 'الخادم غير متاح على ' + SERVER_URL; setConnStatus('disconnected'); }
  });

  connectSocket();
  console.log('Fada loaded.');
});
