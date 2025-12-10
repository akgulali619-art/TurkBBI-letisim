// Socket.io bağlantısı
const socket = io();

// Kullanıcı bilgisi
let currentUser = null;
let activeUsers = [];

// WebRTC
let localStream = null;
let peerConnection = null;
let callTargetSocketId = null;
let screenStream = null;
let isScreenSharing = false;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // Ücretsiz TURN sunucusu
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ],
    iceCandidatePoolSize: 10
};

// DOM Elementleri
const $ = id => document.getElementById(id);

const dom = {
    loginScreen: $('login-screen'),
    chatScreen: $('chat-screen'),
    loginForm: $('login-form'),
    usernameInput: $('username-input'),
    loginError: $('login-error'),
    messages: $('messages'),
    messageForm: $('message-form'),
    messageInput: $('message-input'),
    imageInput: $('image-input'),
    imagePreview: $('image-preview'),
    previewImg: $('preview-img'),
    cancelImage: $('cancel-image'),
    userList: $('user-list'),
    onlineCount: $('online-count'),
    myUsername: $('my-username'),
    logoutBtn: $('logout-btn'),
    typingIndicator: $('typing-indicator'),
    // Sesli mesaj
    voiceBtn: $('voice-btn'),
    voiceRecording: $('voice-recording'),
    recordingTime: $('recording-time'),
    stopRecording: $('stop-recording'),
    cancelRecording: $('cancel-recording'),
    // Arama
    callModal: $('call-modal'),
    callStatus: $('call-status'),
    callUsername: $('call-username'),
    localVideo: $('local-video'),
    remoteVideo: $('remote-video'),
    toggleMic: $('toggle-mic'),
    toggleCamera: $('toggle-camera'),
    endCall: $('end-call'),
    shareScreen: $('share-screen'),
    // Gelen arama
    incomingModal: $('incoming-modal'),
    callerName: $('caller-name'),
    callTypeText: $('call-type-text'),
    acceptCall: $('accept-call'),
    rejectCall: $('reject-call'),
    // Kullanıcı seç
    userSelectModal: $('user-select-modal'),
    selectTitle: $('select-title'),
    selectableUsers: $('selectable-users'),
    closeSelect: $('close-select')
};

let selectedImage = null;
let incomingCallData = null;

// Sesli mesaj
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// Yardımcı fonksiyonlar
function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function switchScreen(screen) {
    dom.loginScreen.classList.remove('active');
    dom.chatScreen.classList.remove('active');
    if (screen === 'login') dom.loginScreen.classList.add('active');
    else dom.chatScreen.classList.add('active');
}

function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Sesli mesaj oynatma
window.toggleVoicePlay = function(audioId) {
    const audio = document.getElementById(audioId);
    const btn = audio.parentElement.querySelector('.play-voice i');
    
    if (audio.paused) {
        // Diğer tüm sesleri durdur
        document.querySelectorAll('audio').forEach(a => {
            if (a.id !== audioId && !a.paused) {
                a.pause();
                a.currentTime = 0;
                a.parentElement.querySelector('.play-voice i').className = 'fas fa-play';
            }
        });
        
        audio.play();
        btn.className = 'fas fa-pause';
        
        audio.onended = () => {
            btn.className = 'fas fa-play';
        };
    } else {
        audio.pause();
        audio.currentTime = 0;
        btn.className = 'fas fa-play';
    }
};

// ==================== GİRİŞ ====================
dom.loginForm.addEventListener('submit', e => {
    e.preventDefault();
    const username = dom.usernameInput.value.trim();
    if (!username) return;

    socket.emit('check_username', username, res => {
        if (res.success) {
            currentUser = res.user;
            dom.myUsername.textContent = currentUser.username;
            dom.loginError.classList.add('hidden');
            switchScreen('chat');
            dom.messageInput.focus();
        } else {
            dom.loginError.textContent = res.message;
            dom.loginError.classList.remove('hidden');
        }
    });
});

dom.logoutBtn.addEventListener('click', () => {
    if (confirm('Çıkmak istediğinize emin misiniz?')) location.reload();
});

