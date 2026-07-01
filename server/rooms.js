import { randomUUID } from 'crypto';
import { PokerGame } from '../js/game.js';

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_TABLE_SIZE = 8;

export const PUBLIC_ROOM_DEFS = [
  {
    id: 'PUB001',
    name: 'Main Lounge',
    allowBots: true,
    settings: { playerCount: 6, bigBlind: 20, startingStack: 1000, maxRebuys: 3, anteFraction: 0 },
  },
  {
    id: 'PUB002',
    name: 'High Roller',
    allowBots: true,
    settings: { playerCount: 6, bigBlind: 50, startingStack: 5000, maxRebuys: 3, anteFraction: 0 },
  },
  {
    id: 'PUB003',
    name: 'Players Club',
    allowBots: false,
    settings: { bigBlind: 20, startingStack: 1000, maxRebuys: 3, anteFraction: 0 },
  },
  {
    id: 'PUB004',
    name: 'Quick Fire',
    allowBots: false,
    settings: { bigBlind: 10, startingStack: 500, maxRebuys: 1, anteFraction: 0.5 },
  },
];

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

  initPublicRooms() {
    for (const def of PUBLIC_ROOM_DEFS) {
      const existing = this.rooms.get(def.id);
      if (existing) {
        existing.displayName = def.name;
        existing.allowBots = def.allowBots !== false;
        if (existing.status === 'lobby' && existing.membersByToken.size === 0) {
          existing.settings.bigBlind = def.settings.bigBlind ?? existing.settings.bigBlind;
          existing.settings.startingStack = def.settings.startingStack ?? existing.settings.startingStack;
          existing.settings.maxRebuys = def.settings.maxRebuys ?? existing.settings.maxRebuys;
          existing.settings.anteFraction = def.settings.anteFraction ?? existing.settings.anteFraction;
          existing.settings.playerCount = existing.allowBots ? (def.settings.playerCount ?? 6) : 0;
        }
        continue;
      }
      this.createPublicRoom(def);
    }
  }

  createPublicRoom(def) {
    const room = new Room(def.id, this.io, (id) => this.removeIfEmpty(id), {
      isPublic: true,
      displayName: def.name,
      allowBots: def.allowBots !== false,
      onPublicChange: () => this.broadcastPublicRoomsUpdate(),
    });
    room.settings = {
      playerCount: def.allowBots === false ? 0 : (def.settings.playerCount ?? 6),
      bigBlind: def.settings.bigBlind ?? 20,
      startingStack: def.settings.startingStack ?? 1000,
      maxRebuys: def.settings.maxRebuys ?? 3,
      anteFraction: def.settings.anteFraction ?? 0,
    };
    this.rooms.set(def.id, room);
    return room;
  }

  listPublicRooms() {
    return PUBLIC_ROOM_DEFS.map((def) => {
      const room = this.rooms.get(def.id);
      return room ? room.publicSummary() : {
        id: def.id,
        name: def.name,
        players: 0,
        maxPlayers: MAX_TABLE_SIZE,
        status: 'lobby',
        inHand: false,
        allowBots: def.allowBots !== false,
        bigBlind: def.settings.bigBlind,
        startingStack: def.settings.startingStack,
      };
    });
  }

  broadcastPublicRoomsUpdate() {
    this.io.emit('public-rooms', { ok: true, rooms: this.listPublicRooms() });
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
    if (!room || room.isPublic) return;
    if (room.membersByToken.size === 0) {
      room.destroy();
      this.rooms.delete(roomId);
    }
  }
}

