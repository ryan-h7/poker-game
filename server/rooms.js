import { randomUUID } from 'crypto';
import { PokerGame } from '../js/game.js';

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_TABLE_SIZE = 8;

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
    const room = new Room(roomId, this.io, (id) => this.removeIfEmpty(id));
    this.rooms.set(roomId, room);
    room.addMember(socket, name, true);
    return room;
  }

  get(roomId) {
    return this.rooms.get(String(roomId || '').toUpperCase()) || null;
  }

  removeIfEmpty(roomId) {
    const room = this.get(roomId);
    if (room && room.membersByToken.size === 0) {
      this.rooms.delete(roomId);
    }
  }
}

class Room {
  constructor(id, io, onEmpty) {
    this.id = id;
    this.hostToken = null;
    this.io = io;
    this.onEmpty = onEmpty;
    this.membersByToken = new Map();
    this.status = 'lobby';
    this.settings = { playerCount: 4, bigBlind: 20, startingStack: 1000 };
    this.game = null;
    this.message = 'Waiting for players…';
    this.disconnectGraceMs = 90_000;
  }

  getMemberBySocket(socketId) {
    for (const member of this.membersByToken.values()) {
      if (member.socketId === socketId) return member;
    }
    return null;
  }

  connectedMemberCount() {
    let n = 0;
    for (const member of this.membersByToken.values()) {
      if (member.socketId) n += 1;
    }
    return n;
  }

  allMembers() {
    return [...this.membersByToken.values()].sort((a, b) => a.seatIndex - b.seatIndex);
  }

  memberPayload(member) {
    return {
      id: member.socketId || member.token,
      name: member.name,
      seatIndex: member.seatIndex,
      isHost: member.token === this.hostToken,
      connected: !!member.socketId,
    };
  }

  reserveSeatForJoin() {
    const n = this.membersByToken.size;
    if (n >= MAX_TABLE_SIZE) {
      return { ok: false, error: 'Table is full.' };
    }

    let playerCount = this.settings.playerCount;

    if (n < playerCount) {
      return { ok: true, seatIndex: n };
    }
    if (playerCount < MAX_TABLE_SIZE) {
      this.settings.playerCount = n + 1;
      return { ok: true, seatIndex: n };
    }
    return { ok: false, error: 'Table is full.' };
  }

  addMember(socket, name, isHost = false, reconnectToken = null) {
    if (reconnectToken) {
      const reconnected = this.reconnectMember(socket, reconnectToken, name);
      if (reconnected) return reconnected;
      return { ok: false, error: 'Could not reconnect. The room may have ended.' };
    }

    const displayName = String(name || 'Player').trim().slice(0, 16) || 'Player';

    if (this.game
      && this.game.phase !== 'idle'
      && this.game.phase !== 'showdown') {
      return { ok: false, error: 'Wait for the current hand to finish before joining.' };
    }

    const seat = this.reserveSeatForJoin();
    if (!seat.ok) return seat;

    const token = randomUUID();
    const member = {
      token,
      socketId: socket.id,
      name: displayName,
      seatIndex: seat.seatIndex,
      disconnectTimer: null,
    };
    this.membersByToken.set(token, member);
    socket.join(this.id);
    socket.data.roomId = this.id;
    socket.data.seatIndex = seat.seatIndex;
    socket.data.memberToken = token;
    if (isHost || !this.hostToken) this.hostToken = token;

    this.message = `${displayName} joined the table.`;
    this.syncTable();
    return {
      ok: true,
      roomId: this.id,
      seatIndex: seat.seatIndex,
      isHost: token === this.hostToken,
      memberToken: token,
    };
  }

  reconnectMember(socket, token, name) {
    const member = this.membersByToken.get(token);
    if (!member) return null;

    if (member.disconnectTimer) {
      clearTimeout(member.disconnectTimer);
      member.disconnectTimer = null;
    }

    const displayName = String(name || member.name || 'Player').trim().slice(0, 16) || member.name;
    member.name = displayName;
    member.socketId = socket.id;
    socket.join(this.id);
    socket.data.roomId = this.id;
    socket.data.seatIndex = member.seatIndex;
    socket.data.memberToken = token;

    this.message = `${displayName} reconnected.`;
    this.syncTable();
    return {
      ok: true,
      roomId: this.id,
      seatIndex: member.seatIndex,
      isHost: token === this.hostToken,
      memberToken: token,
    };
  }

