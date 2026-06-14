/* ====== STATE ====== */
const state = {
  socket: null,
  username: '',
  roomCode: null,
  myId: null,
  members: {},
  peers: {},
  myStream: null,
  locationWatchId: null,
  myLat: null,
  myLng: null,
  locationEnabled: false,
  voiceEnabled: false,
  map: null,
  markers: {},
  focusInterval: null,
};

const COLORS = [
  '#7c3aed', '#06b6d4', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6',
  '#f97316', '#3b82f6', '#84cc16', '#e11d48',
];

/* ====== DOM REFS ====== */
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
  dom.tabs = $$('.tab');
  dom.tabContents = $$('.tab-content');
  dom.voiceBtn = $('#voice-btn');
  dom.locationBtn = $('#location-btn');
  dom.mapContainer = $('#map');
  dom.mapFocusBtn = $('#map-focus-btn');
  dom.toastContainer = $('#toast-container');
}

/* ====== CONNECTION STATUS ====== */
function setConnStatus(status, detail) {
  const dot = $('#conn-dot');
  const text = $('#conn-text');
  const err = $('#home-error');
  dot.className = 'conn-dot ' + status;
  const labels = { connected: 'Connected', connecting: 'Connecting...', disconnected: 'Disconnected' };
  text.textContent = labels[status] || status;
  if (detail && status === 'disconnected') {
    err.textContent = detail;
  }
}

/* ====== SOCKET ====== */
function connectSocket() {
  const serverUrl = window.location.origin;
  console.log('Connecting to server:', serverUrl);

  setConnStatus('connecting');
  $('#conn-text').textContent = 'Connecting to ' + serverUrl + '...';

  state.socket = io(serverUrl, {
    transports: ['polling', 'websocket'],
    upgrade: false,
    rememberUpgrade: true,
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    timeout: 20000
  });

  state.socket.on('connect', () => {
    state.myId = state.socket.id;
    setConnStatus('connected');
    dom.homeError.textContent = '';
    console.log('Socket connected:', state.myId);
  });

  state.socket.on('disconnect', (reason) => {
    setConnStatus('disconnected', 'Connection lost: ' + reason);
    console.log('Socket disconnected:', reason);
  });

  state.socket.on('connect_error', (err) => {
    const msg = err.message;
    setConnStatus('connecting');
    dom.homeError.textContent = 'Server unreachable: ' + msg;
    console.error('Socket error:', msg);
  });

  state.socket.on('reconnect_attempt', (attempt) => {
    setConnStatus('connecting');
    dom.homeError.textContent = 'Reconnecting (attempt ' + attempt + ')...';
  });

  state.socket.on('reconnect', () => {
    setConnStatus('connected');
    dom.homeError.textContent = '';
  });

  state.socket.on('reconnect_error', (err) => {
    dom.homeError.textContent = 'Reconnect failed: ' + err.message;
  });

  state.socket.on('reconnect_failed', () => {
    setConnStatus('disconnected', 'Could not reconnect to server. Refresh the page.');
  });

  state.socket.on('room-created', ({ roomCode }) => {
    state.roomCode = roomCode;
    dom.roomCodeDisplay.textContent = roomCode;
    showView('room');
    addSystemMsg(`Room created: ${roomCode}`);
    initMap();
    startLocation();
  });

  state.socket.on('room-joined', ({ roomCode }) => {
    state.roomCode = roomCode;
    dom.roomCodeDisplay.textContent = roomCode;
    showView('room');
    addSystemMsg(`Joined room ${roomCode}`);
    initMap();
    startLocation();
  });

  state.socket.on('users-update', (users) => {
    const prevIds = new Set(Object.keys(state.members));
    const newIds = new Set(users.map((u) => u.id));
    state.members = {};
    users.forEach((u) => {
      state.members[u.id] = { id: u.id, lat: u.lat, lng: u.lng };
    });
    renderMembers();
    dom.memberCount.innerHTML = `<i class="fas fa-user"></i> ${users.length}`;
  });

  state.socket.on('user-joined', ({ userId }) => {
    initVoicePeer(userId, true);
  });

  state.socket.on('user-left', ({ userId }) => {
    if (state.markers[userId]) {
      state.map.removeLayer(state.markers[userId]);
      delete state.markers[userId];
    }
    destroyPeer(userId);
  });

  state.socket.on('chat-message', (data) => {
    addChatMsg(data);
  });

  state.socket.on('location-update', ({ userId, lat, lng }) => {
    updateMarker(userId, lat, lng);
    if (state.members[userId]) {
      state.members[userId].lat = lat;
      state.members[userId].lng = lng;
    }
  });

  state.socket.on('signal', ({ signal, from }) => {
    handleSignal(from, signal);
  });

  state.socket.on('voice-toggle', ({ userId, enabled }) => {
    const el = document.querySelector(`[data-uid="${userId}"] .member-voice i`);
    if (el) {
      el.className = enabled ? 'fas fa-fw fa-microphone' : 'fas fa-fw fa-microphone-slash';
      el.parentElement.className = `member-voice ${enabled ? 'on' : 'off'}`;
    }
  });

}

