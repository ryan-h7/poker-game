import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { RoomManager } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

app.use(express.static(rootDir));

const rooms = new RoomManager(io);

io.on('connection', (socket) => {
  socket.on('create-room', ({ name, settings }, cb) => {
    const room = rooms.create(socket, name);
    if (settings) room.updateSettings(socket.id, settings);
    const link = room.getInviteLink(socket);
    const host = room.allMembers()[0];
    cb?.({
      ok: true,
      roomId: room.id,
      seatIndex: 0,
      isHost: true,
      memberToken: host?.token,
      inviteLink: link,
    });
    room.broadcastLobby();
  });

  socket.on('join-room', ({ roomId, name, memberToken }, cb) => {
    const room = rooms.get(roomId);
    if (!room) {
      cb?.({ ok: false, error: 'Room not found.' });
      return;
    }
    const result = room.addMember(socket, name, false, memberToken || null);
    if (!result.ok) {
      cb?.(result);
      return;
    }
    const link = room.getInviteLink(socket);
    cb?.({ ok: true, ...result, inviteLink: link });
  });

  socket.on('update-settings', ({ playerCount, bigBlind, startingStack, maxRebuys }, cb) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) {
      cb?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    const ok = room.updateSettings(socket.id, { playerCount, bigBlind, startingStack, maxRebuys });
    cb?.({ ok, error: ok ? undefined : 'Could not update table settings.' });
  });

  socket.on('start-hand', (_, cb) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) {
      cb?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    cb?.(room.startHand(socket.id));
  });

  socket.on('player-action', ({ action, amount }, cb) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) {
      cb?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    cb?.(room.handleAction(socket.id, action, amount ?? 0));
  });

  socket.on('transfer-host', ({ targetSocketId }, cb) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) {
      cb?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    cb?.(room.assignHost(socket.id, targetSocketId));
  });

  socket.on('rebuy', (_, cb) => {
    const room = rooms.get(socket.data.roomId);
    if (!room) {
      cb?.({ ok: false, error: 'Not in a room.' });
      return;
    }
    cb?.(room.rebuy(socket.id));
  });

  socket.on('leave-room', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    room?.removeMember(socket.id);
    socket.leave(roomId);
    delete socket.data.roomId;
    rooms.removeIfEmpty(roomId);
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    room?.disconnectMember(socket.id);
  });
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
    console.error(`The game server may already be running — open http://localhost:${PORT}`);
    console.error('To restart, stop the other process first (Task Manager → Node.js, or close the other terminal).');
    process.exit(1);
  }
  throw err;
});

httpServer.listen(PORT, () => {
  console.log(`Poker server running at http://localhost:${PORT}`);
  console.log('Create a room in the browser and share the invite link with friends.');
});
