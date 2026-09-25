document.getElementById('themeToggle').addEventListener('click', (e) => {
    document.body.classList.toggle('dark-mode');
    e.target.innerText = document.body.classList.contains('dark-mode') ? '☀️ Light' : '🌙 Dark';
});

const socket = io(); 
const ui = {
    home: document.getElementById('homeScreen'), 
    call: document.getElementById('callScreen'), 
    controls: document.getElementById('mediaControls'), 
    localVid: document.getElementById('localVideo'), 
    localVidBox: document.getElementById('localVideoContainer'), 
    remoteVid: document.getElementById('remoteVideo'), 
    chatBox: document.getElementById('chatBox'), 
    spinner: document.getElementById('searchSpinner'), 
    spinnerText: document.getElementById('spinnerText'), 
    btnStart: document.getElementById('startBtn'), 
    btnNext: document.getElementById('nextBtn'), 
    inputChat: document.getElementById('chatInput'), 
    btnSend: document.getElementById('sendBtn'), 
    lblStr: document.getElementById('uiStranger'), 
    nukeOverlay: document.getElementById('nukeOverlay'), 
    livePrompt: document.getElementById('livePrompt'), 
    endChatBtn: document.getElementById('endChatBtn'), 
    fileUpload: document.getElementById('fileUpload'),
    attachBtn: document.getElementById('attachBtn'),
    imgModal: document.getElementById('imageViewerModal'),
    fullImg: document.getElementById('fullScreenImg'),
    closeImgBtn: document.getElementById('closeViewerBtn'),
    dlImgBtn: document.getElementById('downloadImgBtn')
};

let localStream = null;
let peerConn = null;
let partnerId = null;
let isFront = true, isAudioMuted = false, isVideoMuted = false;

let currentState = 'IDLE'; 
let matchSessionId = 0; 
let matchCount = 0; 
let iceQueue = [];
let pendingOffer = null; 

setInterval(() => { if (socket.connected) socket.emit('ping'); }, 20000); 

socket.on('live-users', count => {
    const el = document.getElementById('liveUsersCount');
    if (el) el.innerText = count;
});

socket.on('disconnect', () => { 
    addSystemMsg("Connection lost. Reconnecting..."); 
    fullNukeAndReset(); 
});

document.getElementById('logoBtn').addEventListener('click', () => { 
    if (currentState !== 'IDLE') ui.endChatBtn.click(); 
});

function checkDonationOnHome() {
    if (matchCount >= 20) {
        matchCount = 0; 
        document.getElementById('donationText').innerHTML = `<span class="text-pink-500 font-bold text-sm block mb-1">You've enjoyed 20 chats! ❤️</span>As a solo developer, I'm paying heavy server costs from my pocket to keep this ad-free for you. If you love this app, please consider a small tip. It keeps the platform alive! 🥺🙏<br><br><span class="text-green-500 font-bold">🇮🇳 India:</span> ₹20, ₹50+ (UPI).<br><span class="text-blue-500 font-bold">🌍 Global:</span> Buy Coffee or send $5+ Crypto.`;
        document.getElementById('donationModal').classList.remove('hidden-ui');
    }
}

function openRegularDonation() {
    document.getElementById('donationModal').classList.remove('hidden-ui');
}

async function getMediaStream(facingModeConstraint) {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const finalFacingMode = facingModeConstraint || (isFront ? "user" : "environment");
    
    const constraints = { 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, 
        video: isMobile 
            ? { facingMode: finalFacingMode, width: { ideal: 640 }, height: { ideal: 480 } } 
            : { width: { ideal: 640 }, height: { ideal: 480 } } 
    };
    
    try { 
        return await navigator.mediaDevices.getUserMedia(constraints); 
    } catch (e1) {
        try { 
            return await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); 
        } catch (e2) { 
            return await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); 
        }
    }
}

ui.btnStart.addEventListener('click', async () => {
    if (currentState !== 'IDLE') return;
    initiateSearch();
});