/* ====== VIEW MANAGEMENT ====== */
function showView(name) {
  dom.homeView.classList.toggle('active', name === 'home');
  dom.roomView.classList.toggle('active', name === 'room');
}

/* ====== TOAST ====== */
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { info: 'fa-info-circle', success: 'fa-check-circle', error: 'fa-exclamation-circle' };
  el.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i> ${msg}`;
  dom.toastContainer.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(40px)'; el.style.transition = 'all 0.3s'; }, 3000);
  setTimeout(() => el.remove(), 3500);
}

/* ====== ROOM CREATION & JOINING ====== */
function getUsername() {
  const name = dom.usernameInput.value.trim();
  return name || 'Anonymous';
}

document.addEventListener('DOMContentLoaded', function () {
  cacheDom();

  if (!dom.createBtn) {
    console.error('FATAL: #create-btn not found. DOM may not be ready.');
    return;
  }

dom.createBtn.addEventListener('click', () => {
  state.username = getUsername();
  dom.homeError.textContent = '';
  if (!state.socket.connected) {
    dom.homeError.textContent = 'Not connected to server. Please wait...';
    return;
  }
  dom.createBtn.disabled = true;
  dom.createBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
  state.socket.emit('create-room', (res) => {
    dom.createBtn.disabled = false;
    dom.createBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Create Room';
    if (res && res.roomCode) {
      state.roomCode = res.roomCode;
      dom.roomCodeDisplay.textContent = res.roomCode;
      showView('room');
      addSystemMsg(`Room created: ${res.roomCode}`);
      initMap();
      startLocation();
    } else {
      dom.homeError.textContent = 'Failed to create room. Try again.';
    }
  });
});

dom.joinBtn.addEventListener('click', () => {
  const roomCode = dom.roomInput.value.trim();
  if (!roomCode || roomCode.length < 4) {
    dom.homeError.textContent = 'Please enter a valid room code';
    return;
  }
  state.username = getUsername();
  dom.homeError.textContent = '';
  if (!state.socket.connected) {
    dom.homeError.textContent = 'Not connected to server. Please wait...';
    return;
  }
  dom.joinBtn.disabled = true;
  dom.joinBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Joining...';
  state.socket.emit('join-room', { roomCode }, (res) => {
    dom.joinBtn.disabled = false;
    dom.joinBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Join';
    if (res && res.success) {
      state.roomCode = res.roomCode;
      dom.roomCodeDisplay.textContent = res.roomCode;
      showView('room');
      addSystemMsg(`Joined room ${res.roomCode}`);
      res.users.forEach((u) => {
        if (u.id !== state.myId) {
          state.members[u.id] = { id: u.id, lat: u.lat, lng: u.lng };
        }
      });
      renderMembers();
      dom.memberCount.innerHTML = `<i class="fas fa-user"></i> ${res.users.length}`;
      initMap();
      startLocation();
    } else {
      dom.homeError.textContent = (res && res.message) || 'Room not found';
    }
  });
});

dom.roomInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') dom.joinBtn.click();
});

dom.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

/* ====== CHAT ====== */
function sendChat() {
  const text = dom.chatInput.value.trim();
  if (!text || !state.roomCode) return;
  state.socket.emit('chat-message', {
    roomCode: state.roomCode,
    message: text,
    username: state.username,
  });
  dom.chatInput.value = '';
}

dom.chatSendBtn.addEventListener('click', sendChat);

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
    div.className = `msg ${isOwn ? 'msg-own' : 'msg-other'}`;
    const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `
      ${isOwn ? '' : `<div class="msg-username">${escapeHtml(data.username)}</div>`}
      <div class="msg-bubble">${escapeHtml(data.message)}</div>
      <div class="msg-time">${time}</div>
    `;
    dom.messages.appendChild(div);
  }
  dom.messages.scrollTop = dom.messages.scrollHeight;
}

function addSystemMsg(text) {
  addChatMsg({ type: 'system', message: text, timestamp: Date.now() });
}

/* ====== MEMBERS ====== */
function renderMembers() {
  const list = dom.membersList;
  const entries = Object.values(state.members);
  if (entries.length === 0) {
    list.innerHTML = '<div class="msg-placeholder"><i class="fas fa-users"></i><p>Waiting for members...</p></div>';
    return;
  }
  list.innerHTML = entries.map((m) => {
    const isMe = m.id === state.myId;
    const colorIdx = hashId(m.id) % COLORS.length;
    const initial = m.username ? m.username[0].toUpperCase() : '?';
    return `
      <div class="member-item" data-uid="${m.id}">
        <div class="member-avatar" style="background:${COLORS[colorIdx]}">${isMe ? state.username[0].toUpperCase() || '?' : initial}</div>
        <div class="member-info">
          <div class="member-name">${isMe ? state.username + ' (you)' : m.username || 'Anonymous'}</div>
          <div class="member-status">${m.lat ? '<i class="fas fa-map-pin"></i> Location shared' : '<i class="fas fa-map-pin"></i> No location'}</div>
        </div>
        <div class="member-voice off"><i class="fas fa-fw fa-microphone-slash"></i></div>
      </div>
    `;
  }).join('');
}

/* ====== MAP ====== */
function initMap() {
  if (state.map) {
    state.map.invalidateSize();
    return;
  }

  state.map = L.map(dom.mapContainer, {
    center: [20, 0],
    zoom: 2,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(state.map);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: '&copy; Esri',
  }).addTo(state.map);

  setTimeout(() => state.map.invalidateSize(), 100);
  setTimeout(() => state.map.invalidateSize(), 500);
}

function updateMarker(userId, lat, lng) {
  if (state.markers[userId]) {
    state.markers[userId].setLatLng([lat, lng]);
    return;
  }

  const colorIdx = hashId(userId) % COLORS.length;
  const color = COLORS[colorIdx];
  const isMe = userId === state.myId;

  const marker = L.circleMarker([lat, lng], {
    radius: isMe ? 10 : 8,
    fillColor: color,
    color: '#fff',
    weight: isMe ? 3 : 2,
    opacity: 1,
    fillOpacity: 0.9,
  }).addTo(state.map);

  const label = state.members[userId]?.username || 'Anonymous';
  marker.bindPopup(`<b>${label}</b><br/>${lat.toFixed(4)}, ${lng.toFixed(4)}`);

  if (isMe) {
    const pulse = L.circleMarker([lat, lng], {
      radius: 20,
      color: color,
      weight: 1,
      opacity: 0.3,
      fillOpacity: 0.1,
    }).addTo(state.map);
    state.markers['pulse'] = pulse;
    animatePulse(pulse, lat, lng, color);
  }

  state.markers[userId] = marker;
  fitMapToMarkers();
}

function animatePulse(pulse, lat, lng, color) {
  let r = 20;
  let growing = true;
  if (state.focusInterval) clearInterval(state.focusInterval);
  state.focusInterval = setInterval(() => {
    if (growing) { r += 0.5; if (r >= 30) growing = false; }
    else { r -= 0.5; if (r <= 15) growing = true; }
    if (pulse._map) {
      pulse.setRadius(r);
      pulse.setStyle({ opacity: 0.4 - (r - 15) / 50 });
    }
  }, 50);
}

function fitMapToMarkers() {
  const markerIds = Object.keys(state.markers).filter((k) => k !== 'pulse');
  if (markerIds.length === 0) return;
  const group = L.featureGroup(markerIds.map((id) => state.markers[id]));
  state.map.fitBounds(group.getBounds().pad(0.1), { maxZoom: 15 });
}

dom.mapFocusBtn.addEventListener('click', fitMapToMarkers);

/* ====== LOCATION ====== */
function startLocation() {
  if (!navigator.geolocation) {
    toast('Geolocation not supported', 'error');
    return;
  }

  state.locationEnabled = true;
  dom.locationBtn.classList.add('active');
  dom.locationBtn.innerHTML = '<i class="fas fa-location-dot"></i>';

  navigator.geolocation.getCurrentPosition(
    (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
    () => toast('Could not get location. Check permissions.', 'error'),
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
  if (state.locationWatchId !== null) {
    navigator.geolocation.clearWatch(state.locationWatchId);
    state.locationWatchId = null;
  }
}

function sendLocation(lat, lng) {
  state.myLat = lat;
  state.myLng = lng;
  updateMarker(state.myId, lat, lng);
  state.socket.emit('location-update', {
    roomCode: state.roomCode,
    lat,
    lng,
  });
}

dom.locationBtn.addEventListener('click', () => {
  if (state.locationEnabled) stopLocation();
  else startLocation();
});

/* ====== VOICE (WebRTC via SimplePeer) ====== */
async function initVoicePeer(userId, initiator) {
  if (userId === state.myId) return;
  if (state.peers[userId]) return;

  try {
    if (!state.myStream) {
      state.myStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      state.voiceEnabled = true;
      dom.voiceBtn.classList.add('active');
      dom.voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    }

    const peer = new SimplePeer({
      initiator,
      stream: state.myStream,
      trickle: false,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    });

    peer.on('signal', (signal) => {
      state.socket.emit('signal', {
        roomCode: state.roomCode,
        signal,
        to: userId,
      });
    });

    peer.on('stream', (remoteStream) => {
      const audio = document.createElement('audio');
      audio.srcObject = remoteStream;
      audio.autoplay = true;
      audio.controls = false;
      audio.style.display = 'none';
      document.body.appendChild(audio);
      peer._audioEl = audio;
    });

    peer.on('error', () => {
      destroyPeer(userId);
    });

    peer.on('close', () => {
      destroyPeer(userId);
    });

    state.peers[userId] = peer;
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      toast('Microphone access denied', 'error');
    } else if (err.name === 'NotFoundError') {
      toast('No microphone found', 'error');
    } else {
      toast('Voice unavailable', 'error');
    }
  }
}

function handleSignal(from, signal) {
  if (from === state.myId) return;
  if (!state.peers[from]) {
    initVoicePeer(from, false);
  }
  if (state.peers[from]) {
    try {
      state.peers[from].signal(signal);
    } catch (e) {
      // peer might already be destroyed
    }
  }
}

function destroyPeer(userId) {
  if (state.peers[userId]) {
    try {
      if (state.peers[userId]._audioEl) state.peers[userId]._audioEl.remove();
      state.peers[userId].destroy();
    } catch (e) {}
    delete state.peers[userId];
  }
}

dom.voiceBtn.addEventListener('click', async () => {
  if (state.voiceEnabled) {
    if (state.myStream) {
      state.myStream.getTracks().forEach((t) => t.stop());
      state.myStream = null;
    }
    state.voiceEnabled = false;
    dom.voiceBtn.classList.remove('active');
    dom.voiceBtn.classList.remove('danger');
    dom.voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    Object.keys(state.peers).forEach(destroyPeer);
    if (state.roomCode) {
      state.socket.emit('voice-toggle', { roomCode: state.roomCode, enabled: false });
    }
  } else {
    try {
      state.myStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      state.voiceEnabled = true;
      dom.voiceBtn.classList.add('active');
      dom.voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
      // Re-init peers
      Object.keys(state.members).forEach((uid) => {
        if (uid !== state.myId) initVoicePeer(uid, true);
      });
      if (state.roomCode) {
        state.socket.emit('voice-toggle', { roomCode: state.roomCode, enabled: true });
      }
    } catch (err) {
      toast('Could not access microphone', 'error');
    }
  }
});

/* ====== SHARE ====== */
dom.shareBtn.addEventListener('click', () => {
  if (!state.roomCode) return;
  const shareText = `Join my Fada room! Room code: ${state.roomCode}\nConnect at: ${window.location.origin}`;
  if (navigator.share) {
    navigator.share({ title: 'Fada Room', text: shareText }).catch(() => {});
  } else {
    navigator.clipboard.writeText(state.roomCode).then(() => {
      toast('Room code copied!', 'success');
    }).catch(() => {
      toast(`Room code: ${state.roomCode}`, 'info');
    });
  }
});

/* ====== LEAVE ====== */
dom.leaveBtn.addEventListener('click', () => {
  if (state.roomCode) {
    state.socket.emit('leave-room', { roomCode: state.roomCode });
  }
  if (state.myStream) {
    state.myStream.getTracks().forEach((t) => t.stop());
    state.myStream = null;
  }
  Object.keys(state.peers).forEach(destroyPeer);
  if (state.locationWatchId !== null) {
    navigator.geolocation.clearWatch(state.locationWatchId);
    state.locationWatchId = null;
  }
  if (state.focusInterval) clearInterval(state.focusInterval);
  if (state.map) {
    Object.keys(state.markers).forEach((k) => {
      if (state.markers[k] && state.markers[k]._map) state.map.removeLayer(state.markers[k]);
    });
    state.map.remove();
    state.map = null;
  }
  state.markers = {};
  state.members = {};
  state.roomCode = null;
  state.voiceEnabled = false;
  state.locationEnabled = false;
  dom.messages.innerHTML = '<div class="msg-placeholder"><i class="fas fa-comments"></i><p>No messages yet. Start the conversation!</p></div>';
  showView('home');
  dom.homeError.textContent = '';
  dom.roomInput.value = '';
});

/* ====== TABS ====== */
dom.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    dom.tabs.forEach((t) => t.classList.remove('active'));
    dom.tabContents.forEach((c) => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

/* ====== UTILITIES ====== */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function hashId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    const chr = id.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return Math.abs(hash);
}

/* ====== HEALTH CHECK ====== */
async function checkHealth() {
  try {
    const res = await fetch(window.location.origin + '/health', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    console.log('Health check OK:', data);
    return true;
  } catch (err) {
    console.warn('Health check failed:', err.message);
    return false;
  }
}

/* ====== BOOT ====== */
checkHealth().then((ok) => {
  if (!ok) {
    dom.homeError.textContent = '⚠ Server unreachable at ' + window.location.origin + ' — is your Node.js server running?';
    setConnStatus('disconnected', 'Server not responding');
  }
});
connectSocket();
console.log('🚀 Fada loaded. Connect in space.');

}); // end DOMContentLoaded
