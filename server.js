const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ==================== ИГРОВОЕ СОСТОЯНИЕ ====================
let players = {};           // лобби
let gameState = {};         // текущее состояние игры
let gameInProgress = false;
const MAX_PLAYERS = 4;

// Цвета игроков (всегда одинаковые)
const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];

io.on('connection', (socket) => {
    console.log(`Подключение: ${socket.id}`);

    socket.on('join_game', (username) => {
        if (gameInProgress) return socket.emit('join_error', 'Игра уже началась!');
        if (Object.keys(players).length >= MAX_PLAYERS) return socket.emit('join_error', 'Лобби заполнено!');
        if (Object.values(players).some(p => p.name === username)) return socket.emit('join_error', 'Имя занято!');

        const isLeader = Object.keys(players).length === 0;
        players[socket.id] = { id: socket.id, name: username, isLeader };

        socket.emit('join_success', players[socket.id]);
        io.emit('update_lobby', Object.values(players));
    });

    socket.on('start_game', () => {
        if (!players[socket.id] || !players[socket.id].isLeader) return;

        gameInProgress = true;
        
        // === ИНИЦИАЛИЗАЦИЯ ИГРОВОГО СОСТОЯНИЯ ===
        gameState = {
            players: {},
            timer: 180,           // 3 минуты
            gameRunning: true
        };

        // Расставляем игроков по углам
        const startPositions = [
            { x: 100, y: 100 },
            { x: 700, y: 100 },
            { x: 100, y: 500 },
            { x: 700, y: 500 }
        ];

        Object.keys(players).forEach((id, i) => {
            gameState.players[id] = {
                id: id,
                name: players[id].name,
                x: startPositions[i].x,
                y: startPositions[i].y,
                score: 0,
                color: PLAYER_COLORS[i % PLAYER_COLORS.length]
            };
        });

        io.emit('game_started');
        
        // Запускаем серверный цикл (30 тиков в секунду)
        startGameLoop();
    });

    socket.on('disconnect', () => {
        console.log(`Отключение: ${socket.id}`);
        if (players[socket.id]) {
            const wasLeader = players[socket.id].isLeader;
            delete players[socket.id];
            delete gameState.players?.[socket.id];

            if (wasLeader && Object.keys(players).length > 0) {
                players[Object.keys(players)[0]].isLeader = true;
            }
            if (Object.keys(players).length === 0) {
                gameInProgress = false;
                gameState = {};
            }
            io.emit('update_lobby', Object.values(players));
        }
    });
});

// ==================== СЕРВЕРНЫЙ ИГРОВОЙ ЦИКЛ ====================
let gameInterval = null;

function startGameLoop() {
    if (gameInterval) clearInterval(gameInterval);

    gameInterval = setInterval(() => {
        if (!gameState.gameRunning) return;

        // Пока просто рассылаем текущее состояние
        // (движение добавим на Дне 4)
        io.emit('game_state_update', gameState);

        // Таймер (пока просто уменьшаем)
        gameState.timer--;
        if (gameState.timer <= 0) {
            endGame();
        }
    }, 1000 / 30); // 30 тиков в секунду
}

function endGame() {
    clearInterval(gameInterval);
    gameState.gameRunning = false;
    gameInProgress = false;
    io.emit('game_ended', gameState);
}

server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});