const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Trạng thái chung của hệ thống
let gameState = {
    isLocked: true,
    mode: 'buzzer_only',
    queue: [],
    unlockedAt: null, 
    endTime: null,
    allowedOptions: 'ABCD' // <-- MẶC ĐỊNH LÀ A, B, C, D
};

let lockTimeout = null;

io.on('connection', (socket) => {
    socket.emit('state_update', gameState);

    socket.on('login', (name) => {
        if (name === "admin000") {
            socket.emit('login_success', { role: 'admin', name: name });
            console.log(`[+] Quản trò đã tham gia: ${name}`);
        } else {
            socket.emit('login_success', { role: 'player', name: name });
            console.log(`[+] Người chơi đã tham gia: ${name}`);
        }
    });

    socket.on('admin_action', (data) => {
        switch (data.action) {
            case 'change_mode':
                gameState.mode = data.mode;
                if (data.allowedOptions) gameState.allowedOptions = data.allowedOptions;
                gameState.queue = [];
                break;
            case 'update_options': // <-- SỰ KIỆN MỚI: Cập nhật phím động
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
            case 'start_timer':
                const durationMs = data.seconds * 1000;
                gameState.isLocked = false;
                gameState.queue = [];
                gameState.unlockedAt = Date.now();
                gameState.endTime = gameState.unlockedAt + durationMs;
                clearTimeout(lockTimeout);
                lockTimeout = setTimeout(() => {
                    gameState.isLocked = true;
                    io.emit('state_update', gameState);
                }, durationMs);
                break;
        }
        io.emit('state_update', gameState);
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
            io.emit('state_update', gameState);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Hệ thống đang chạy tại http://localhost:${PORT}`));