const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
    cors: { origin: "*" },
    pingTimeout: 60000,
    pingInterval: 25000
});
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let waitingUsers = [];

io.on('connection', (socket) => {
    io.emit('live-users', io.engine.clientsCount);

    socket.on('join', (prefs) => {
        waitingUsers = waitingUsers.filter(u => u.id !== socket.id);
        
        if (waitingUsers.length > 0) {
            const partner = waitingUsers.shift();
            
            socket.partnerId = partner.id;
            partner.partnerId = socket.id;

            socket.emit('matched', { partnerId: partner.id, initiator: true });
            io.to(partner.id).emit('matched', { partnerId: socket.id, initiator: false });
        } else {
            waitingUsers.push(socket);
        }
    });

    socket.on('offer', (data) => {
        if (socket.partnerId) {
            io.to(socket.partnerId).emit('offer', { sdp: data.sdp, partnerId: socket.id });
        }
    });

    socket.on('answer', (data) => {
        if (socket.partnerId) {
            io.to(socket.partnerId).emit('answer', { sdp: data.sdp, partnerId: socket.id });
        }
    });

    socket.on('ice-candidate', (data) => {
        if (socket.partnerId) {
            io.to(socket.partnerId).emit('ice-candidate', { candidate: data.candidate, partnerId: socket.id });
        }
    });

    socket.on('chat-message', (data) => {
        if (socket.partnerId) {
            io.to(socket.partnerId).emit('chat-message', data.message);
        }
    });

    socket.on('skip', () => {
        if (socket.partnerId) {
            io.to(socket.partnerId).emit('peer-disconnected');
            const partner = io.sockets.sockets.get(socket.partnerId);
            if (partner) partner.partnerId = null;
            socket.partnerId = null;
        }
        waitingUsers = waitingUsers.filter(u => u.id !== socket.id);
    });

    socket.on('disconnect', () => {
        if (socket.partnerId) {
            io.to(socket.partnerId).emit('peer-disconnected');
            const partner = io.sockets.sockets.get(socket.partnerId);
            if (partner) partner.partnerId = null;
        }
        waitingUsers = waitingUsers.filter(u => u.id !== socket.id);
        io.emit('live-users', io.engine.clientsCount);
    });

    socket.on('ping', () => {
        socket.emit('pong');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running smoothly on port ${PORT}`);
});
