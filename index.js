require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e8,
    pingTimeout: 60000,
    pingInterval: 25000
});

// Cache-busting headers
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

// Dynamic Metered ICE Engine with Geo-Optimization & Local Cache
let cachedIceServers = null;
let lastIceFetch = 0;

async function getLiveIceServers() {
    const now = Date.now();
    // Cache credentials for 10 minutes to prevent API throttling
    if (cachedIceServers && (now - lastIceFetch < 600000)) {
        return cachedIceServers;
    }

    try {
        const apiKey = process.env.METERED_API_KEY || "f558e7d08cc69aa9b9eb0713257cbdcfa88f";
        const appName = process.env.METERED_APP_NAME || "randommeet";
        const response = await fetch(`https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`);
        
        if (response.ok) {
            const servers = await response.json();
            if (Array.isArray(servers) && servers.length > 0) {
                cachedIceServers = servers;
                lastIceFetch = now;
                return cachedIceServers;
            }
        }
    } catch (err) {
        console.warn("Metered REST API notice, falling back to static relays:", err.message);
    }

    // Static Multi-Port Relays from Metered Dashboard
    const turnHost = process.env.TURN_URL || "global.relay.metered.ca";
    const turnUser = process.env.TURN_USERNAME || "eb5ef206ad4b56f7c91347f4";
    const turnPass = process.env.TURN_CREDENTIAL || "ELkjSHNeiKI1svYE";

    return [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun.relay.metered.ca:80" },
        { urls: `turn:${turnHost}:80`, username: turnUser, credential: turnPass },
        { urls: `turn:${turnHost}:80?transport=tcp`, username: turnUser, credential: turnPass },
        { urls: `turn:${turnHost}:443`, username: turnUser, credential: turnPass },
        { urls: `turns:${turnHost}:443?transport=tcp`, username: turnUser, credential: turnPass },
        { urls: "turn:free.expressturn.com:3478", username: "000000002106630972", credential: "YUbWpt+T7WM3dguWcIF/ocLGKPU=" }
    ];
}

app.get('/api/ice-config', async (req, res) => {
    const iceServers = await getLiveIceServers();
    res.json({ iceServers });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let waitingQueue = [];
let activePairs = new Map();

function getClientIp(socket) {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    return socket.handshake.address;
}

// Emits waiting-status ONLY if there is another user waiting with a DIFFERENT IP
function updateWaitingStatus() {
    io.sockets.sockets.forEach((sock) => {
        const myIp = getClientIp(sock);
        const hasRealStranger = waitingQueue.some(u => u.socketId !== sock.id && u.ip !== myIp);
        sock.emit('waiting-status', { hasRealStranger: (io.engine.clientsCount >= 2 && hasRealStranger) });
    });
}

function broadcastLiveUsers() {
    io.emit('live-users', io.engine.clientsCount);
    updateWaitingStatus();
}

setInterval(updateWaitingStatus, 5000);

io.on('connection', (socket) => {
    broadcastLiveUsers();

    socket.on('ping', () => socket.emit('pong'));

    socket.on('join', (preferences) => {
        const clientIp = getClientIp(socket);
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
                waitingQueue.push({ socketId: socket.id, ip: clientIp, prefs: preferences });
            }
        } else {
            waitingQueue.push({ socketId: socket.id, ip: clientIp, prefs: preferences });
        }
        updateWaitingStatus();
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
        updateWaitingStatus();
    }

    socket.on('skip', () => cleanUpDisconnect(socket.id));
    socket.on('disconnect', () => {
        cleanUpDisconnect(socket.id);
        broadcastLiveUsers();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`RandomMeet Core active on port ${PORT}`);
});