ui.btnNext.addEventListener('click', () => {
    if (currentState === 'SEARCHING') return; 
    
    ui.btnNext.disabled = true; 
    ui.nukeOverlay.classList.remove('hidden-ui');
    
    killWebRTC();
    socket.emit('skip'); 
    
    setTimeout(() => {
        ui.nukeOverlay.classList.add('hidden-ui');
        initiateSearch(); 
    }, 500); 
});

ui.endChatBtn.addEventListener('click', () => { 
    fullNukeAndReset(); 
    checkDonationOnHome(); 
});

async function initiateSearch() {
    currentState = 'SEARCHING';
    matchSessionId++; 
    partnerId = null;

    ui.btnStart.disabled = true; 
    ui.btnNext.disabled = false;

    ui.livePrompt.classList.add('hidden-ui'); 
    document.getElementById('strangerCountryBox').classList.add('hidden-ui'); 
    document.getElementById('waitMessage').classList.remove('hidden');

    ui.home.classList.add('hidden-ui'); 
    document.getElementById('homeTicker').classList.add('hidden-ui'); 
    document.getElementById('shareTicker').classList.add('hidden-ui');
    
    ui.call.classList.remove('hidden-ui'); 
    ui.call.classList.add('flex');
    ui.lblStr.classList.add('hidden-ui'); 
    ui.controls.classList.add('hidden-ui'); 
    ui.inputChat.disabled = true; 
    ui.btnSend.disabled = true; 
    ui.chatBox.innerHTML = '';
    
    ui.spinnerText.innerText = "Initializing Camera..."; 
    ui.spinner.classList.remove('hidden-ui'); 
    ui.spinner.classList.add('flex');

    try {
        if (!localStream) {
            localStream = await getMediaStream();
        }
        ui.localVid.srcObject = localStream;
        ui.localVid.play().catch(e => console.warn(e));
        ui.localVidBox.classList.remove('hidden-ui');
    } catch (err) { 
        alert("Camera and Microphone access required!"); 
        fullNukeAndReset(); 
        return; 
    } 

    ui.spinnerText.innerText = "Searching for someone...";
    socket.emit('join', { 
        myGender: document.getElementById('myGender').value, 
        lookingFor: document.getElementById('lookingFor').value, 
        region: document.getElementById('countryFilter').value 
    }); 
}

setInterval(() => {
    const el = document.getElementById('liveUsersCount');
    if (el && parseInt(el.innerText) >= 2 && !ui.home.classList.contains('hidden-ui')) {
        ui.livePrompt.classList.remove('hidden-ui', 'slide-out'); 
        ui.livePrompt.classList.add('slide-in');
        setTimeout(() => {
            if(!ui.livePrompt.classList.contains('hidden-ui')) {
                ui.livePrompt.classList.remove('slide-in'); 
                ui.livePrompt.classList.add('slide-out');
                setTimeout(() => { 
                    ui.livePrompt.classList.add('hidden-ui'); 
                    ui.livePrompt.classList.remove('slide-out'); 
                }, 400);
            }
        }, 3000); 
    }
}, 10000);

socket.on('matched', async (data) => {
    if (currentState !== 'SEARCHING') { socket.emit('skip'); return; } 
    
    currentState = 'CONNECTED';
    matchCount++;
    partnerId = data.partnerId;
    ui.btnNext.disabled = false;
    
    ui.spinner.classList.add('hidden-ui'); 
    ui.spinner.classList.remove('flex');
    ui.controls.classList.remove('hidden-ui'); 
    ui.lblStr.classList.remove('hidden-ui'); 
    ui.inputChat.disabled = false; 
    ui.btnSend.disabled = false;
    ui.btnSend.classList.add('solid-btn-primary', 'text-white'); 
    ui.btnSend.classList.remove('bg-gray-300');
    
    document.getElementById('waitMessage').classList.add('hidden'); 
    document.getElementById('strangerCountryBox').classList.remove('hidden');
    addSystemMsg("Stranger connected. Say Hi!");

    createPeerConnection(matchSessionId);

    if (data.initiator) {
        try {
            const offer = await peerConn.createOffer({
                offerToReceiveAudio: true, 
                offerToReceiveVideo: true
            });
            await peerConn.setLocalDescription(offer);
            socket.emit('offer', { sdp: offer, partnerId });
        } catch(e) { console.error("Offer Error:", e); }
    } else if (pendingOffer) { 
        processOffer(pendingOffer, matchSessionId); 
        pendingOffer = null;
    }
});

