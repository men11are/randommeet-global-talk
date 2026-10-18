require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// 2MB maxHttpBufferSize prevents 100MB OOM DoS attacks while easily supporting 40KB media chunks
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 2e6,
    pingTimeout: 60000,
    pingInterval: 25000
});

// Strict cache-busting headers so browsers never cache stale HTML/JS bundles
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

// Dynamic Metered ICE Engine with 3000ms Timeout, Geo-Optimization & Multi-Port Fallback
let cachedIceServers = null;
let lastIceFetch = 0;

function getStaticFallbackIceServers() {
    const turnHost = process.env.TURN_URL || "global.relay.metered.ca";
    const turnUser = process.env.TURN_USERNAME || "eb5ef206ad4b56f7c91347f4";
    const turnPass = process.env.TURN_CREDENTIAL || "ELkjSHNeiKI1svYE";

    return [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun.relay.metered.ca:80" },
        { urls: `turn:${turnHost}:80`, username: turnUser, credential: turnPass },
        { urls: `turn:${turnHost}:80?transport=tcp`, username: turnUser, credential: turnPass },
        { urls: `turn:${turnHost}:443`, username: turnUser, credential: turnPass },
        { urls: `turn:${turnHost}:443?transport=tcp`, username: turnUser, credential: turnPass },
        { urls: `turns:${turnHost}:443?transport=tcp`, username: turnUser, credential: turnPass },
        { urls: `turn:${turnHost}:3478`, username: turnUser, credential: turnPass },
        { urls: `turn:${turnHost}:3478?transport=tcp`, username: turnUser, credential: turnPass },
        { urls: "turn:free.expressturn.com:3478", username: "000000002106630972", credential: "YUbWpt+T7WM3dguWcIF/ocLGKPU=" },
        { urls: "turn:free.expressturn.com:3478?transport=tcp", username: "000000002106630972", credential: "YUbWpt+T7WM3dguWcIF/ocLGKPU=" }
    ];
}

async function getLiveIceServers() {
    const now = Date.now();
    if (cachedIceServers && (now - lastIceFetch < 480000)) {
        return cachedIceServers;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
        const apiKey = process.env.METERED_API_KEY || "f558e7d08cc69aa9b9eb0713257cbdcfa88f";
        const appName = process.env.METERED_APP_NAME || "randommeet";
        const response = await fetch(
            `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`,
            { signal: controller.signal }
        );
        clearTimeout(timeoutId);

        if (response.ok) {
            const servers = await response.json();
            if (Array.isArray(servers) && servers.length > 0) {
                const fallbackList = getStaticFallbackIceServers();
                const combined = [...servers];
                for (const fb of fallbackList) {
                    if (!combined.some(s => s.urls === fb.urls)) {
                        combined.push(fb);
                    }
                }
                cachedIceServers = combined;
                lastIceFetch = now;
                return cachedIceServers;
            }
        }
    } catch (err) {
        clearTimeout(timeoutId);
        console.warn("Metered REST API notice, using static multi-port relays:", err.message);
    }

    cachedIceServers = getStaticFallbackIceServers();
    lastIceFetch = now;
    return cachedIceServers;
}

