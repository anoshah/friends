const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  socket.on('create-room', (callback) => {
    let roomCode;
    do {
      roomCode = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[roomCode]);
    rooms[roomCode] = { users: [] };
    socket.join(roomCode);
    rooms[roomCode].users.push({ id: socket.id });
    callback({ roomCode });
    io.to(roomCode).emit('users-update', rooms[roomCode].users);
  });

  socket.on('join-room', ({ roomCode }, callback) => {
    if (rooms[roomCode]) {
      socket.join(roomCode);
      rooms[roomCode].users.push({ id: socket.id });
      callback({ success: true, roomCode, users: rooms[roomCode].users });
      socket.to(roomCode).emit('user-joined', { userId: socket.id });
      io.to(roomCode).emit('users-update', rooms[roomCode].users);
      io.to(roomCode).emit('chat-message', {
        type: 'system',
        message: 'Someone joined the room',
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

  socket.on('disconnect', () => {
    for (const roomCode in rooms) {
      const idx = rooms[roomCode].users.findIndex(u => u.id === socket.id);
      if (idx !== -1) {
        rooms[roomCode].users.splice(idx, 1);
        io.to(roomCode).emit('users-update', rooms[roomCode].users);
        io.to(roomCode).emit('user-left', { userId: socket.id });
        io.to(roomCode).emit('chat-message', {
          type: 'system',
          message: 'Someone left the room',
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
