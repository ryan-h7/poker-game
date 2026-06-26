import { PokerGame } from '../js/game.js';

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeRoomId() {
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  }
  return id;
}

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
  }

  create(socket, name) {
    const roomId = makeRoomId();
    const room = new Room(roomId, socket.id, this.io);
    this.rooms.set(roomId, room);
    room.addMember(socket, name, true);
    return room;
  }

  get(roomId) {
    return this.rooms.get(String(roomId || '').toUpperCase()) || null;
  }

  removeIfEmpty(roomId) {
    const room = this.get(roomId);
    if (room && room.members.size === 0) {
      this.rooms.delete(roomId);
    }
  }
}

class Room {
  constructor(id, hostId, io) {
    this.id = id;
    this.hostId = hostId;
    this.io = io;
    this.members = new Map();
    this.status = 'lobby';
    this.settings = { playerCount: 4, bigBlind: 20 };
    this.game = null;
    this.message = 'Waiting for players…';
  }

  addMember(socket, name, isHost = false) {
    const displayName = String(name || 'Player').trim().slice(0, 16) || 'Player';
    if (this.members.size >= 6) return { ok: false, error: 'Room is full.' };
    if (this.status !== 'lobby') return { ok: false, error: 'Game already in progress.' };

    const seatIndex = this.members.size;
    const member = {
      id: socket.id,
      name: displayName,
      seatIndex,
      isHost: isHost || socket.id === this.hostId,
    };
    this.members.set(socket.id, member);
    socket.join(this.id);
    socket.data.roomId = this.id;
    socket.data.seatIndex = seatIndex;
    if (isHost) this.hostId = socket.id;

    this.message = `${displayName} joined the table.`;
    this.broadcastLobby();
    return { ok: true, roomId: this.id, seatIndex, isHost: member.isHost };
  }

  removeMember(socketId) {
    const member = this.members.get(socketId);
    if (!member) return;

    this.members.delete(socketId);
    if (this.members.size === 0) return;

    if (socketId === this.hostId) {
      this.hostId = this.members.keys().next().value;
      const newHost = this.members.get(this.hostId);
      if (newHost) newHost.isHost = true;
    }

    if (this.status === 'lobby') {
      let i = 0;
      for (const m of this.members.values()) {
        m.seatIndex = i++;
      }
      this.message = `${member.name} left the table.`;
      this.broadcastLobby();
      return;
    }

    if (this.game) {
      const seat = member.seatIndex;
      const player = this.game.players[seat];
      if (player && this.game.phase !== 'idle' && this.game.phase !== 'showdown' && !player.folded) {
        this.game.applyAction(player, 'fold');
        this.game.handHistory.push(`${player.name} disconnected (folded)`);
        this.game.actedThisRound.add(seat);
        this.game.afterAction();
      }
      this.message = `${member.name} left the table.`;
      this.broadcastGameState();
    }
  }

  updateSettings(socketId, settings) {
    if (socketId !== this.hostId || this.status !== 'lobby') return false;
    const playerCount = Math.max(2, Math.min(6, parseInt(settings.playerCount, 10) || 4));
    const bigBlind = parseInt(settings.bigBlind, 10) || 20;
    this.settings.playerCount = playerCount;
    this.settings.bigBlind = bigBlind;
    if (this.members.size > playerCount) return false;
    this.broadcastLobby();
    return true;
  }

  startHand(socketId) {
    if (socketId !== this.hostId) return { ok: false, error: 'Only the host can deal.' };
    if (this.members.size < 2) return { ok: false, error: 'Need at least 2 players to start.' };
    if (this.game && this.game.phase !== 'idle' && this.game.phase !== 'showdown') {
      return { ok: false, error: 'Hand already in progress.' };
    }

    this.status = 'playing';
    this.ensureGame();
    this.game.startNewHand();
    this.message = this.game._lastMessage || 'New hand dealt.';
    this.broadcastGameState();
    return { ok: true };
  }

  ensureGame() {
    if (this.game) {
      this.syncGamePlayers();
      return;
    }

    const onUpdate = () => this.broadcastGameState();
    const onMessage = (msg) => {
      this.message = msg;
      this.game._lastMessage = msg;
    };

    this.game = new PokerGame(onUpdate, onMessage);
    this.game.serverMode = true;
    this.game.onlineMode = true;
    this.game.playerCount = this.settings.playerCount;
    this.game.bigBlind = this.settings.bigBlind;
    this.game.minRaise = this.settings.bigBlind;
    this.syncGamePlayers();
  }

  syncGamePlayers() {
    const members = [...this.members.values()].sort((a, b) => a.seatIndex - b.seatIndex);
    this.game.setOnlinePlayers(members, this.settings.playerCount);
    this.game.bigBlind = this.settings.bigBlind;
    this.game.minRaise = this.settings.bigBlind;
  }

  handleAction(socketId, action, amount = 0) {
    if (!this.game || this.status !== 'playing') return { ok: false, error: 'No active hand.' };
    const member = this.members.get(socketId);
    if (!member) return { ok: false, error: 'Not in room.' };

    const seat = member.seatIndex;
    if (this.game.activeIndex !== seat) return { ok: false, error: 'Not your turn.' };

    const player = this.game.players[seat];
    if (!player?.isHuman) return { ok: false, error: 'Not a human seat.' };

    const result = this.game.applyNetworkAction(seat, action, amount);
    if (!result) return { ok: false, error: 'Invalid action.' };

    this.message = this.game._lastMessage || this.message;
    this.broadcastGameState();
    return { ok: true };
  }

  getInviteLink(socket) {
    const host = socket.request.headers.host || 'localhost:3000';
    const proto = socket.request.headers['x-forwarded-proto'] || 'http';
    return `${proto}://${host}/?room=${this.id}`;
  }

  lobbyPayload(forSocketId) {
    return {
      roomId: this.id,
      status: this.status,
      isHost: forSocketId === this.hostId,
      hostId: this.hostId,
      inviteLink: null,
      message: this.message,
      settings: { ...this.settings },
      members: [...this.members.values()].map(m => ({
        id: m.id,
        name: m.name,
        seatIndex: m.seatIndex,
        isHost: m.id === this.hostId,
      })),
    };
  }

  broadcastLobby() {
    for (const [socketId] of this.members) {
      const payload = this.lobbyPayload(socketId);
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) payload.inviteLink = this.getInviteLink(socket);
      this.io.to(socketId).emit('lobby-state', payload);
    }
  }

  broadcastGameState() {
    if (!this.game) return;
    for (const [socketId, member] of this.members) {
      const state = this.game.toNetworkState(member.seatIndex);
      state.roomId = this.id;
      state.status = this.status;
      state.isHost = socketId === this.hostId;
      state.localSeatIndex = member.seatIndex;
      state.message = this.message;
      state.members = [...this.members.values()].map(m => ({
        id: m.id,
        name: m.name,
        seatIndex: m.seatIndex,
        isHost: m.id === this.hostId,
      }));
      this.io.to(socketId).emit('game-state', state);
    }

    if (this.game.phase === 'idle' || this.game.phase === 'showdown') {
      this.status = 'lobby';
      this.broadcastLobby();
    }
  }
}