class Room {
  constructor(id, io, onEmpty, { isPublic = false, displayName = null, onPublicChange = null, allowBots = true } = {}) {
    this.id = id;
    this.isPublic = isPublic;
    this.displayName = displayName || id;
    this.allowBots = allowBots;
    this.onPublicChange = onPublicChange;
    this.hostToken = null;
    this.io = io;
    this.onEmpty = onEmpty;
    this.membersByToken = new Map();
    this.status = 'lobby';
    this.settings = { playerCount: 4, bigBlind: 20, startingStack: 1000, maxRebuys: 3, anteFraction: 0 };
    this.game = null;
    this.message = 'Waiting for players…';
    this.disconnectGraceMs = 90_000;
    this.disconnectTurnGraceMs = 45_000;
    this.soloIdleTimer = null;
    this.soloIdleMs = 4 * 60 * 60 * 1000;
  }

  destroy() {
    this.clearSoloIdleTimer();
    for (const member of this.membersByToken.values()) {
      this.clearMemberTimers(member);
    }
    if (this.game) {
      this.game.clearAiTimer();
      this.game = null;
    }
    this.membersByToken.clear();
    this.hostToken = null;
  }

  clearSoloIdleTimer() {
    if (!this.soloIdleTimer) return;
    clearTimeout(this.soloIdleTimer);
    this.soloIdleTimer = null;
  }

  /** Members that occupy seats in the current hand (solo fill when alone). */
  playMembers() {
    const all = this.allMembers();
    const connected = all.filter(m => m.socketId);
    if (connected.length === 1 && all.length > 1) return connected;
    return all;
  }

  isSoloContinuation() {
    return this.connectedMemberCount() === 1
      && this.membersByToken.size >= 1;
  }

  refreshSoloIdleCleanup() {
    this.clearSoloIdleTimer();
    if (this.connectedMemberCount() !== 1 || this.isMidHand()) return;
    this.soloIdleTimer = setTimeout(() => {
      this.soloIdleTimer = null;
      if (this.connectedMemberCount() !== 1 || this.isMidHand()) return;
      const member = this.allMembers().find(m => m.socketId);
      if (!member) {
        if (this.isPublic) this.resetWhenEmpty();
        else {
          this.destroy();
          this.onEmpty?.(this.id);
        }
        return;
      }
      const sock = member.socketId && this.io.sockets.sockets.get(member.socketId);
      if (sock) {
        sock.emit('kicked', { reason: 'Removed after inactivity.' });
        sock.leave(this.id);
        delete sock.data.roomId;
        delete sock.data.seatIndex;
        delete sock.data.memberToken;
      }
      this.removeMemberByToken(member.token);
    }, this.soloIdleMs);
  }

  resetWhenEmpty() {
    this.clearSoloIdleTimer();
    for (const member of this.membersByToken.values()) {
      this.clearMemberTimers(member);
    }
    this.membersByToken.clear();
    this.hostToken = null;
    if (this.game) {
      this.game.clearAiTimer();
      this.game = null;
    }
    this.status = 'lobby';
    this.message = 'Waiting for players…';
  }

  publicSummary() {
    const inHand = !!this.isMidHand();
    let tableStatus = 'waiting';
    if (inHand) tableStatus = 'in_hand';
    else if (this.status === 'active') tableStatus = 'between_hands';
    return {
      id: this.id,
      name: this.displayName,
      players: this.connectedMemberCount(),
      maxPlayers: MAX_TABLE_SIZE,
      seated: this.membersByToken.size,
      status: this.status,
      tableStatus,
      inHand,
      allowBots: this.allowBots,
      bigBlind: this.settings.bigBlind,
      startingStack: this.settings.startingStack,
    };
  }

  syncPublicPlayerCount() {
    if (!this.isPublic) return;
    const n = this.membersByToken.size;
    if (this.allowBots) {
      if (this.status !== 'lobby') return;
      this.settings.playerCount = Math.max(4, Math.min(MAX_TABLE_SIZE, Math.max(n, 4)));
      if (n <= 2) this.settings.playerCount = Math.max(this.settings.playerCount, 6);
    } else {
      this.settings.playerCount = Math.max(0, Math.min(MAX_TABLE_SIZE, n));
    }
  }

  isMidHand() {
    return this.game
      && this.game.phase !== 'idle'
      && this.game.phase !== 'showdown';
  }