app.get('/api/ice-config', async (req, res) => {
    const iceServers = await getLiveIceServers();
    res.json({ iceServers });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        onlineUsers: io.engine.clientsCount,
        waitingCount: waitingQueue.size,
        activePairsCount: activePairs.size / 2
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// O(1) Scalable Data Structures for 5,000+ Concurrent Users
// waitingQueue: Map<socketId, { socketId, ip, prefs, joinedAt }>
const waitingQueue = new Map();
// activePairs: Map<socketId, partnerSocketId>
const activePairs = new Map();

function getClientIp(socket) {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    return socket.handshake.address || '';
}

function normalizePrefs(prefs) {
    const safe = (prefs && typeof prefs === 'object') ? prefs : {};
    return {
        myGender: (safe.myGender === 'girl' || safe.myGender === 'boy') ? safe.myGender : 'boy',
        lookingFor: (safe.lookingFor === 'girl' || safe.lookingFor === 'boy' || safe.lookingFor === 'any') ? safe.lookingFor : 'any',
        region: typeof safe.region === 'string' && safe.region.trim() ? safe.region.trim().toLowerCase() : 'global'
    };
}

function isGenderCompatible(prefsA, prefsB) {
    const aMatchesB = (prefsA.lookingFor === 'any' || prefsA.lookingFor === prefsB.myGender);
    const bMatchesA = (prefsB.lookingFor === 'any' || prefsB.lookingFor === prefsA.myGender);
    return aMatchesB && bMatchesA;
}

function isRegionCompatible(prefsA, prefsB) {
    return (
        prefsA.region === 'global' ||
        prefsB.region === 'global' ||
        prefsA.region === prefsB.region
    );
}

function pruneStaleWaitingQueue() {
    for (const [sockId] of waitingQueue) {
        if (!io.sockets.sockets.has(sockId) || activePairs.has(sockId)) {
            waitingQueue.delete(sockId);
        }
    }
}

// O(1) Debounced Status Broadcaster: Prevents event-loop blocking during 5,000-user spikes
let broadcastTimer = null;

function executeStatusBroadcast() {
    broadcastTimer = null;
    pruneStaleWaitingQueue();
    const totalLive = io.engine.clientsCount;
    const hasSomeoneWaiting = totalLive >= 2 && waitingQueue.size > 0;

    io.emit('live-users', totalLive);
    io.emit('waiting-status', { hasRealStranger: hasSomeoneWaiting });
}

function scheduleStatusBroadcast() {
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(executeStatusBroadcast, 350);
}

setInterval(executeStatusBroadcast, 5000);

// Priority 2: Preference-Aware Matchmaking with Immediate 0ms Fallback
// Never blocks small user pools (e.g., 2 online users)
function findBestMatchSocketId(candidateEntry) {
    const myPrefs = candidateEntry.prefs;
    let tier2MatchId = null;
    let tier3FallbackId = null;

    for (const [otherId, other] of waitingQueue) {
        if (otherId === candidateEntry.socketId) continue;
        if (!io.sockets.sockets.has(otherId) || activePairs.has(otherId)) {
            waitingQueue.delete(otherId);
            continue;
        }

        // Record the very first valid waiting user for immediate fallback (Tier 3)
        if (!tier3FallbackId) {
            tier3FallbackId = otherId;
        }

        const genderOk = isGenderCompatible(myPrefs, other.prefs);
        const regionOk = isRegionCompatible(myPrefs, other.prefs);

        // Tier 1: Exact Gender + Region preference match -> return immediately
        if (genderOk && regionOk) {
            return otherId;
        }

        // Tier 2: Gender preference match (Region relaxed)
        if (genderOk && !tier2MatchId) {
            tier2MatchId = otherId;
        }
    }

    // Return Tier 2 if available, otherwise immediately fall back to Tier 3 (0ms wait)
    return tier2MatchId || tier3FallbackId;
}

function pairTwoUsers(entryA, entryB) {
    const sockA = io.sockets.sockets.get(entryA.socketId);
    const sockB = io.sockets.sockets.get(entryB.socketId);
    if (!sockA || !sockB) return false;

    waitingQueue.delete(sockA.id);
    waitingQueue.delete(sockB.id);

    activePairs.set(sockA.id, sockB.id);
    activePairs.set(sockB.id, sockA.id);

    sockA.emit('matched', { partnerId: sockB.id, initiator: true });
    sockB.emit('matched', { partnerId: sockA.id, initiator: false });
    return true;
}

// Lightweight per-socket rate limiter to protect server at 5,000 concurrent users
function allowSocketAction(socket, bucketKey, maxPerWindow, windowMs) {
    const now = Date.now();
    if (!socket.rateLimits) socket.rateLimits = {};
    let bucket = socket.rateLimits[bucketKey];
    if (!bucket || (now - bucket.start > windowMs)) {
        bucket = { start: now, count: 0 };
        socket.rateLimits[bucketKey] = bucket;
    }
    bucket.count++;
    return bucket.count <= maxPerWindow;
}

io.on('connection', (socket) => {
    scheduleStatusBroadcast();

    socket.on('ping', () => socket.emit('pong'));

    socket.on('join', (preferences) => {
        if (!allowSocketAction(socket, 'join', 8, 5000)) return;

        // Clean up any existing active pair before joining queue
        const existingPartner = activePairs.get(socket.id);
        if (existingPartner) {
            activePairs.delete(socket.id);
            activePairs.delete(existingPartner);
            io.to(existingPartner).emit('peer-disconnected');
        }

        waitingQueue.delete(socket.id);

        const clientEntry = {
            socketId: socket.id,
            ip: getClientIp(socket),
            prefs: normalizePrefs(preferences),
            joinedAt: Date.now()
        };

        const matchSocketId = findBestMatchSocketId(clientEntry);

        if (matchSocketId) {
            const partnerEntry = waitingQueue.get(matchSocketId);
            waitingQueue.delete(matchSocketId);
            if (!partnerEntry || !pairTwoUsers(clientEntry, partnerEntry)) {
                waitingQueue.set(socket.id, clientEntry);
            }
        } else {
            waitingQueue.set(socket.id, clientEntry);
        }

        scheduleStatusBroadcast();
    });

    // Session-Scoped Signaling Validation: Only forward if sender & partnerId are an active pair
    socket.on('offer', (data) => {
        if (!allowSocketAction(socket, 'sdp', 20, 5000)) return;
        if (!data || !data.partnerId) return;
        if (activePairs.get(socket.id) !== data.partnerId) return;
        io.to(data.partnerId).emit('offer', {
            ...data,
            from: socket.id
        });
    });

    socket.on('answer', (data) => {
        if (!allowSocketAction(socket, 'sdp', 20, 5000)) return;
        if (!data || !data.partnerId) return;
        if (activePairs.get(socket.id) !== data.partnerId) return;
        io.to(data.partnerId).emit('answer', {
            ...data,
            from: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        if (!allowSocketAction(socket, 'ice', 120, 5000)) return;
        if (!data || !data.partnerId) return;
        if (activePairs.get(socket.id) !== data.partnerId) return;
        io.to(data.partnerId).emit('ice-candidate', {
            candidate: data.candidate,
            partnerId: data.partnerId,
            from: socket.id
        });
    });

    socket.on('chat-message', (data) => {
        // Allows up to 450 chunks/messages per 10 seconds for 15MB paced file transfer
        if (!allowSocketAction(socket, 'chat', 450, 10000)) return;
        if (!data || !data.partnerId || typeof data.message !== 'string') return;
        if (activePairs.get(socket.id) !== data.partnerId) return;
        io.to(data.partnerId).emit('chat-message', {
            message: data.message,
            from: socket.id
        });
    });

    function cleanUpDisconnect(sockId) {
        waitingQueue.delete(sockId);
        const partnerId = activePairs.get(sockId);
        if (partnerId) {
            activePairs.delete(sockId);
            activePairs.delete(partnerId);
            io.to(partnerId).emit('peer-disconnected');
        }
        scheduleStatusBroadcast();
    }

    socket.on('skip', () => cleanUpDisconnect(socket.id));
    socket.on('disconnect', () => cleanUpDisconnect(socket.id));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`RandomMeet Core active on port ${PORT}`);
});
