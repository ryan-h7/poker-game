export class NetworkClient {
  constructor({ onLobby, onGameState, onError, onKicked, onPublicRooms }) {
    this.onLobby = onLobby;
    this.onGameState = onGameState;
    this.onError = onError;
    this.onKicked = onKicked;
    this.onPublicRooms = onPublicRooms;
    this.socket = null;
    this.roomId = null;
    this.inviteLink = null;
    this.memberToken = null;
    this.isHost = false;
    this.seatIndex = 0;
    this.connected = false;
  }

  connect() {
    if (this.socket) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (typeof io === 'undefined') {
        reject(new Error('Multiplayer server not available. Run: npm start'));
        return;
      }
      this.socket = io({ transports: ['websocket', 'polling'] });
      this.socket.on('connect', () => {
        this.connected = true;
        resolve();
      });
      this.socket.on('connect_error', () => {
        reject(new Error('Could not connect to game server. Run: npm start'));
      });
      this.socket.on('public-rooms', (data) => {
        if (data?.rooms) this.onPublicRooms?.(data.rooms);
      });
      this.socket.on('lobby-state', (state) => {
        this.roomId = state.roomId;
        this.isHost = state.isHost;
        this.inviteLink = state.inviteLink;
        this.onLobby?.(state);
      });
      this.socket.on('game-state', (state) => {
        this.roomId = state.roomId;
        this.isHost = state.isHost;
        this.seatIndex = state.localSeatIndex;
        this.onGameState?.(state);
      });
      this.socket.on('kicked', (payload) => {
        this.resetLocalSession();
        this.onKicked?.(payload?.reason || 'Removed from the table.');
      });
    });
  }

  resetLocalSession() {
    this.roomId = null;
    this.inviteLink = null;
    this.memberToken = null;
    this.isHost = false;
    clearRoomSession();
  }

  emit(event, data) {
    return new Promise((resolve) => {
      if (!this.socket?.connected) {
        resolve({ ok: false, error: 'Not connected.' });
        return;
      }
      this.socket.emit(event, data, (res) => resolve(res ?? { ok: true }));
    });
  }

  async createRoom(name, settings) {
    await this.connect();
    const res = await this.emit('create-room', { name, settings });
    if (!res.ok) throw new Error(res.error || 'Could not create room.');
    this.roomId = res.roomId;
    this.isHost = res.isHost;
    this.seatIndex = res.seatIndex;
    this.inviteLink = res.inviteLink;
    this.memberToken = res.memberToken;
    saveRoomSession({ roomId: res.roomId, memberToken: res.memberToken, name });
    return res;
  }

  async joinRoom(roomId, name, memberToken = null) {
    await this.connect();
    const res = await this.emit('join-room', { roomId, name, memberToken });
    if (!res.ok) throw new Error(res.error || 'Could not join room.');
    this.roomId = res.roomId;
    this.isHost = res.isHost;
    this.seatIndex = res.seatIndex;
    this.inviteLink = res.inviteLink;
    this.memberToken = res.memberToken;
    saveRoomSession({ roomId: res.roomId, memberToken: res.memberToken, name });
    return res;
  }

  async reconnectRoom(roomId, name, memberToken) {
    return this.joinRoom(roomId, name, memberToken);
  }

  transferHost(targetSocketId) {
    return this.emit('transfer-host', { targetSocketId });
  }

  kickPlayer(targetMemberId) {
    return this.emit('kick-player', { targetMemberId });
  }

  updateSettings(settings) {
    return this.emit('update-settings', settings);
  }

  startHand() {
    return this.emit('start-hand');
  }

  sendAction(action, amount = 0) {
    return this.emit('player-action', { action, amount });
  }

  rebuy() {
    return this.emit('rebuy');
  }

  async fetchPublicRooms() {
    try {
      const res = await fetch('/api/public-rooms');
      const data = await res.json().catch(() => ({}));
      return data.ok ? data.rooms : [];
    } catch {
      return [];
    }
  }

  leaveRoom() {
    if (this.socket) this.socket.emit('leave-room');
    this.resetLocalSession();
  }

  disconnect() {
    this.leaveRoom();
    this.socket?.disconnect();
    this.socket = null;
    this.connected = false;
  }
}

export function normalizeRoomCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function getRoomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('room')?.trim().toUpperCase() || null;
}

export function clearRoomFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('room');
  window.history.replaceState({}, '', url.pathname + url.search);
}

const ROOM_SESSION_KEY = 'poker-room-session';

export function saveRoomSession({ roomId, memberToken, name }) {
  if (!roomId || !memberToken) return;
  try {
    sessionStorage.setItem(ROOM_SESSION_KEY, JSON.stringify({
      roomId,
      memberToken,
      name: String(name || 'Player').trim().slice(0, 16) || 'Player',
    }));
  } catch { /* ignore */ }
}

export function loadRoomSession() {
  try {
    const raw = sessionStorage.getItem(ROOM_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.roomId || !session?.memberToken) return null;
    return session;
  } catch {
    return null;
  }
}

export function clearRoomSession() {
  try { sessionStorage.removeItem(ROOM_SESSION_KEY); } catch { /* ignore */ }
}

const SOLO_STATE_KEY = 'poker-solo-state';

export function saveSoloState(state) {
  if (!state) return;
  try {
    sessionStorage.setItem(SOLO_STATE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

export function loadSoloState() {
  try {
    const raw = sessionStorage.getItem(SOLO_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSoloState() {
  try { sessionStorage.removeItem(SOLO_STATE_KEY); } catch { /* ignore */ }
}
