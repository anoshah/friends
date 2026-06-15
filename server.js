const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), connections: Object.keys(io.sockets.sockets).length });
});

const rooms = {};

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on('create-room', ({ username }, callback) => {
    let roomCode;
    do {
      roomCode = Math.floor(100 + Math.random() * 900).toString();
    } while (rooms[roomCode]);
    rooms[roomCode] = { users: [], ownerId: socket.id };
    socket.join(roomCode);
    rooms[roomCode].users.push({ id: socket.id, username: username || 'Anonymous' });
    callback({ roomCode });
    io.to(roomCode).emit('users-update', rooms[roomCode].users);
  });

  socket.on('join-room', ({ roomCode, username }, callback) => {
    if (rooms[roomCode]) {
      socket.join(roomCode);
      rooms[roomCode].users.push({ id: socket.id, username: username || 'Anonymous' });
      callback({ success: true, roomCode, users: rooms[roomCode].users, ownerId: rooms[roomCode].ownerId });
      socket.to(roomCode).emit('user-joined', { userId: socket.id, username: username || 'Anonymous' });
      io.to(roomCode).emit('users-update', rooms[roomCode].users);
      io.to(roomCode).emit('chat-message', {
        type: 'system',
        message: `${username || 'Someone'} joined the room`,
        timestamp: Date.now()
      });
    } else {
      callback({ success: false, message: 'Room not found' });
    }
  });

  socket.on('chat-message', ({ roomCode, message, username }) => {
    io.to(roomCode).emit('chat-message', {
      type: 'user',
      username,
      message,
      timestamp: Date.now(),
      userId: socket.id
    });
  });

  socket.on('location-update', ({ roomCode, lat, lng }) => {
    if (rooms[roomCode]) {
      const user = rooms[roomCode].users.find(u => u.id === socket.id);
      if (user) {
        user.lat = lat;
        user.lng = lng;
      }
      socket.to(roomCode).emit('location-update', {
        userId: socket.id,
        username: user ? user.username : 'Anonymous',
        lat,
        lng
      });
    }
  });

  socket.on('signal', ({ roomCode, signal, to }) => {
    io.to(to).emit('signal', { signal, from: socket.id });
  });

  socket.on('voice-toggle', ({ roomCode, enabled }) => {
    socket.to(roomCode).emit('voice-toggle', { userId: socket.id, enabled });
  });

  socket.on('remove-user', ({ roomCode, userId }) => {
    if (rooms[roomCode] && rooms[roomCode].ownerId === socket.id) {
      const user = rooms[roomCode].users.find(u => u.id === userId);
      if (user && userId !== socket.id) {
        const idx = rooms[roomCode].users.findIndex(u => u.id === userId);
        if (idx !== -1) {
          rooms[roomCode].users.splice(idx, 1);
          io.to(userId).emit('user-removed', { roomCode });
          io.to(roomCode).emit('users-update', rooms[roomCode].users);
          io.to(roomCode).emit('chat-message', {
            type: 'system',
            message: `${user.username} تم إزالته من الغرفة`,
            timestamp: Date.now()
          });
        }
      }
    }
  });

  socket.on('mute-user', ({ roomCode, userId }) => {
    if (rooms[roomCode] && rooms[roomCode].ownerId === socket.id) {
      const user = rooms[roomCode].users.find(u => u.id === userId);
      if (user && userId !== socket.id) {
        if (!rooms[roomCode].mutedUsers) rooms[roomCode].mutedUsers = [];
        const mutedIdx = rooms[roomCode].mutedUsers.indexOf(userId);
        let isMuted;
        if (mutedIdx === -1) {
          rooms[roomCode].mutedUsers.push(userId);
          isMuted = true;
        } else {
          rooms[roomCode].mutedUsers.splice(mutedIdx, 1);
          isMuted = false;
        }
        io.to(userId).emit('user-muted', { muted: isMuted });
        io.to(roomCode).emit('mute-update', { userId, muted: isMuted });
        io.to(roomCode).emit('chat-message', {
          type: 'system',
          message: isMuted ? `${user.username} تم كتم صوته` : `${user.username} تم فتح صوته`,
          timestamp: Date.now()
        });
      }
    }
  });

  socket.on('leave-room', ({ roomCode }) => {
    if (rooms[roomCode]) {
      const user = rooms[roomCode].users.find(u => u.id === socket.id);
      const username = user ? user.username : 'Someone';
      const idx = rooms[roomCode].users.findIndex(u => u.id === socket.id);
      if (idx !== -1) {
        rooms[roomCode].users.splice(idx, 1);
        socket.leave(roomCode);
        io.to(roomCode).emit('users-update', rooms[roomCode].users);
        io.to(roomCode).emit('user-left', { userId: socket.id });
        io.to(roomCode).emit('chat-message', {
          type: 'system',
          message: `${username} left the room`,
          timestamp: Date.now()
        });
        if (rooms[roomCode].users.length === 0) delete rooms[roomCode];
      }
    }
  });

  socket.on('disconnect', () => {
    for (const roomCode in rooms) {
      const user = rooms[roomCode].users.find(u => u.id === socket.id);
      const username = user ? user.username : 'Someone';
      const idx = rooms[roomCode].users.findIndex(u => u.id === socket.id);
      if (idx !== -1) {
        rooms[roomCode].users.splice(idx, 1);
        io.to(roomCode).emit('users-update', rooms[roomCode].users);
        io.to(roomCode).emit('user-left', { userId: socket.id });
        io.to(roomCode).emit('chat-message', {
          type: 'system',
          message: `${username} left the room`,
          timestamp: Date.now()
        });
        if (rooms[roomCode].users.length === 0) delete rooms[roomCode];
        break;
      }
    }
    console.log(`Disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Fada running on http://localhost:${PORT}`);
});