// =========================================================================
// METERED TURN + DESKTOP/LAPTOP BULLETPROOF MEDIA ATTACHMENT
// =========================================================================
function createPeerConnection(sessionId) {
    peerConn = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            { urls: "stun:stun2.l.google.com:19302" },
            { urls: "turn:global.relay.metered.ca:80", username: "eb5ef206ad4b56f7c91347f4", credential: "ELkjSHNeiKI1svYE" },
            { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: "eb5ef206ad4b56f7c91347f4", credential: "ELkjSHNeiKI1svYE" },
            { urls: "turn:global.relay.metered.ca:443", username: "eb5ef206ad4b56f7c91347f4", credential: "ELkjSHNeiKI1svYE" },
            { urls: "turn:global.relay.metered.ca:443?transport=tcp", username: "eb5ef206ad4b56f7c91347f4", credential: "ELkjSHNeiKI1svYE" },
            { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "eb5ef206ad4b56f7c91347f4", credential: "ELkjSHNeiKI1svYE" }
        ],
        iceTransportPolicy: "all", 
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
        iceCandidatePoolSize: 2
    });
    iceQueue = []; 

    if (localStream) { 
        localStream.getTracks().forEach(t => peerConn.addTrack(t, localStream)); 
    }
    
    peerConn.oniceconnectionstatechange = () => {
        if (peerConn && (peerConn.iceConnectionState === 'failed' || peerConn.iceConnectionState === 'disconnected')) {
            peerConn.restartIce();
        }
    };

    peerConn.ontrack = (event) => {
        if (sessionId !== matchSessionId || currentState !== 'CONNECTED') return; 
        
        const remoteVideo = ui.remoteVid;
        if (!remoteVideo.srcObject) {
            remoteVideo.srcObject = new MediaStream();
        }

        const inboundStream = remoteVideo.srcObject;

        if (event.track) {
            if (!inboundStream.getTracks().some(t => t.id === event.track.id)) {
                inboundStream.addTrack(event.track);
            }
        } else if (event.streams && event.streams[0]) {
            event.streams[0].getTracks().forEach(t => {
                if (!inboundStream.getTracks().some(existing => existing.id === t.id)) {
                    inboundStream.addTrack(t);
                }
            });
        }
        
        const playStream = () => {
            const promise = remoteVideo.play();
            if (promise !== undefined) {
                promise.catch(() => {
                    remoteVideo.muted = true;
                    remoteVideo.play().then(() => {
                        setTimeout(() => { remoteVideo.muted = false; }, 250);
                    }).catch(err => console.warn("Autoplay retry bypassed:", err));
                });
            }
        };

        remoteVideo.onloadedmetadata = playStream;
        playStream();
    };

    peerConn.onicecandidate = (e) => { 
        if (sessionId !== matchSessionId) return;
        if (e.candidate && partnerId) socket.emit('ice-candidate', { candidate: e.candidate, partnerId }); 
    };
}

socket.on('offer', async (data) => { 
    if (currentState !== 'CONNECTED' || !peerConn) {
        pendingOffer = data; 
        return; 
    }
    processOffer(data, matchSessionId); 
});

async function processOffer(data, sessionId) {
    if (sessionId !== matchSessionId || !peerConn) return;
    try {
        await peerConn.setRemoteDescription(new RTCSessionDescription(data.sdp));
        while (iceQueue.length > 0) { 
            await peerConn.addIceCandidate(iceQueue.shift()).catch(()=>{}); 
        }
        
        const answer = await peerConn.createAnswer({
            offerToReceiveAudio: true, 
            offerToReceiveVideo: true
        });
        await peerConn.setLocalDescription(answer);
        socket.emit('answer', { sdp: answer, partnerId: partnerId }); 
    } catch(e) { console.error("Process Offer Error:", e); }
}