// ==================== MESAJLAŞMA ====================
dom.messageForm.addEventListener('submit', e => {
    e.preventDefault();
    
    if (selectedImage) {
        socket.emit('send_image', { imageBase64: selectedImage });
        cancelImageSelection();
        return;
    }

    const text = dom.messageInput.value.trim();
    if (!text) return;

    socket.emit('send_message', { text });
    dom.messageInput.value = '';
    socket.emit('typing_stop');
});

// Fotoğraf seçimi
dom.imageInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
        alert('Dosya 5MB\'dan küçük olmalı.');
        return;
    }

    const reader = new FileReader();
    reader.onload = ev => {
        selectedImage = ev.target.result;
        dom.previewImg.src = selectedImage;
        dom.imagePreview.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
});

dom.cancelImage.addEventListener('click', cancelImageSelection);

function cancelImageSelection() {
    selectedImage = null;
    dom.imageInput.value = '';
    dom.imagePreview.classList.add('hidden');
}

// Yazıyor durumu
let typingTimeout;
dom.messageInput.addEventListener('input', () => {
    socket.emit('typing_start');
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('typing_stop'), 2000);
});

// ==================== SESLİ MESAJ ====================
let recordingInterval = null;
let recordingSeconds = 0;

// Sesli mesaj butonu - basılı tut
dom.voiceBtn.addEventListener('mousedown', startVoiceRecording);
dom.voiceBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startVoiceRecording();
});

dom.voiceBtn.addEventListener('mouseup', () => stopVoiceRecording(false));
dom.voiceBtn.addEventListener('mouseleave', () => stopVoiceRecording(true));
dom.voiceBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    stopVoiceRecording(false);
});

// Kayıt durdur butonu
dom.stopRecording.addEventListener('click', () => stopVoiceRecording(false));

// Kayıt iptal butonu
dom.cancelRecording.addEventListener('click', () => stopVoiceRecording(true));

async function startVoiceRecording() {
    if (isRecording) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        mediaRecorder = new MediaRecorder(stream, {
            mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg'
        });
        
        audioChunks = [];
        recordingSeconds = 0;

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            stream.getTracks().forEach(track => track.stop());
            
            if (audioChunks.length > 0) {
                const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
                const reader = new FileReader();
                
                reader.onload = () => {
                    socket.emit('send_voice', {
                        audioBase64: reader.result,
                        duration: recordingSeconds,
                        mimeType: mediaRecorder.mimeType
                    });
                };
                
                reader.readAsDataURL(audioBlob);
            }
            
            audioChunks = [];
        };

        mediaRecorder.start();
        isRecording = true;

        // Kayıt UI'sini göster
        dom.voiceRecording.classList.remove('hidden');
        dom.voiceBtn.style.display = 'none';
        dom.messageInput.disabled = true;

        // Süre sayacı
        recordingInterval = setInterval(() => {
            recordingSeconds++;
            const mins = Math.floor(recordingSeconds / 60);
            const secs = recordingSeconds % 60;
            dom.recordingTime.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

            // 2 dakika limiti
            if (recordingSeconds >= 120) {
                stopVoiceRecording(false);
            }
        }, 1000);

    } catch (err) {
        console.error('Mikrofon hatası:', err);
        alert('Mikrofon erişimi sağlanamadı.\nTarayıcı ayarlarından mikrofon iznini verin.');
    }
}

function stopVoiceRecording(cancel) {
    if (!isRecording) return;

    isRecording = false;
    clearInterval(recordingInterval);

    if (cancel || recordingSeconds < 1) {
        // İptal - kaydetme
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            audioChunks = [];
        }
    } else {
        // Kaydet ve gönder
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
    }

    // UI'yi sıfırla
    dom.voiceRecording.classList.add('hidden');
    dom.voiceBtn.style.display = 'flex';
    dom.messageInput.disabled = false;
    dom.recordingTime.textContent = '0:00';
    recordingSeconds = 0;
}

