const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" },
    maxHttpBufferSize: 10e6
});

// Tüm dosyalar game klasöründe
app.use(express.static(__dirname));

// Aktif kullanıcılar
const activeUsers = new Map();

function isUsernameAvailable(username) {
    for (const [, user] of activeUsers) {
        if (user.username.toLowerCase() === username.toLowerCase()) return false;
    }
    return true;
}

function getActiveUsersList() {
    return Array.from(activeUsers.values()).map(user => ({
        username: user.username,
        socketId: user.socketId
    }));
}

function findSocketIdByUsername(username) {
    for (const [socketId, user] of activeUsers) {
        if (user.username === username) return socketId;
    }
    return null;
}

io.on('connection', (socket) => {
    console.log(`Bağlantı: ${socket.id}`);

    // Kullanıcı adı kontrolü
    socket.on('check_username', (username, callback) => {
        if (!username || username.trim().length < 2) {
            callback({ success: false, message: 'Kullanıcı adı en az 2 karakter olmalı.' });
            return;
        }
        if (!isUsernameAvailable(username.trim())) {
            callback({ success: false, message: 'Bu kullanıcı adı kullanılıyor.' });
            return;
        }

        const user = { username: username.trim(), socketId: socket.id };
        activeUsers.set(socket.id, user);
        
        callback({ success: true, user });
        io.emit('user_list_updated', getActiveUsersList());
        socket.broadcast.emit('user_joined', { username: user.username });
    });

    // Mesaj gönderimi
    socket.on('send_message', (data) => {
        const user = activeUsers.get(socket.id);
        if (!user) return;

        io.emit('new_message', {
            id: Date.now(),
            username: user.username,
            text: data.text,
            timestamp: new Date().toISOString(),
            type: 'text'
        });
    });

    // Fotoğraf gönderimi
    socket.on('send_image', (data) => {
        const user = activeUsers.get(socket.id);
        if (!user) return;

        io.emit('new_message', {
            id: Date.now(),
            username: user.username,
            imageBase64: data.imageBase64,
            timestamp: new Date().toISOString(),
            type: 'image'
        });
    });

    // Sesli mesaj gönderimi
    socket.on('send_voice', (data) => {
        const user = activeUsers.get(socket.id);
        if (!user) return;

        io.emit('new_message', {
            id: Date.now(),
            username: user.username,
            audioBase64: data.audioBase64,
            duration: data.duration,
            mimeType: data.mimeType,
            timestamp: new Date().toISOString(),
            type: 'voice'
        });
    });

    // Yazıyor durumu
    socket.on('typing_start', () => {
        const user = activeUsers.get(socket.id);
        if (user) socket.broadcast.emit('user_typing', { username: user.username, isTyping: true });
    });

    socket.on('typing_stop', () => {
        const user = activeUsers.get(socket.id);
        if (user) socket.broadcast.emit('user_typing', { username: user.username, isTyping: false });
    });

    // WebRTC Sinyalleşme
    socket.on('call_user', (data) => {
        const caller = activeUsers.get(socket.id);
        if (!caller) return;

        const targetSocketId = findSocketIdByUsername(data.targetUsername);
        if (targetSocketId) {
            console.log(`📞 Arama: ${caller.username} -> ${data.targetUsername} (${data.callType})`);
            io.to(targetSocketId).emit('incoming_call', {
                callerUsername: caller.username,
                callerSocketId: socket.id,
                callType: data.callType,
                offer: data.offer
            });
        } else {
            console.log(`❌ Kullanıcı bulunamadı: ${data.targetUsername}`);
            socket.emit('call_error', {
                message: 'Kullanıcı bulunamadı veya çevrimdışı.'
            });
        }
    });

    socket.on('call_answer', (data) => {
        console.log(`✅ Arama ${data.accepted ? 'kabul edildi' : 'reddedildi'}`);
        io.to(data.callerSocketId).emit('call_answered', {
            accepted: data.accepted,
            answer: data.answer
        });
    });

    socket.on('ice_candidate', (data) => {
        console.log('📡 ICE candidate iletiliyor');
        io.to(data.targetSocketId).emit('ice_candidate', {
            candidate: data.candidate,
            fromSocketId: socket.id
        });
    });

    socket.on('end_call', (data) => {
        if (data.targetSocketId) {
            io.to(data.targetSocketId).emit('call_ended', {});
        }
    });

    // Ekran paylaşımı sinyalleri
    socket.on('screen_share_started', (data) => {
        if (data.targetSocketId) {
            io.to(data.targetSocketId).emit('screen_share_started', {
                offer: data.offer,
                fromSocketId: socket.id
            });
            console.log(`Ekran paylaşımı başladı: ${socket.id} -> ${data.targetSocketId}`);
        }
    });

    socket.on('screen_share_stopped', (data) => {
        if (data.targetSocketId) {
            io.to(data.targetSocketId).emit('screen_share_stopped', {
                offer: data.offer,
                fromSocketId: socket.id
            });
            console.log(`Ekran paylaşımı durduruldu: ${socket.id} -> ${data.targetSocketId}`);
        }
    });

    socket.on('screen_share_answer', (data) => {
        if (data.targetSocketId) {
            io.to(data.targetSocketId).emit('screen_share_answer', {
                answer: data.answer
            });
            console.log(`Ekran paylaşımı answer: ${socket.id} -> ${data.targetSocketId}`);
        }
    });

    // Bağlantı koptuğunda
    socket.on('disconnect', () => {
        const user = activeUsers.get(socket.id);
        if (user) {
            activeUsers.delete(socket.id);
            io.emit('user_list_updated', getActiveUsersList());
            io.emit('user_left', { username: user.username });
        }
    });
});

// Yerel IP adresini bul
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

const PORT = 3000;
const localIP = getLocalIP();

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log('  🚀 SOHBET SUNUCUSU BAŞLATILDI!');
    console.log('='.repeat(60));
    console.log(`  📱 Bu bilgisayardan:     http://localhost:${PORT}`);
    console.log(`  🌐 Aynı ağdan:           http://${localIP}:${PORT}`);
    console.log('='.repeat(60));
    console.log('  💡 Diğer cihazlardan erişmek için yukarıdaki IP\'yi kullanın');
    console.log('  ⚠️  Windows Güvenlik Duvarı izni gerekebilir!');
    console.log('='.repeat(60) + '\n');
});
