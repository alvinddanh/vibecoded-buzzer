const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Phục vụ các file tĩnh trong thư mục public
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Trạng thái chung của hệ thống chuông
let gameState = {
    isLocked: true,
    mode: 'buzzer_only',
    queue: [],
    unlockedAt: null, 
    endTime: null     
};

let lockTimeout = null;

io.on('connection', (socket) => {
    // Gửi trạng thái hiện tại cho người vừa kết nối
    socket.emit('state_update', gameState);

    // Xử lý đăng nhập bằng Tên
    socket.on('login', (name) => {
        if (name === "admin000") {
            socket.emit('login_success', { role: 'admin', name: name });
            console.log(`[+] Quản trò đã tham gia: ${name}`);
        } else {
            socket.emit('login_success', { role: 'player', name: name });
            console.log(`[+] Người chơi đã tham gia: ${name}`);
        }
    });

    // Xử lý các lệnh từ Quản trò
    socket.on('admin_action', (data) => {
        switch (data.action) {
            case 'change_mode':
                gameState.mode = data.mode;
                gameState.queue = [];
                break;
            case 'toggle_lock':
                gameState.isLocked = data.isLocked;
                clearTimeout(lockTimeout);
                
                if (!gameState.isLocked) {
                    // Nếu mở khóa thủ công, bắt đầu tính giờ
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
                
                // Tự động khóa khi hết giờ
                lockTimeout = setTimeout(() => {
                    gameState.isLocked = true;
                    io.emit('state_update', gameState);
                }, durationMs);
                break;
        }
        io.emit('state_update', gameState);
    });

    // Xử lý khi người chơi bấm chuông
    socket.on('buzz', (playerData) => {
        if (gameState.isLocked) return;
        
        // Kiểm tra xem người chơi này (theo tên) đã bấm chuông chưa
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

            // Sắp xếp danh sách từ nhanh nhất đến chậm nhất
            gameState.queue.sort((a, b) => parseFloat(a.time) - parseFloat(b.time));
            
            io.emit('state_update', gameState);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Hệ thống đang chạy tại http://localhost:${PORT}`));