// ==================== SOCKET OLAYLARI ====================
socket.on('new_message', data => {
    const isSent = data.username === currentUser?.username;
    const div = document.createElement('div');
    div.className = `message ${isSent ? 'sent' : 'received'}`;

    let content = `<div class="meta"><span class="user">${data.username}</span><span>${formatTime(data.timestamp)}</span></div>`;
    
    if (data.type === 'image') {
        content += `<img src="${data.imageBase64}" onclick="window.open(this.src)">`;
    } else if (data.type === 'voice') {
        const audioId = `audio-${data.id || Date.now()}`;
        content += `
            <div class="voice-message">
                <button class="play-voice" onclick="toggleVoicePlay('${audioId}')">
                    <i class="fas fa-play"></i>
                </button>
                <div class="voice-info">
                    <div class="voice-wave"></div>
                    <span class="voice-duration">${formatDuration(data.duration)}</span>
                </div>
                <audio id="${audioId}" src="${data.audioBase64}"></audio>
            </div>
        `;
    } else {
        content += `<div class="text">${escapeHTML(data.text)}</div>`;
    }

    div.innerHTML = content;
    dom.messages.appendChild(div);
    dom.messages.scrollTop = dom.messages.scrollHeight;
});

socket.on('user_list_updated', users => {
    activeUsers = users;
    updateUserList();
});

socket.on('user_joined', data => {
    addSystemMsg(`${data.username} katıldı`, 'join');
});

socket.on('user_left', data => {
    addSystemMsg(`${data.username} ayrıldı`, 'leave');
});

socket.on('user_typing', data => {
    if (data.isTyping) {
        dom.typingIndicator.textContent = `${data.username} yazıyor...`;
        dom.typingIndicator.classList.remove('hidden');
    } else {
        dom.typingIndicator.classList.add('hidden');
    }
});

function addSystemMsg(text, type) {
    const div = document.createElement('div');
    div.className = `system-msg ${type}`;
    div.innerHTML = `<i class="fas fa-${type === 'join' ? 'user-plus' : 'user-minus'}"></i> ${text}`;
    dom.messages.appendChild(div);
    dom.messages.scrollTop = dom.messages.scrollHeight;
}

// ==================== KULLANICI LİSTESİ ====================
function updateUserList() {
    dom.onlineCount.textContent = activeUsers.length;
    dom.userList.innerHTML = '';

    activeUsers.forEach(user => {
        if (user.username === currentUser?.username) return;

        const div = document.createElement('div');
        div.className = 'user-item';
        div.innerHTML = `
            <div class="avatar">${user.username[0].toUpperCase()}</div>
            <span class="name">${user.username}</span>
            <div class="call-btns">
                <button class="audio-call" title="Sesli Ara"><i class="fas fa-phone"></i></button>
                <button class="video-call" title="Görüntülü Ara"><i class="fas fa-video"></i></button>
            </div>
        `;

        // Arama butonları
        div.querySelector('.audio-call').addEventListener('click', e => {
            e.stopPropagation();
            startCall(user.username, user.socketId, 'audio');
        });
        div.querySelector('.video-call').addEventListener('click', e => {
            e.stopPropagation();
            startCall(user.username, user.socketId, 'video');
        });

        dom.userList.appendChild(div);
    });
}