  memberAtSeat(seatIndex) {
    return this.allMembers().find(m => m.seatIndex === seatIndex) || null;
  }

  clearMemberTimers(member) {
    if (!member) return;
    if (member.disconnectTimer) {
      clearTimeout(member.disconnectTimer);
      member.disconnectTimer = null;
    }
    if (member.turnTimer) {
      clearTimeout(member.turnTimer);
      member.turnTimer = null;
    }
  }

  scheduleDisconnectTurnFold(member) {
    if (!member || member.socketId || !this.isMidHand()) return;
    const seat = member.seatIndex;
    if (this.game.activeIndex !== seat) return;
    const player = this.game.players[seat];
    if (!player?.isHuman || player.folded || !player.inHand) return;

    this.clearMemberTimers(member);
    member.turnTimer = setTimeout(() => {
      member.turnTimer = null;
      if (member.socketId || !this.game) return;
      if (this.game.activeIndex !== seat) return;
      const p = this.game.players[seat];
      if (!p || p.folded || this.game.phase === 'idle' || this.game.phase === 'showdown') return;
      this.game.applyAction(p, 'fold');
      this.game.handHistory.push(`${p.name} disconnected (folded)`);
      this.game.actedThisRound.add(seat);
      this.game.afterAction();
      this.message = `${p.name} was folded after disconnect.`;
      this.broadcastGameState();
      this.checkDisconnectedActiveTurn();
    }, this.disconnectTurnGraceMs);
  }

  checkDisconnectedActiveTurn() {
    if (!this.isMidHand()) return;
    const member = this.memberAtSeat(this.game.activeIndex);
    if (member && !member.socketId) this.scheduleDisconnectTurnFold(member);
  }

  pushTableState() {
    if (this.game) this.broadcastGameState();
    else this.broadcastLobby();
  }

  getMemberBySocket(socketId) {
    for (const member of this.membersByToken.values()) {
      if (member.socketId === socketId) return member;
    }
    return null;
  }

  getMemberById(id) {
    if (!id) return null;
    for (const member of this.membersByToken.values()) {
      if (member.socketId === id || member.token === id) return member;
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
      rebuyCount: member.rebuyCount || 0,
    };
  }

  rebuysRemaining(member) {
    const max = this.settings.maxRebuys;
    if (max === 0) return 0;
    if (max < 0) return null;
    return Math.max(0, max - (member.rebuyCount || 0));
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
      turnTimer: null,
      rebuyCount: 0,
    };
    this.membersByToken.set(token, member);
    socket.join(this.id);
    socket.data.roomId = this.id;
    socket.data.seatIndex = seat.seatIndex;
    socket.data.memberToken = token;
    if (isHost || !this.hostToken) this.hostToken = token;

    if (this.isPublic) {
      this.syncPublicPlayerCount();
    }

    this.message = `${displayName} joined the table.`;
    this.clearSoloIdleTimer();
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
    if (member.turnTimer) {
      clearTimeout(member.turnTimer);
      member.turnTimer = null;
    }

    const displayName = String(name || member.name || 'Player').trim().slice(0, 16) || member.name;
    member.name = displayName;
    member.socketId = socket.id;
    socket.join(this.id);
    socket.data.roomId = this.id;
    socket.data.seatIndex = member.seatIndex;
    socket.data.memberToken = token;

    this.message = `${displayName} reconnected.`;
    this.clearSoloIdleTimer();
    this.pushTableState();
    this.checkDisconnectedActiveTurn();
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

    if (member.turnTimer) {
      clearTimeout(member.turnTimer);
      member.turnTimer = null;
    }
    member.socketId = null;
    if (member.disconnectTimer) clearTimeout(member.disconnectTimer);
    member.disconnectTimer = setTimeout(() => {
      member.disconnectTimer = null;
      this.removeMemberByToken(member.token, { timedOut: true });
    }, this.disconnectGraceMs);