socket.on('answer', async (data) => { 
    try { 
        if (peerConn && peerConn.signalingState !== "closed") {
            await peerConn.setRemoteDescription(new RTCSessionDescription(data.sdp)); 
        }
    } catch(e) {} 
});

socket.on('ice-candidate', async (data) => { 
    if (!data.candidate) return; 
    const c = new RTCIceCandidate(data.candidate); 
    if (peerConn && peerConn.remoteDescription && peerConn.remoteDescription.type) {
        await peerConn.addIceCandidate(c).catch(()=>{}); 
    } else { 
        iceQueue.push(c); 
    }
});

socket.on('peer-disconnected', () => {
    if (currentState !== 'CONNECTED') return;
    addSystemMsg('Stranger left. Press Next.');
    document.getElementById('strangerCountryBox').classList.add('hidden'); 
    ui.lblStr.classList.add('hidden-ui');
    killWebRTC(); 
    
    setTimeout(() => {
        if (currentState === 'CONNECTED' || currentState === 'SEARCHING') {
            ui.btnNext.click();
        }
    }, 800);
});

function killWebRTC() {
    if (peerConn) { 
        peerConn.ontrack = null; 
        peerConn.onicecandidate = null; 
        peerConn.oniceconnectionstatechange = null;
        peerConn.close(); 
        peerConn = null; 
    }
    if (ui.remoteVid) {
        ui.remoteVid.onloadedmetadata = null;
        if (ui.remoteVid.srcObject) { 
            ui.remoteVid.srcObject.getTracks().forEach(t => t.stop()); 
            ui.remoteVid.srcObject = null; 
        }
    }
    partnerId = null;
    pendingOffer = null;
    iceQueue = [];
}

function fullNukeAndReset() {
    currentState = 'IDLE';
    matchSessionId++;
    socket.emit('skip');
    killWebRTC();
    
    if (localStream) { 
        localStream.getTracks().forEach(t => t.stop()); 
        localStream = null; 
    }
    ui.localVid.srcObject = null; 
    
    isAudioMuted = false; 
    isVideoMuted = false;
    document.getElementById('muteBtn').innerText = '🎤'; 
    document.getElementById('camBtn').innerText = '📷'; 
    
    ui.controls.classList.add('hidden-ui'); 
    ui.btnStart.disabled = false; 
    ui.btnNext.disabled = false; 
    ui.localVidBox.classList.add('hidden-ui'); 
    
    ui.inputChat.value = ''; 
    ui.inputChat.disabled = true; 
    ui.btnSend.disabled = true; 
    ui.btnSend.classList.remove('solid-btn-primary', 'text-white'); 
    ui.btnSend.classList.add('bg-gray-300');
    
    ui.spinner.classList.add('hidden-ui'); 
    ui.lblStr.classList.add('hidden-ui'); 
    
    ui.call.classList.add('hidden-ui'); 
    ui.call.classList.remove('flex'); 
    
    ui.home.classList.remove('hidden-ui'); 
    document.getElementById('homeTicker').classList.remove('hidden-ui'); 
    document.getElementById('shareTicker').classList.remove('hidden-ui');
}

// =========================================================================
// LIMITS: 30 WORDS & 15MB MEDIA
// =========================================================================
ui.btnSend.addEventListener('click', sendMsg); 
ui.inputChat.addEventListener('keypress', (e) => { 
    if (e.key === 'Enter') { e.preventDefault(); sendMsg(); } 
});

function sendMsg() { 
    const raw = ui.inputChat.value.trim(); 
    if (!raw || !partnerId || currentState !== 'CONNECTED') return;

    const words = raw.split(/\s+/).filter(w => w.length > 0);
    if (words.length > 30) {
        addSystemMsg("Limit: Maximum 30 words per message allowed.");
        return;
    }

    const cleanText = words.slice(0, 30).join(' ');
    socket.emit('chat-message', { message: cleanText, partnerId }); 
    addMsg('You', cleanText, true, false); 
    ui.inputChat.value = ''; 
}

ui.attachBtn.addEventListener('click', () => ui.fileUpload.click());