  disconnectMember(socketId) {
    const member = this.getMemberBySocket(socketId);
    if (!member) return;

    member.socketId = null;
    if (member.disconnectTimer) clearTimeout(member.disconnectTimer);
    member.disconnectTimer = setTimeout(() => {
      member.disconnectTimer = null;
      this.removeMemberByToken(member.token, { timedOut: true });
    }, this.disconnectGraceMs);

    this.message = `${member.name} disconnected.`;
    if (this.game) this.broadcastGameState();
    else this.broadcastLobby();
  }

  removeMember(socketId) {
    const member = this.getMemberBySocket(socketId);
    if (!member) return;
    this.removeMemberByToken(member.token);
  }

  removeMemberByToken(token, { timedOut = false } = {}) {
    const member = this.membersByToken.get(token);
    if (!member) return;

    if (member.disconnectTimer) {
      clearTimeout(member.disconnectTimer);
      member.disconnectTimer = null;
    }

    const leftName = member.name;
    const wasHost = token === this.hostToken;
    const seat = member.seatIndex;
    this.membersByToken.delete(token);
    if (this.membersByToken.size === 0) {
      this.onEmpty?.(this.id);
      return;
    }

    if (wasHost) this.transferHost(leftName);
    else this.message = timedOut
      ? `${leftName} timed out and left the table.`
      : `${leftName} left the table.`;

    if (this.status === 'lobby') {
      this.reindexMembers();
      this.syncTable();
      return;
    }

    if (this.game) {
      const player = this.game.players[seat];
      if (player && this.game.phase !== 'idle' && this.game.phase !== 'showdown' && !player.folded) {
        this.game.applyAction(player, 'fold');
        this.game.handHistory.push(timedOut
          ? `${player.name} timed out (folded)`
          : `${player.name} disconnected (folded)`);
        this.game.actedThisRound.add(seat);
        this.game.afterAction();
      } else {
        this.reindexMembers();
        this.syncGamePlayers();
        this.broadcastGameState();
      }
    }
  }

  assignHost(requesterId, targetSocketId) {
    const requester = this.getMemberBySocket(requesterId);
    if (!requester || requester.token !== this.hostToken) {
      return { ok: false, error: 'Only the host can transfer host.' };
    }
    if (targetSocketId === requesterId) {
      return { ok: false, error: 'You are already the host.' };
    }
    const target = this.getMemberBySocket(targetSocketId);
    if (!target) return { ok: false, error: 'Player not in room.' };
    if (this.game && !this.canChangeSettings()) {
      return { ok: false, error: 'Wait for the current hand to finish.' };
    }

    this.hostToken = target.token;
    const fromName = requester.name || 'Host';
    this.message = `${fromName} made ${target.name} the host.`;
    this.syncTable();
    return { ok: true };
  }

  transferHost(leftName) {
    const sorted = this.allMembers();
    const newHost = sorted[0];
    if (!newHost) return;
    this.hostToken = newHost.token;
    this.message = `${leftName} left. ${newHost.name} is now the host.`;
  }

  reindexMembers() {
    const members = this.allMembers();
    members.forEach((member, i) => {
      member.seatIndex = i;
    });
  }

  canChangeSettings() {
    if (!this.game) return true;
    return this.game.phase === 'idle' || this.game.phase === 'showdown';
  }

  updateSettings(socketId, settings) {
    const member = this.getMemberBySocket(socketId);
    if (!member || member.token !== this.hostToken || !this.canChangeSettings()) return false;
    const humanCount = this.membersByToken.size;
    let playerCount = parseInt(settings.playerCount, 10) || 4;
    playerCount = Math.max(2, Math.min(MAX_TABLE_SIZE, playerCount));
    if (playerCount < humanCount) return false;
    const bigBlind = parseInt(settings.bigBlind, 10) || 20;
    const startingStack = Math.max(100, Math.min(100000, parseInt(settings.startingStack, 10) || 1000));
    this.settings.playerCount = playerCount;
    this.settings.bigBlind = bigBlind;
    this.settings.startingStack = startingStack;
    if (this.game) {
      this.game.startingStack = startingStack;
      this.syncGamePlayers();
      if (this.status === 'lobby') {
        for (const p of this.game.players) p.chips = startingStack;
      }
    }
    this.syncTable();
    return true;
  }