// ==================== WebRTC ARAMA ====================
async function startCall(username, socketId, type) {
    callTargetSocketId = socketId;

    // Medya cihazlarının varlığını kontrol et
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Tarayıcınız kamera/mikrofon desteği sağlamıyor.\n\nHTTPS üzerinden erişmeyi deneyin veya tarayıcınızı güncelleyin.');
        return;
    }

    try {
        // İzin isteği
        const constraints = {
            audio: true,
            video: type === 'video' ? {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } : false
        };

        localStream = await navigator.mediaDevices.getUserMedia(constraints);

        dom.localVideo.srcObject = localStream;
        dom.callStatus.textContent = 'Aranıyor...';
        dom.callUsername.textContent = username;
        dom.callModal.classList.remove('hidden');

        if (type === 'audio') {
            dom.localVideo.style.display = 'none';
            dom.remoteVideo.style.display = 'none';
        } else {
            dom.localVideo.style.display = 'block';
            dom.remoteVideo.style.display = 'block';
        }

        createPeerConnection();

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        const offer = await peerConnection.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: type === 'video'
        });
        await peerConnection.setLocalDescription(offer);

        console.log('Arama başlatıldı:', username, type);

        socket.emit('call_user', {
            targetUsername: username,
            callType: type,
            offer: offer
        });

    } catch (err) {
        console.error('Arama hatası:', err);
        let errorMsg = 'Kamera/mikrofon erişimi sağlanamadı.\n\n';
        
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            errorMsg += '❌ İzin reddedildi.\nTarayıcı ayarlarından kamera/mikrofon iznini verin.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            errorMsg += '❌ Kamera veya mikrofon bulunamadı.\nCihazınızı kontrol edin.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            errorMsg += '❌ Cihaz zaten kullanımda.\nDiğer uygulamaları kapatın.';
        } else if (err.name === 'OverconstrainedError') {
            errorMsg += '❌ Kamera ayarları desteklenmiyor.';
        } else if (err.name === 'NotSupportedError') {
            errorMsg += '❌ HTTPS gerekli!\nhttp://192.168.1.151:3000 yerine\nlocalhost:3000 kullanın veya HTTPS kurun.';
        } else {
            errorMsg += `Hata: ${err.message}`;
        }
        
        alert(errorMsg);
        closeCall();
    }
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = e => {
        if (e.candidate && callTargetSocketId) {
            console.log('ICE Candidate:', e.candidate.type);
            socket.emit('ice_candidate', {
                targetSocketId: callTargetSocketId,
                candidate: e.candidate
            });
        }
    };

    peerConnection.ontrack = e => {
        console.log('Remote track alındı:', e.streams[0]);
        dom.remoteVideo.srcObject = e.streams[0];
        dom.callStatus.textContent = 'Bağlandı';
    };

    peerConnection.onconnectionstatechange = () => {
        console.log('Bağlantı durumu:', peerConnection.connectionState);
        
        if (peerConnection.connectionState === 'connected') {
            dom.callStatus.textContent = 'Bağlı';
        } else if (peerConnection.connectionState === 'connecting') {
            dom.callStatus.textContent = 'Bağlanıyor...';
        } else if (peerConnection.connectionState === 'disconnected') {
            dom.callStatus.textContent = 'Bağlantı koptu';
            setTimeout(() => closeCall(), 3000);
        } else if (peerConnection.connectionState === 'failed') {
            dom.callStatus.textContent = 'Bağlantı başarısız';
            alert('Arama bağlantısı kurulamadı. Lütfen tekrar deneyin.');
            closeCall();
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log('ICE durumu:', peerConnection.iceConnectionState);
    };
}

// Gelen arama
socket.on('incoming_call', data => {
    incomingCallData = data;
    callTargetSocketId = data.callerSocketId;
    dom.callerName.textContent = data.callerUsername;
    dom.callTypeText.textContent = data.callType === 'video' ? 'Görüntülü Arama' : 'Sesli Arama';
    dom.incomingModal.classList.remove('hidden');
});

