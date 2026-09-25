const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e8 // Support up to 100MB for media chunk transfer
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// User queue and active matching
let waitingQueue = [];
let activePairs = new Map();

function broadcastLiveUsers() {
    io.emit('live-users', io.engine.clientsCount);
}

io.on('connection', (socket) => {
    broadcastLiveUsers();

    socket.on('ping', () => {
        socket.emit('pong');
    });

    socket.on('join', (preferences) => {
        // Remove existing queue presence
        waitingQueue = waitingQueue.filter(u => u.socketId !== socket.id);

        // Find match based on region/gender if available, else match fastest
        let matchIndex = -1;
        for (let i = 0; i < waitingQueue.length; i++) {
            const peer = waitingQueue[i];
            if (peer.socketId !== socket.id) {
                matchIndex = i;
                break;
            }
        }

        if (matchIndex !== -1) {
            const partner = waitingQueue.splice(matchIndex, 1)[0];
            const partnerSocket = io.sockets.sockets.get(partner.socketId);

            if (partnerSocket) {
                activePairs.set(socket.id, partner.socketId);
                activePairs.set(partner.socketId, socket.id);

                // Initiator logic: one creates offer, other receives
                socket.emit('matched', { partnerId: partner.socketId, initiator: true });
                partnerSocket.emit('matched', { partnerId: socket.id, initiator: false });
            } else {
                waitingQueue.push({ socketId: socket.id, prefs: preferences });
            }
        } else {
            waitingQueue.push({ socketId: socket.id, prefs: preferences });
        }
    });

    socket.on('offer', (data) => {
        if (data && data.partnerId) {
            io.to(data.partnerId).emit('offer', data);
        }
    });

    socket.on('answer', (data) => {
        if (data && data.partnerId) {
            io.to(data.partnerId).emit('answer', data);
        }
    });

    socket.on('ice-candidate', (data) => {
        if (data && data.partnerId) {
            io.to(data.partnerId).emit('ice-candidate', data);
        }
    });

    socket.on('chat-message', (data) => {
        if (data && data.partnerId) {
            io.to(data.partnerId).emit('chat-message', data.message);
        }
    });

    function cleanUpDisconnect(sockId) {
        waitingQueue = waitingQueue.filter(u => u.socketId !== sockId);
        const partnerId = activePairs.get(sockId);
        if (partnerId) {
            activePairs.delete(sockId);
            activePairs.delete(partnerId);
            io.to(partnerId).emit('peer-disconnected');
        }
    }

    socket.on('skip', () => {
        cleanUpDisconnect(socket.id);
    });

    socket.on('disconnect', () => {
        cleanUpDisconnect(socket.id);
        broadcastLiveUsers();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`RandomMeet Server running live on port ${PORT}`);
});