  startHand(socketId) {
    const member = this.getMemberBySocket(socketId);
    if (!member || member.token !== this.hostToken) {
      return { ok: false, error: 'Only the host can deal.' };
    }
    if (this.connectedMemberCount() < 2) {
      return { ok: false, error: 'Need at least 2 players to start.' };
    }
    if (this.game && this.game.phase !== 'idle' && this.game.phase !== 'showdown') {
      return { ok: false, error: 'Hand already in progress.' };
    }

    this.status = 'active';
    this.ensureGame();
    this.syncGamePlayers();
    this.game.startNewHand();
    this.message = this.game._lastMessage || 'New hand dealt.';
    this.broadcastGameState();
    return { ok: true };
  }

  ensureGame() {
    if (this.game) return;

    const onUpdate = () => this.broadcastGameState();
    const onMessage = (msg) => {
      this.message = msg;
      this.game._lastMessage = msg;
    };

    this.game = new PokerGame(onUpdate, onMessage);
    this.game.serverMode = true;
    this.game.onlineMode = true;
    this.game.showBotHandsAtEnd = false;
    this.game.playerCount = this.settings.playerCount;
    this.game.bigBlind = this.settings.bigBlind;
    this.game.startingStack = this.settings.startingStack;
    this.game.minRaise = this.settings.bigBlind;
  }

  syncGamePlayers() {
    if (!this.game) return;
    const members = this.allMembers();
    this.game.startingStack = this.settings.startingStack;
    this.game.setOnlinePlayers(members, this.settings.playerCount, this.status === 'lobby');
    this.game.bigBlind = this.settings.bigBlind;
    this.game.minRaise = this.settings.bigBlind;
    if (this.status === 'lobby') {
      for (const p of this.game.players) p.chips = this.settings.startingStack;
    }
  }

  syncTable() {
    if (this.game) {
      this.syncGamePlayers();
      this.broadcastGameState();
    } else {
      this.broadcastLobby();
    }
  }

  handleAction(socketId, action, amount = 0) {
    if (!this.game || this.status === 'lobby') return { ok: false, error: 'No active hand.' };
    const member = this.getMemberBySocket(socketId);
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
    const forMember = this.getMemberBySocket(forSocketId);
    const hostMember = this.allMembers().find(m => m.token === this.hostToken);
    return {
      roomId: this.id,
      status: this.status,
      isHost: forMember?.token === this.hostToken,
      hostId: hostMember?.socketId ?? null,
      inviteLink: null,
      message: this.message,
      settings: { ...this.settings },
      members: this.allMembers().map(m => this.memberPayload(m)),
    };
  }

  broadcastLobby() {
    for (const member of this.membersByToken.values()) {
      if (!member.socketId) continue;
      const payload = this.lobbyPayload(member.socketId);
      const socket = this.io.sockets.sockets.get(member.socketId);
      if (socket) payload.inviteLink = this.getInviteLink(socket);
      this.io.to(member.socketId).emit('lobby-state', payload);
    }
  }

  broadcastGameState() {
    if (!this.game) return;
    for (const member of this.membersByToken.values()) {
      if (!member.socketId) continue;
      const state = this.game.toNetworkState(member.seatIndex);
      state.roomId = this.id;
      state.status = this.status;
      state.isHost = member.token === this.hostToken;
      state.localSeatIndex = member.seatIndex;
      state.message = this.message;
      state.members = this.allMembers().map(m => this.memberPayload(m));
      const socket = this.io.sockets.sockets.get(member.socketId);
      if (socket) state.inviteLink = this.getInviteLink(socket);
      this.io.to(member.socketId).emit('game-state', state);
    }
  }
}