ui.fileUpload.addEventListener('change', function(e) {
    const file = e.target.files[0]; 
    if (!file || !partnerId || currentState !== 'CONNECTED') return;
    
    const MAX_SIZE = 15 * 1024 * 1024;
    if (file.size > MAX_SIZE) { 
        addSystemMsg("File too large! Max 15MB allowed for Audio/Video/Images."); 
        ui.fileUpload.value = '';
        return; 
    }
    
    const isVid = file.type.startsWith('video/');
    const isAud = file.type.startsWith('audio/');
    addSystemMsg(`Sending ${isVid ? 'Video' : isAud ? 'Audio' : 'Photo'}...`);
    
    const reader = new FileReader();
    reader.onload = function(event) {
        const base64Str = event.target.result; 
        const chunkSize = 40000; 
        const totalChunks = Math.ceil(base64Str.length / chunkSize); 
        const fileId = Date.now().toString();
        
        for (let i = 0; i < totalChunks; i++) { 
            const chunkData = base64Str.substring(i * chunkSize, (i + 1) * chunkSize); 
            const payload = JSON.stringify({ 
                type: 'chunk', fileId, chunk: chunkData, index: i, total: totalChunks, isVideo: isVid, isAudio: isAud
            }); 
            socket.emit('chat-message', { message: payload, partnerId }); 
        }
        addMsg('You', base64Str, true, isVid, isAud);
    }; 
    reader.readAsDataURL(file); 
    ui.fileUpload.value = ''; 
});

let incomingFiles = {};
socket.on('chat-message', (msg) => {
    if (currentState !== 'CONNECTED') return;
    try { 
        const data = JSON.parse(msg); 
        if (data.type === 'chunk') { 
            if (!incomingFiles[data.fileId]) incomingFiles[data.fileId] = []; 
            incomingFiles[data.fileId][data.index] = data.chunk; 
            if (Object.keys(incomingFiles[data.fileId]).length === data.total) { 
                const fullData = incomingFiles[data.fileId].join(''); 
                addMsg('Stranger', fullData, false, data.isVideo, data.isAudio); 
                delete incomingFiles[data.fileId]; 
            } 
            return; 
        } 
    } catch(e) { 
        addMsg('Stranger', msg, false, false, false); 
    }
});

socket.on('system-message', (msg) => addSystemMsg(msg));

function escapeHTML(str) { 
    return str.replace(/[&<>'"]/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t)); 
}

function openImageViewer(src) {
    ui.fullImg.src = src;
    ui.dlImgBtn.href = src;
    ui.imgModal.classList.remove('hidden-ui');
}

ui.closeImgBtn.addEventListener('click', () => {
    ui.imgModal.classList.add('hidden-ui');
    ui.fullImg.src = '';
    ui.dlImgBtn.href = '';
});

ui.chatBox.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG' && e.target.classList.contains('chat-media')) {
        openImageViewer(e.target.src);
    }
});

function addMsg(sender, text, isMe, isVideo, isAudio) {
    const d = document.createElement('div'); 
    d.className = `max-w-[85%] p-2 rounded-xl ${isMe ? 'bg-pink-500 text-white rounded-br-sm self-end' : 'solid-panel border-border-color rounded-bl-sm self-start stranger-bubble'} shadow-sm`;
    
    if (isVideo) { 
        d.innerHTML = `<span class="text-[9px] font-bold block mb-1 opacity-70">${escapeHTML(sender)}</span><video controls autoplay muted playsinline class="chat-media"><source src="${text}"></video>`; 
    } else if (isAudio) {
        d.innerHTML = `<span class="text-[9px] font-bold block mb-1 opacity-70">${escapeHTML(sender)}</span><audio controls class="mt-1 w-full max-w-[200px]"><source src="${text}"></audio>`; 
    } else if (text.startsWith('data:image')) { 
        d.innerHTML = `<span class="text-[9px] font-bold block mb-1 opacity-70">${escapeHTML(sender)}</span><img src="${text}" class="chat-media" alt="photo">`; 
    } else { 
        d.innerHTML = `<span class="text-[9px] font-bold block mb-0.5 opacity-70">${escapeHTML(sender)}</span><span class="text-xs break-words">${escapeHTML(text)}</span>`; 
    }
    
    ui.chatBox.appendChild(d); 
    setTimeout(() => ui.chatBox.scrollTop = ui.chatBox.scrollHeight, 50); 
}