    this.message = `${member.name} disconnected.`;
    this.pushTableState();
    this.scheduleDisconnectTurnFold(member);
  }

  removeMember(socketId) {
    const member = this.getMemberBySocket(socketId);
    if (!member) return;
    this.removeMemberByToken(member.token);
  }

  removeMemberByToken(token, { timedOut = false, kicked = false } = {}) {
    const member = this.membersByToken.get(token);
    if (!member) return;

    const seat = member.seatIndex;

    if (kicked && member.socketId) {
      this.notifyKicked(member.socketId);
    }

    if (timedOut && this.isMidHand()) {
      this.clearMemberTimers(member);
      const player = this.game.players[seat];
      if (player && !player.folded) {
        this.game.applyAction(player, 'fold');
        this.game.handHistory.push(`${player.name} timed out (folded)`);
        this.game.actedThisRound.add(seat);
        this.game.afterAction();
      }
      this.message = `${member.name} was folded after a long disconnect.`;
      this.pushTableState();
      this.checkDisconnectedActiveTurn();
      return;
    }

    this.clearMemberTimers(member);

    const leftName = member.name;
    const wasHost = token === this.hostToken;
    this.membersByToken.delete(token);
    if (this.membersByToken.size === 0) {
      if (this.isPublic) {
        this.resetWhenEmpty();
        this.onPublicChange?.();
        return;
      }
      this.destroy();
      this.onEmpty?.(this.id);
      return;
    }

    if (wasHost) this.transferHost(leftName);
    else if (kicked) this.message = `${leftName} was removed from the table.`;
    else this.message = timedOut
      ? `${leftName} timed out and left the table.`
      : `${leftName} left the table.`;

    if (this.isPublic) this.syncPublicPlayerCount();

    this.afterMemberDeparture();

    if (this.status === 'lobby') {
      if (this.canChangeSettings()) this.reindexMembers();
      this.syncTable();
      return;
    }

    if (this.game) {
      const player = this.game.players[seat];
      let resumeHand = false;
      if (player && this.isMidHand() && !player.folded) {
        if (this.game.applyAction(player, 'fold')) {
          this.game.handHistory.push(timedOut
            ? `${player.name} timed out (folded)`
            : `${player.name} disconnected (folded)`);
          this.game.actedThisRound.add(seat);
          resumeHand = true;
        }
      }
      if (this.canChangeSettings()) this.reindexMembers();
      this.syncGamePlayers();
      if (resumeHand) this.game.afterAction();
      else this.broadcastGameState();
      if (this.isMidHand()) this.checkDisconnectedActiveTurn();
    }
  }

  afterMemberDeparture() {
    if (this.isSoloContinuation()) {
      if (this.allowBots) {
        this.message = `${this.message} Empty seats are filled by bots until others join.`;
      }
      this.refreshSoloIdleCleanup();
    } else {
      this.clearSoloIdleTimer();
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

  kickMember(requesterSocketId, targetMemberId) {
    if (this.status !== 'lobby') {
      return { ok: false, error: 'Can only remove players while waiting in the lobby.' };
    }
    const requester = this.getMemberBySocket(requesterSocketId);
    if (!requester || requester.token !== this.hostToken) {
      return { ok: false, error: 'Only the host can remove players.' };
    }
    const target = this.getMemberById(targetMemberId);
    if (!target) return { ok: false, error: 'Player not in room.' };
    if (target.token === requester.token) {
      return { ok: false, error: 'You cannot remove yourself.' };
    }
    if (target.token === this.hostToken) {
      return { ok: false, error: 'Cannot remove the host.' };
    }

    this.removeMemberByToken(target.token, { kicked: true });
    return { ok: true };
  }

  notifyKicked(socketId) {
    const sock = this.io.sockets.sockets.get(socketId);
    if (!sock) return;
    sock.emit('kicked', { reason: 'You were removed from the table by the host.' });
    sock.leave(this.id);
    delete sock.data.roomId;
    delete sock.data.seatIndex;
    delete sock.data.memberToken;
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
    let maxRebuys = parseInt(settings.maxRebuys, 10);
    if (!Number.isFinite(maxRebuys)) maxRebuys = this.settings.maxRebuys ?? 3;
    maxRebuys = Math.max(-1, Math.min(10, maxRebuys));
    let anteFraction = Number(settings.anteFraction);
    if (![0, 0.5, 1].includes(anteFraction)) anteFraction = this.settings.anteFraction ?? 0;
    this.settings.playerCount = playerCount;
    this.settings.bigBlind = bigBlind;
    this.settings.startingStack = startingStack;
    this.settings.maxRebuys = maxRebuys;
    this.settings.anteFraction = anteFraction;
    if (this.game) {
      this.game.startingStack = startingStack;
      this.game.anteFraction = anteFraction;
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
    if (this.connectedMemberCount() < 1) {
      return { ok: false, error: 'No players connected.' };
    }
    if (!this.allowBots && this.connectedMemberCount() < 2) {
      return { ok: false, error: 'Need at least 2 players to deal.' };
    }
    if (this.game && this.game.phase !== 'idle' && this.game.phase !== 'showdown') {
      return { ok: false, error: 'Hand already in progress.' };
    }

    this.status = 'active';
    this.clearSoloIdleTimer();
    this.ensureGame();
    this.syncGamePlayers();
    this.game.startNewHand();
    this.message = this.game._lastMessage || 'New hand dealt.';
    this.broadcastGameState();
    this.checkDisconnectedActiveTurn();
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
    this.game.anteFraction = this.settings.anteFraction ?? 0;
    this.game.minRaise = this.settings.bigBlind;
  }

  syncGamePlayers() {
    if (!this.game) return;
    const members = this.playMembers();
    this.game.startingStack = this.settings.startingStack;
    this.game.setOnlinePlayers(members, this.settings.playerCount, this.status === 'lobby');
    this.game.bigBlind = this.settings.bigBlind;
    this.game.anteFraction = this.settings.anteFraction ?? 0;
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
    if (this.isPublic) this.onPublicChange?.();
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
    this.checkDisconnectedActiveTurn();
    return { ok: true };
  }

  rebuy(socketId) {
    if (!this.game) {
      return { ok: false, error: 'Not in an active session.' };
    }
    if (!this.canChangeSettings()) {
      return { ok: false, error: 'Wait for the current hand to finish.' };
    }
    const member = this.getMemberBySocket(socketId);
    if (!member) return { ok: false, error: 'Not in room.' };

    const player = this.game.players[member.seatIndex];
    if (!player?.isHuman) return { ok: false, error: 'Invalid seat.' };
    if (player.chips > 0) {
      return { ok: false, error: 'Rebuy is only available when you have no chips.' };
    }

    const remaining = this.rebuysRemaining(member);
    if (remaining === 0) {
      return { ok: false, error: 'You have no rebuys remaining.' };
    }

    const stack = this.settings.startingStack;
    player.chips = stack;
    player.inHand = true;
    player.folded = false;
    member.rebuyCount = (member.rebuyCount || 0) + 1;
    const left = this.rebuysRemaining(member);
    const leftText = left === null ? '' : ` (${left} rebuy${left === 1 ? '' : 's'} left)`;
    this.message = `${player.name} rebought for ${this.game.formatAmount(stack)}${leftText}.`;
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
      displayName: this.displayName,
      isPublic: this.isPublic,
      allowBots: this.allowBots,
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
      state.maxRebuys = this.settings.maxRebuys;
      state.localRebuyCount = member.rebuyCount || 0;
      state.members = this.allMembers().map(m => this.memberPayload(m));
      const socket = this.io.sockets.sockets.get(member.socketId);
      if (socket) state.inviteLink = this.getInviteLink(socket);
      this.io.to(member.socketId).emit('game-state', state);
    }
    if (this.isPublic) this.onPublicChange?.();
  }
}
