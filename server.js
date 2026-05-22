const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ==================== КОНСТАНТЫ ====================
const MAX_PLAYERS = 4;
const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];
const MOVE_SPEED = 5;
const BOARD_WIDTH = 800;
const BOARD_HEIGHT = 600;
const PLAYER_RADIUS = 20;
const RESOURCE_SIZE = 14;
const RESOURCE_VALUE = 10;
const MAX_RESOURCES = 8;

// ==================== ИГРОВОЕ СОСТОЯНИЕ ====================
let players = {};
let gameState = {};
let gameInProgress = false;
let gameInterval = null;
let resourceSpawnInterval = null;
let pausedBy = null;

const OBSTACLES = [
    { id: 'obs1', x: 200, y: 150, width: 80, height: 30, color: '#7f8c8d' },
    { id: 'obs2', x: 600, y: 150, width: 80, height: 30, color: '#7f8c8d' },
    { id: 'obs3', x: 400, y: 300, width: 60, height: 120, color: '#7f8c8d' },
    { id: 'obs4', x: 150, y: 450, width: 100, height: 25, color: '#7f8c8d' },
    { id: 'obs5', x: 550, y: 480, width: 120, height: 25, color: '#7f8c8d' }
];

// ==================== ЗАЩИТА ПОЗИЦИЙ ====================
function clampPlayerPosition(player) {
    if (!player) return;
    if (isNaN(player.x) || isNaN(player.y) || !isFinite(player.x) || !isFinite(player.y)) {
        console.warn(`[FIX] NaN position for ${player.name || 'unknown'}. Resetting.`);
        player.x = 400;
        player.y = 300;
        player.vx = 0;
        player.vy = 0;
        return;
    }
    player.x = Math.max(PLAYER_RADIUS, Math.min(BOARD_WIDTH - PLAYER_RADIUS, player.x));
    player.y = Math.max(PLAYER_RADIUS, Math.min(BOARD_HEIGHT - PLAYER_RADIUS, player.y));
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function generateResourceId() {
    return 'res_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
}

function spawnResource() {
    if (!gameState.resources) gameState.resources = [];
    if (gameState.resources.length >= MAX_RESOURCES) return;

    let x, y, attempts = 0;
    const margin = 30;
    do {
        x = margin + Math.random() * (BOARD_WIDTH - 2 * margin);
        y = margin + Math.random() * (BOARD_HEIGHT - 2 * margin);
        attempts++;
    } while (attempts < 20 && (isPositionInObstacle(x, y) || isTooCloseToOtherResource(x, y)));

    const types = ['gold', 'gold', 'gold', 'speed', 'shield'];
    const type = types[Math.floor(Math.random() * types.length)];
    const color = type === 'speed' ? '#3498db' : type === 'shield' ? '#9b59b6' : '#f1c40f';

    gameState.resources.push({
        id: generateResourceId(),
        x, y,
        size: RESOURCE_SIZE,
        color,
        type
    });
}

function isPositionInObstacle(x, y) {
    return OBSTACLES.some(obs => {
        const halfW = (obs.width || 40) / 2;
        const halfH = (obs.height || 40) / 2;
        return x > obs.x - halfW && x < obs.x + halfW &&
               y > obs.y - halfH && y < obs.y + halfH;
    });
}

function isTooCloseToOtherResource(x, y, minDist = 35) {
    if (!gameState.resources) return false;
    return gameState.resources.some(r => {
        const dx = r.x - x;
        const dy = r.y - y;
        return Math.sqrt(dx * dx + dy * dy) < minDist;
    });
}

// ==================== СТОЛКНОВЕНИЯ ====================
function checkCollisions() {
    if (!gameState.players || !gameState.resources) return;

    // Глобальная защита
    Object.keys(gameState.players).forEach(id => {
        const p = gameState.players[id];
        if (p.collisionCooldown > 0) p.collisionCooldown--;
        clampPlayerPosition(p);
    });

    // === СИММЕТРИЧНЫЕ СТОЛКНОВЕНИЯ ИГРОКОВ (ИСПРАВЛЕНО) ===
    const ids = Object.keys(gameState.players).sort();

    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            const p1 = gameState.players[ids[i]];
            const p2 = gameState.players[ids[j]];
            if (!p1 || !p2) continue;

            const dx = p1.x - p2.x;
            const dy = p1.y - p2.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < PLAYER_RADIUS * 2 && dist > 0.1) {
                const nx = dx / dist;
                const ny = dy / dist;

                // Симметричное отталкивание (оба игрока двигаются одинаково)
                const overlap = (PLAYER_RADIUS * 2 - dist) / 2 + 2.5;

                p1.x += nx * overlap;
                p1.y += ny * overlap;
                p2.x -= nx * overlap;
                p2.y -= ny * overlap;

                clampPlayerPosition(p1);
                clampPlayerPosition(p2);

                p1.vx = 0;
                p1.vy = 0;
                p2.vx = 0;
                p2.vy = 0;

                // Стан при высокой скорости (таран)
                const speed1 = Math.hypot(p1.vx || 0, p1.vy || 0);
                const speed2 = Math.hypot(p2.vx || 0, p2.vy || 0);
                const relSpeed = speed1 + speed2;

                if (relSpeed > 4.2) {
                    if (!p1.shieldTime && p1.collisionCooldown === 0) {
                        p1.stunTime = 26;
                        p1.collisionCooldown = 14;
                    }
                    if (!p2.shieldTime && p2.collisionCooldown === 0) {
                        p2.stunTime = 26;
                        p2.collisionCooldown = 14;
                    }
                }
            }
        }
    }

    // Дополнительная защита от застревания в углу
    Object.keys(gameState.players).forEach(id => {
        const p = gameState.players[id];
        if (p) clampPlayerPosition(p);
    });

    // === ПРЕПЯТСТВИЯ + СБОР РЕСУРСОВ ===
    Object.keys(gameState.players).forEach(playerId => {
        const player = gameState.players[playerId];
        if (!player) return;

        clampPlayerPosition(player);

        // Препятствия
        OBSTACLES.forEach(obs => {
            const halfW = (obs.width || 40) / 2;
            const halfH = (obs.height || 40) / 2;
            const closestX = Math.max(obs.x - halfW, Math.min(player.x, obs.x + halfW));
            const closestY = Math.max(obs.y - halfH, Math.min(player.y, obs.y + halfH));

            const dx = player.x - closestX;
            const dy = player.y - closestY;
            const distSq = dx * dx + dy * dy;

            if (distSq < PLAYER_RADIUS * PLAYER_RADIUS && distSq > 0) {
                const dist = Math.sqrt(distSq);
                const overlap = PLAYER_RADIUS - dist;
                player.x += (dx / dist) * overlap * 1.1;
                player.y += (dy / dist) * overlap * 1.1;
                clampPlayerPosition(player);
            }
        });

        // Сбор ресурсов
        for (let i = gameState.resources.length - 1; i >= 0; i--) {
            const res = gameState.resources[i];
            const dx = player.x - res.x;
            const dy = player.y - res.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < PLAYER_RADIUS + res.size / 2) {
                const powerType = res.type || 'gold';

                if (powerType === 'speed') {
                    player.speedBoostTime = 135;
                    player.score = (player.score || 0) + 8;
                } else if (powerType === 'shield') {
                    player.shieldTime = 165;
                    player.score = (player.score || 0) + 8;
                } else {
                    player.score = (player.score || 0) + RESOURCE_VALUE;
                }

                gameState.resources.splice(i, 1);
                io.emit('resource_collected', { by: player.name, type: powerType });
                setTimeout(spawnResource, 750);
            }
        }
    });
}

