const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const DISCONNECT_GRACE_MS = 30000; // 30 giây

let gameState = {
    isLocked: true,
    mode: 'buzzer_only',
    queue: [],
    unlockedAt: null,
    endTime: null,
    allowedOptions: 'ABCD',
    autoLockLimit: null,
    participants: [] // { id, name, role, joinedAt, connected, disconnectedAt }
};

let lockTimeout = null;
const disconnectTimers = new Map(); // key: participant name -> timeoutId

// Hàm hỗ trợ để luôn gửi kèm thời gian thực của server
function broadcastState(target = io) {
    target.emit('state_update', {
        ...gameState,
        serverTime: Date.now()
    });
}

function removeParticipantByName(name) {
    disconnectTimers.delete(name);
    const beforeLen = gameState.participants.length;
    gameState.participants = gameState.participants.filter(p => p.name !== name);
    if (gameState.participants.length !== beforeLen) {
        broadcastState();
    }
}

io.on('connection', (socket) => {
    // Gửi state riêng cho người vừa kết nối
    broadcastState(socket);

    socket.on('login', (name) => {
        const cleanName = String(name || '').trim();
        if (!cleanName) return;

        const role = cleanName === "admin000" ? 'admin' : 'player';
        const now = Date.now();

        // Nếu đang có timer xóa do disconnect trước đó thì hủy đi
        if (disconnectTimers.has(cleanName)) {
            clearTimeout(disconnectTimers.get(cleanName));
            disconnectTimers.delete(cleanName);
        }

        const existingIndex = gameState.participants.findIndex(p => p.name === cleanName);
        if (existingIndex !== -1) {
            const prev = gameState.participants[existingIndex];
            gameState.participants[existingIndex] = {
                ...prev,
                id: socket.id,
                role,
                connected: true,
                disconnectedAt: null
                // Giữ nguyên joinedAt gốc của phiên đăng nhập, hoặc cập nhật nếu muốn
            };
        } else {
            gameState.participants.push({
                id: socket.id,
                name: cleanName,
                role,
                joinedAt: now,
                connected: true,
                disconnectedAt: null
            });
        }

        socket.data.userName = cleanName;
        socket.emit('login_success', { role, name: cleanName });
        console.log(`[+] ${role === 'admin' ? 'Quản trò' : 'Người chơi'} đã tham gia: ${cleanName}`);

        broadcastState();
    });

    socket.on('disconnect', () => {
        const userName = socket.data.userName;
        if (!userName) return;

        const participant = gameState.participants.find(p => p.name === userName);
        if (!participant) return;

        // Chỉ xử lý nếu socket ngắt kết nối là socket hiện tại của người đó
        if (participant.id !== socket.id) return;

        participant.connected = false;
        participant.disconnectedAt = Date.now();
        broadcastState();

        // Hẹn giờ 30 giây: nếu quá 30s chưa kết nối lại thì xóa khỏi danh sách
        if (disconnectTimers.has(userName)) {
            clearTimeout(disconnectTimers.get(userName));
        }

        const timerId = setTimeout(() => {
            removeParticipantByName(userName);
        }, DISCONNECT_GRACE_MS);

        disconnectTimers.set(userName, timerId);
    });

    socket.on('admin_action', (data) => {
        switch (data.action) {
            case 'change_mode':
                gameState.mode = data.mode;
                if (data.allowedOptions) gameState.allowedOptions = data.allowedOptions;
                gameState.queue = [];
                break;
            case 'update_options':
                gameState.allowedOptions = data.allowedOptions;
                break;
            case 'toggle_lock':
                gameState.isLocked = data.isLocked;
                clearTimeout(lockTimeout);
                if (!gameState.isLocked) {
                    gameState.unlockedAt = Date.now();
                    gameState.endTime = null;
                }
                break;
            case 'clear_queue':
                gameState.queue = [];
                break;
            case 'start_timer': {
                const durationMs = data.seconds * 1000;
                gameState.isLocked = false;
                gameState.queue = [];
                gameState.unlockedAt = Date.now();
                gameState.endTime = gameState.unlockedAt + durationMs;

                clearTimeout(lockTimeout);
                lockTimeout = setTimeout(() => {
                    gameState.isLocked = true;
                    broadcastState();
                }, durationMs);
                break;
            }
            case 'set_auto_lock_limit': {
                const parsed = parseInt(data.limit, 10);
                gameState.autoLockLimit = Number.isInteger(parsed) && parsed > 0 ? parsed : null;

                if (
                    !gameState.isLocked &&
                    gameState.autoLockLimit !== null &&
                    gameState.queue.length >= gameState.autoLockLimit
                ) {
                    gameState.isLocked = true;
                    clearTimeout(lockTimeout);
                }
                break;
            }
        }
        broadcastState();
    });

    socket.on('buzz', (playerData) => {
        if (gameState.isLocked) return;

        const alreadyBuzzed = gameState.queue.find(p => p.name === playerData.name);
        if (!alreadyBuzzed) {
            let timeTaken = "0.00";
            if (gameState.unlockedAt) {
                timeTaken = ((Date.now() - gameState.unlockedAt) / 1000).toFixed(2);
            }
            gameState.queue.push({
                name: playerData.name,
                answer: playerData.answer || '',
                time: timeTaken
            });
            gameState.queue.sort((a, b) => parseFloat(a.time) - parseFloat(b.time));

            if (
                gameState.autoLockLimit !== null &&
                gameState.queue.length >= gameState.autoLockLimit
            ) {
                gameState.isLocked = true;
                clearTimeout(lockTimeout);
            }

            broadcastState();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Hệ thống đang chạy tại http://localhost:${PORT}`));
