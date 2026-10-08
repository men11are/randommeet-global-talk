require('dotenv').config();
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
    maxHttpBufferSize: 1e8,
    pingTimeout: 60000,
    pingInterval: 25000
});

// Cache-busting headers so browsers always pull the freshest code
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    maxAge: 0
}));

// Dynamic ICE config endpoint with permanent TCP fallback relays
app.get('/api/ice-config', (req, res) => {
    const turnHost = process.env.TURN_URL || "global.relay.metered.ca";
    const turnUser = process.env.TURN_USERNAME || "eb5ef206ad4b56f7c91347f4";
    const turnPass = process.env.TURN_CREDENTIAL || "ELkjSHNeiKI1svYE";

    const iceServers = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        // Metered Primary Relay (TCP on 443 bypasses strict Wi-Fi firewalls instantly)
        { urls: `turn:${turnHost}:443?transport=tcp`, username: turnUser, credential: turnPass },
        { urls: `turns:${turnHost}:443?transport=tcp`, username: turnUser, credential: turnPass },
        { urls: `turn:${turnHost}:80?transport=tcp`, username: turnUser, credential: turnPass },
        { urls: `turn:${turnHost}:443`, username: turnUser, credential: turnPass },
        // ExpressTURN Secondary Relay
        { urls: "turn:free.expressturn.com:3478?transport=tcp", username: "000000002106630972", credential: "YUbWpt+T7WM3dguWcIF/ocLGKPU=" },
        { urls: "turn:free.expressturn.com:3478", username: "000000002106630972", credential: "YUbWpt+T7WM3dguWcIF/ocLGKPU=" }
    ];

    res.json({ iceServers });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let waitingQueue = [];
let activePairs = new Map();

function broadcastLiveUsers() {
    io.emit('live-users', io.engine.clientsCount);
}

io.on('connection', (socket) => {
    broadcastLiveUsers();

    socket.on('ping', () => socket.emit('pong'));

    socket.on('join', (preferences) => {
        waitingQueue = waitingQueue.filter(u => u.socketId !== socket.id);

        let matchIndex = -1;
        for (let i = 0; i < waitingQueue.length; i++) {
            if (waitingQueue[i].socketId !== socket.id) {
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
        if (data && data.partnerId) io.to(data.partnerId).emit('offer', data);
    });

    socket.on('answer', (data) => {
        if (data && data.partnerId) io.to(data.partnerId).emit('answer', data);
    });

    socket.on('ice-candidate', (data) => {
        if (data && data.partnerId) io.to(data.partnerId).emit('ice-candidate', data);
    });

    socket.on('chat-message', (data) => {
        if (data && data.partnerId) io.to(data.partnerId).emit('chat-message', data.message);
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

    socket.on('skip', () => cleanUpDisconnect(socket.id));
    socket.on('disconnect', () => {
        cleanUpDisconnect(socket.id);
        broadcastLiveUsers();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`RandomMeet Core Engine active on port ${PORT}`);
});