dom.acceptCall.addEventListener('click', async () => {
    if (!incomingCallData) return;
    dom.incomingModal.classList.add('hidden');

    // Medya cihazlarının varlığını kontrol et
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Tarayıcınız kamera/mikrofon desteği sağlamıyor.\n\nHTTPS üzerinden erişmeyi deneyin.');
        incomingCallData = null;
        return;
    }

    try {
        const constraints = {
            audio: true,
            video: incomingCallData.callType === 'video' ? {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } : false
        };

        localStream = await navigator.mediaDevices.getUserMedia(constraints);

        dom.localVideo.srcObject = localStream;
        dom.callStatus.textContent = 'Bağlanıyor...';
        dom.callUsername.textContent = incomingCallData.callerUsername;
        dom.callModal.classList.remove('hidden');

        if (incomingCallData.callType === 'audio') {
            dom.localVideo.style.display = 'none';
            dom.remoteVideo.style.display = 'none';
        } else {
            dom.localVideo.style.display = 'block';
            dom.remoteVideo.style.display = 'block';
        }

        createPeerConnection();

        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });

        await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingCallData.offer));
        const answer = await peerConnection.createAnswer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: incomingCallData.callType === 'video'
        });
        await peerConnection.setLocalDescription(answer);

        console.log('Arama kabul edildi');

        socket.emit('call_answer', {
            callerSocketId: incomingCallData.callerSocketId,
            accepted: true,
            answer: answer
        });

    } catch (err) {
        console.error('Kabul hatası:', err);
        let errorMsg = 'Kamera/mikrofon erişimi sağlanamadı.\n\n';
        
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            errorMsg += '❌ İzin reddedildi.\nTarayıcı ayarlarından izni verin.';
        } else if (err.name === 'NotFoundError') {
            errorMsg += '❌ Kamera/mikrofon bulunamadı.';
        } else if (err.name === 'NotReadableError') {
            errorMsg += '❌ Cihaz kullanımda.';
        } else if (err.name === 'NotSupportedError') {
            errorMsg += '❌ HTTPS gerekli!\nlocalhost kullanın veya HTTPS kurun.';
        } else {
            errorMsg += `Hata: ${err.message}`;
        }
        
        alert(errorMsg);
        closeCall();
    }
});

dom.rejectCall.addEventListener('click', () => {
    if (!incomingCallData) return;
    socket.emit('call_answer', {
        callerSocketId: incomingCallData.callerSocketId,
        accepted: false
    });
    dom.incomingModal.classList.add('hidden');
    incomingCallData = null;
});

socket.on('call_answered', async data => {
    if (data.accepted) {
        try {
            console.log('Cevap alındı');
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            dom.callStatus.textContent = 'Bağlanıyor...';
        } catch (err) {
            console.error('Answer hatası:', err);
            alert('Arama bağlantısı kurulamadı.');
            closeCall();
        }
    } else {
        alert('Arama reddedildi.');
        closeCall();
    }
});

socket.on('ice_candidate', async data => {
    if (peerConnection && data.candidate) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
            console.error('ICE hatası:', err);
        }
    }
});

socket.on('call_ended', () => {
    closeCall();
});

socket.on('call_error', (data) => {
    alert(data.message || 'Arama hatası oluştu.');
    closeCall();
});

// Ekran paylaşımı sinyalleri
socket.on('screen_share_started', async (data) => {
    try {
        console.log('Karşı taraf ekran paylaşımı başlattı');
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            socket.emit('screen_share_answer', {
                targetSocketId: data.fromSocketId,
                answer: answer
            });
        }
    } catch (err) {
        console.error('Ekran paylaşımı offer hatası:', err);
    }
});

socket.on('screen_share_stopped', async (data) => {
    try {
        console.log('Karşı taraf ekran paylaşımını durdurdu');
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            socket.emit('screen_share_answer', {
                targetSocketId: data.fromSocketId,
                answer: answer
            });
        }
    } catch (err) {
        console.error('Ekran paylaşımı durdurma hatası:', err);
    }
});

socket.on('screen_share_answer', async (data) => {
    try {
        console.log('Ekran paylaşımı answer alındı');
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    } catch (err) {
        console.error('Screen share answer hatası:', err);
    }
});

// Arama kontrolleri
dom.toggleMic.addEventListener('click', () => {
    if (localStream) {
        const track = localStream.getAudioTracks()[0];
        if (track) {
            track.enabled = !track.enabled;
            dom.toggleMic.classList.toggle('active', track.enabled);
            dom.toggleMic.innerHTML = track.enabled 
                ? '<i class="fas fa-microphone"></i>' 
                : '<i class="fas fa-microphone-slash"></i>';
        }
    }
});

dom.toggleCamera.addEventListener('click', () => {
    if (localStream) {
        const track = localStream.getVideoTracks()[0];
        if (track) {
            track.enabled = !track.enabled;
            dom.toggleCamera.classList.toggle('active', track.enabled);
            dom.toggleCamera.innerHTML = track.enabled 
                ? '<i class="fas fa-video"></i>' 
                : '<i class="fas fa-video-slash"></i>';
        }
    }
});