function addSystemMsg(text) { 
    const d = document.createElement('div'); 
    d.className = "text-center text-[10px] font-bold text-muted my-1 py-1 rounded-full mx-auto px-4 border border-border-color"; 
    d.innerText = text; 
    ui.chatBox.appendChild(d); 
    setTimeout(() => ui.chatBox.scrollTop = ui.chatBox.scrollHeight, 50); 
}

document.getElementById('muteBtn').addEventListener('click', (e) => { 
    if (!localStream) return; 
    isAudioMuted = !isAudioMuted; 
    localStream.getAudioTracks()[0].enabled = !isAudioMuted; 
    e.target.innerText = !isAudioMuted ? '🎤' : '🔇'; 
    e.target.classList.toggle('text-red-500', isAudioMuted); 
});

document.getElementById('camBtn').addEventListener('click', (e) => { 
    if (!localStream) return; 
    isVideoMuted = !isVideoMuted; 
    localStream.getVideoTracks()[0].enabled = !isVideoMuted; 
    e.target.innerText = !isVideoMuted ? '📷' : '🚫'; 
    e.target.classList.toggle('text-red-500', isVideoMuted); 
});

document.getElementById('flipBtn').addEventListener('click', async () => { 
    if (!localStream) return; 
    
    isFront = !isFront; 
    const oldVideoTrack = localStream.getVideoTracks()[0];
    if (oldVideoTrack) oldVideoTrack.stop(); 
    
    try {
        const newFacing = isFront ? "user" : "environment";
        const freshStream = await getMediaStream(newFacing); 
        const newTrack = freshStream.getVideoTracks()[0]; 
        newTrack.enabled = !isVideoMuted;
        
        localStream.removeTrack(oldVideoTrack); 
        localStream.addTrack(newTrack); 
        
        ui.localVid.srcObject = localStream; 
        ui.localVid.classList.toggle('true-mirror', isFront); 
        
        if (peerConn) { 
            const sender = peerConn.getSenders().find(s => s.track && s.track.kind === 'video'); 
            if (sender) sender.replaceTrack(newTrack); 
        } 
    } catch (err) {
        console.warn("Camera Flip Error:", err);
        addSystemMsg("Camera switch not supported on this device.");
        isFront = !isFront;
    }
});

let isDragging = false, startX, startY, initialRight, initialBottom;

ui.localVidBox.addEventListener('touchstart', dragStart, {passive: false}); 
ui.localVidBox.addEventListener('touchmove', drag, {passive: false}); 
ui.localVidBox.addEventListener('touchend', dragEnd); 
ui.localVidBox.addEventListener('mousedown', dragStart); 

document.addEventListener('mousemove', drag); 
document.addEventListener('mouseup', dragEnd);

function dragStart(e) { 
    isDragging = true; 
    const style = window.getComputedStyle(ui.localVidBox); 
    initialRight = parseInt(style.right) || 12; 
    initialBottom = parseInt(style.bottom) || 220; 
    
    startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX; 
    startY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY; 
}

function drag(e) { 
    if (!isDragging) return; 
    e.preventDefault(); 
    
    const curX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX; 
    const curY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY; 
    
    let newRight = initialRight + (startX - curX); 
    let newBottom = initialBottom + (startY - curY); 
    
    const maxRight = window.innerWidth - ui.localVidBox.offsetWidth; 
    const maxBottom = window.innerHeight - ui.localVidBox.offsetHeight; 
    
    if (newRight < 0) newRight = 0; 
    if (newRight > maxRight) newRight = maxRight; 
    if (newBottom < 0) newBottom = 0; 
    if (newBottom > maxBottom) newBottom = maxBottom; 
    
    ui.localVidBox.style.right = newRight + 'px'; 
    ui.localVidBox.style.bottom = newBottom + 'px'; 
}

function dragEnd() { 
    isDragging = false; 
}
