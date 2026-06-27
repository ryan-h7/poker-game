export class NetworkClient {
  constructor({ onLobby, onGameState, onError }) {
    this.onLobby = onLobby;
    this.onGameState = onGameState;
    this.onError = onError;
    this.socket = null;
    this.roomId = null;
    this.inviteLink = null;
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
    });
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
    return res;
  }

  async joinRoom(roomId, name) {
    await this.connect();
    const res = await this.emit('join-room', { roomId, name });
    if (!res.ok) throw new Error(res.error || 'Could not join room.');
    this.roomId = res.roomId;
    this.isHost = res.isHost;
    this.seatIndex = res.seatIndex;
    this.inviteLink = res.inviteLink;
    return res;
  }

  transferHost(targetSocketId) {
    return this.emit('transfer-host', { targetSocketId });
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

  leaveRoom() {
    if (this.socket) this.socket.emit('leave-room');
    this.roomId = null;
    this.inviteLink = null;
    this.isHost = false;
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