// ==================== SOCKET.IO ====================
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
        pausedBy = null;

        gameState = {
            players: {},
            obstacles: OBSTACLES,
            resources: [],
            timer: 180,
            gameRunning: true,
            paused: false,
            pausedBy: null
        };

        const startPositions = [
            { x: 100, y: 100 }, { x: 700, y: 100 },
            { x: 100, y: 500 }, { x: 700, y: 500 }
        ];

        Object.keys(players).forEach((id, i) => {
            gameState.players[id] = {
                id,
                name: players[id].name,
                x: startPositions[i].x,
                y: startPositions[i].y,
                score: 0,
                color: PLAYER_COLORS[i % PLAYER_COLORS.length],
                vx: 0, vy: 0,
                speedBoostTime: 0,
                shieldTime: 0,
                stunTime: 0,
                collisionCooldown: 0
            };
        });

        for (let i = 0; i < 6; i++) spawnResource();

        io.emit('game_started');
        startGameLoop();
    });

    socket.on('player_input', (input) => {
        if (!gameState.gameRunning || !gameState.players[socket.id] || gameState.paused) return;

        const player = gameState.players[socket.id];

        // Пока в стане — не даём двигаться
        if (player.stunTime > 0) {
            player.vx = 0;
            player.vy = 0;
            return;
        }

        let dx = 0, dy = 0;
        if (input.up) dy -= MOVE_SPEED;
        if (input.down) dy += MOVE_SPEED;
        if (input.left) dx -= MOVE_SPEED;
        if (input.right) dx += MOVE_SPEED;

        const speedMultiplier = player.speedBoostTime > 0 ? 1.65 : 1;

        if (dx !== 0 || dy !== 0) {
            const len = Math.sqrt(dx * dx + dy * dy);
            dx = (dx / len) * MOVE_SPEED * speedMultiplier;
            dy = (dy / len) * MOVE_SPEED * speedMultiplier;

            player.x += dx;
            player.y += dy;
            player.vx = dx;
            player.vy = dy;

            player.x = Math.max(PLAYER_RADIUS, Math.min(BOARD_WIDTH - PLAYER_RADIUS, player.x));
            player.y = Math.max(PLAYER_RADIUS, Math.min(BOARD_HEIGHT - PLAYER_RADIUS, player.y));
        } else {
            player.vx = 0;
            player.vy = 0;
        }
    });

    socket.on('pause_game', () => {
        if (!gameState.gameRunning || !gameState.players[socket.id] || gameState.paused) return;
        gameState.paused = true;
        gameState.pausedBy = socket.id;
        pausedBy = socket.id;
        io.emit('game_paused', { by: players[socket.id].name, paused: true });
    });

    socket.on('resume_game', () => {
        if (!gameState.gameRunning || !gameState.players[socket.id] || !gameState.paused) return;
        const isPauser = gameState.pausedBy === socket.id;
        const isLeader = players[socket.id]?.isLeader;
        if (!isPauser && !isLeader) return;

        gameState.paused = false;
        gameState.pausedBy = null;
        pausedBy = null;
        io.emit('game_paused', { by: players[socket.id].name, paused: false });
    });

    socket.on('leave_game', () => {
        if (players[socket.id]) {
            const name = players[socket.id].name;
            delete players[socket.id];
            if (gameState.players) delete gameState.players[socket.id];

            if (pausedBy === socket.id) {
                gameState.paused = false;
                pausedBy = null;
                io.emit('game_paused', { by: name, paused: false });
            }

            io.emit('player_left', { name });
            io.emit('update_lobby', Object.values(players));
        }
        socket.disconnect();
    });

    socket.on('disconnect', () => {
        console.log(`Отключение: ${socket.id}`);
        if (players[socket.id]) {
            const leaverName = players[socket.id].name;
            const wasLeader = players[socket.id].isLeader;

            delete players[socket.id];
            if (gameState.players) delete gameState.players[socket.id];

            if (pausedBy === socket.id) {
                gameState.paused = false;
                pausedBy = null;
                io.emit('game_paused', { by: leaverName, paused: false });
            }

            if (wasLeader && Object.keys(players).length > 0) {
                players[Object.keys(players)[0]].isLeader = true;
            }

            if (Object.keys(players).length === 0) {
                gameInProgress = false;
                gameState = {};
                if (gameInterval) clearInterval(gameInterval);
                if (resourceSpawnInterval) clearInterval(resourceSpawnInterval);
            }

            io.emit('player_left', { name: leaverName });
            io.emit('update_lobby', Object.values(players));
        }
    });
});