// Ekran paylaşımı
dom.shareScreen.addEventListener('click', async () => {
    if (isScreenSharing) {
        stopScreenShare();
    } else {
        await startScreenShare();
    }
});

async function startScreenShare() {
    if (!peerConnection) {
        alert('Önce bir arama başlatın.');
        return;
    }

    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always',
                displaySurface: 'monitor'
            },
            audio: false
        });

        const screenTrack = screenStream.getVideoTracks()[0];
        
        // Video track'i değiştir
        const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
            await sender.replaceTrack(screenTrack);
            
            // Renegotiation başlat - karşı tarafa yeni offer gönder
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            socket.emit('screen_share_started', {
                targetSocketId: callTargetSocketId,
                offer: offer
            });
            
            console.log('Ekran paylaşımı offer gönderildi');
        }

        // Yerel video'da ekranı göster
        dom.localVideo.srcObject = screenStream;
        
        isScreenSharing = true;
        dom.shareScreen.classList.add('active-share');
        dom.shareScreen.innerHTML = '<i class="fas fa-stop-circle"></i>';
        dom.shareScreen.title = 'Ekran Paylaşımını Durdur';

        // Kullanıcı ekran paylaşımını durdurursa
        screenTrack.onended = () => {
            stopScreenShare();
        };

    } catch (err) {
        console.error('Ekran paylaşımı hatası:', err);
        if (err.name === 'NotAllowedError') {
            alert('Ekran paylaşımı izni reddedildi.');
        } else if (err.name === 'NotSupportedError') {
            alert('Tarayıcınız ekran paylaşımını desteklemiyor.');
        } else {
            alert('Ekran paylaşımı başlatılamadı: ' + err.message);
        }
    }
}

async function stopScreenShare() {
    if (!screenStream) return;

    // Ekran stream'ini durdur
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;

    // Kamera track'ine geri dön
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack && peerConnection) {
            const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
            if (sender) {
                await sender.replaceTrack(videoTrack);
                
                // Renegotiation - kameraya geri dönüldüğünü bildir
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                
                socket.emit('screen_share_stopped', {
                    targetSocketId: callTargetSocketId,
                    offer: offer
                });
                
                console.log('Ekran paylaşımı durduruldu offer gönderildi');
            }
            dom.localVideo.srcObject = localStream;
        }
    }

    isScreenSharing = false;
    dom.shareScreen.classList.remove('active-share');
    dom.shareScreen.innerHTML = '<i class="fas fa-desktop"></i>';
    dom.shareScreen.title = 'Ekran Paylaş';
}

dom.endCall.addEventListener('click', () => {
    if (callTargetSocketId) {
        socket.emit('end_call', { targetSocketId: callTargetSocketId });
    }
    closeCall();
});

function closeCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    dom.localVideo.srcObject = null;
    dom.remoteVideo.srcObject = null;
    callTargetSocketId = null;
    incomingCallData = null;
    isScreenSharing = false;
    dom.callModal.classList.add('hidden');
    dom.incomingModal.classList.add('hidden');
    
    // Butonları sıfırla
    dom.toggleMic.classList.add('active');
    dom.toggleMic.innerHTML = '<i class="fas fa-microphone"></i>';
    dom.toggleCamera.classList.add('active');
    dom.toggleCamera.innerHTML = '<i class="fas fa-video"></i>';
    dom.shareScreen.classList.remove('active-share');
    dom.shareScreen.innerHTML = '<i class="fas fa-desktop"></i>';
}

// Kullanıcı seç modal kapatma
dom.closeSelect.addEventListener('click', () => {
    dom.userSelectModal.classList.add('hidden');
});

// Bağlantı durumu
socket.on('disconnect', () => {
    alert('Sunucu bağlantısı kesildi!');
    location.reload();
});

console.log('🚀 Sohbet uygulaması hazır!');