// ==================== СЕРВЕРНЫЙ ЦИКЛ ====================
function getDeltaState() {
    if (!gameState.gameRunning) return null;
    return {
        players: gameState.players,
        obstacles: gameState.obstacles,
        resources: gameState.resources,
        timer: gameState.timer,
        paused: gameState.paused || false
    };
}

function startGameLoop() {
    if (gameInterval) clearInterval(gameInterval);
    if (resourceSpawnInterval) clearInterval(resourceSpawnInterval);

    gameInterval = setInterval(() => {
        if (!gameState.gameRunning) return;

        checkCollisions();

        const delta = getDeltaState();
        Object.values(gameState.players || {}).forEach(p => clampPlayerPosition(p));

        if (delta) io.emit('game_state_update', delta);

        if (!gameState.paused) {
            Object.values(gameState.players || {}).forEach(player => {
                player.speedBoostTime = Math.max(0, (player.speedBoostTime || 0) - 1);
                player.shieldTime = Math.max(0, (player.shieldTime || 0) - 1);
                player.stunTime = Math.max(0, (player.stunTime || 0) - 1);
            });

            gameState.timer -= 1 / 30;
            if (gameState.timer <= 0) endGame();
        }
    }, 1000 / 30);

    resourceSpawnInterval = setInterval(() => {
        if (gameState.gameRunning && !gameState.paused &&
            gameState.resources && gameState.resources.length < MAX_RESOURCES) {
            spawnResource();
        }
    }, 4200);
}

function endGame() {
    clearInterval(gameInterval);
    clearInterval(resourceSpawnInterval);
    gameState.gameRunning = false;
    gameInProgress = false;
    io.emit('game_ended', gameState);
}

server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});