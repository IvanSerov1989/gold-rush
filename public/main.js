const socket = io();

// ==================== ЗВУКОВОЙ МЕНЕДЖЕР ====================
let audioContext;
function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playSound(type) {
    if (!audioContext) initAudio();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);

    switch (type) {
        case 'coin':
            osc.type = 'sawtooth';
            osc.frequency.value = 880;
            gain.gain.value = 0.3;
            filter.type = 'lowpass';
            filter.frequency.value = 1200;
            setTimeout(() => gain.gain.linearRampToValueAtTime(0.001, audioContext.currentTime + 0.15), 50);
            break;
        case 'power':
            osc.type = 'triangle';
            osc.frequency.value = 660;
            gain.gain.value = 0.35;
            filter.type = 'highpass';
            filter.frequency.value = 900;
            setTimeout(() => gain.gain.linearRampToValueAtTime(0.001, audioContext.currentTime + 0.18), 60);
            break;
        case 'shield':
            osc.type = 'square';
            osc.frequency.value = 520;
            gain.gain.value = 0.3;
            filter.type = 'bandpass';
            filter.frequency.value = 700;
            setTimeout(() => gain.gain.linearRampToValueAtTime(0.001, audioContext.currentTime + 0.2), 80);
            break;
        case 'start':
            osc.type = 'sine';
            osc.frequency.value = 440;
            gain.gain.value = 0.4;
            setTimeout(() => osc.frequency.linearRampToValueAtTime(880, audioContext.currentTime + 0.4), 100);
            setTimeout(() => gain.gain.linearRampToValueAtTime(0.001, audioContext.currentTime + 0.6), 300);
            break;
        case 'end':
            osc.type = 'sawtooth';
            osc.frequency.value = 220;
            gain.gain.value = 0.5;
            setTimeout(() => osc.frequency.linearRampToValueAtTime(110, audioContext.currentTime + 1.2), 200);
            setTimeout(() => gain.gain.linearRampToValueAtTime(0.001, audioContext.currentTime + 1.5), 800);
            break;
        case 'pause':
            osc.type = 'square';
            osc.frequency.value = 300;
            gain.gain.value = 0.25;
            setTimeout(() => gain.gain.linearRampToValueAtTime(0.001, audioContext.currentTime + 0.2), 80);
            break;
        case 'resume':
            osc.type = 'sine';
            osc.frequency.value = 600;
            gain.gain.value = 0.3;
            setTimeout(() => gain.gain.linearRampToValueAtTime(0.001, audioContext.currentTime + 0.25), 100);
            break;
    }
    osc.start();
    setTimeout(() => osc.stop(), 2000);
}

// ==================== DOM ЭЛЕМЕНТЫ ====================
const joinScreen = document.getElementById('join-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameBoard = document.getElementById('game-board');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const errorMessage = document.getElementById('error-message');
const playersList = document.getElementById('players-list');
const playersCount = document.getElementById('players-count');
const startGameBtn = document.getElementById('start-game-btn');
const waitingMessage = document.getElementById('waiting-message');
const timerDisplay = document.getElementById('timer');
const scoreList = document.getElementById('score-list');
const gameOverScreen = document.getElementById('game-over-screen');
const winnerText = document.getElementById('winner-text');
const restartBtn = document.getElementById('restart-btn');
const inGameMenu = document.getElementById('in-game-menu');
const menuStatus = document.getElementById('menu-status');
const menuResumeBtn = document.getElementById('menu-resume-btn');
const menuLeaveBtn = document.getElementById('menu-leave-btn');
const notificationToast = document.getElementById('notification-toast');
const pauseOverlay = document.getElementById('pause-overlay');

let myPlayerInfo = null;
let playerElements = {};
let obstacleElements = {};
let resourceElements = {};
let currentGameState = null;
let animationFrame = null;
let playerRenderData = {};
let menuOpen = false;
let gamePaused = false;
let gameStartTime = 0;
let chatOpen = true; // чат всегда видим

document.addEventListener('click', () => {
    if (!audioContext) initAudio();
}, { once: true });

// ==================== КЛАВИАТУРА ====================
const keys = {};
window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

let lastInputTime = 0;
function sendInput() {
    if (!currentGameState || !myPlayerInfo || currentGameState.paused) return;
    const now = Date.now();
    if (now - lastInputTime < 16) return;

    const input = {
        up: keys['w'] || keys['arrowup'],
        down: keys['s'] || keys['arrowdown'],
        left: keys['a'] || keys['arrowleft'],
        right: keys['d'] || keys['arrowright']
    };
    if (input.up || input.down || input.left || input.right) {
        socket.emit('player_input', input);
    }
    lastInputTime = now;
}

// ==================== SOCKET СОБЫТИЯ ====================
socket.on('game_state_update', (state) => {
    const now = performance.now();
    if (state.players) {
        Object.keys(state.players).forEach(id => {
            const p = state.players[id];
            const prev = playerRenderData[id];
            if (prev && prev.nextTime) {
                playerRenderData[id] = {
                    ...prev,
                    prevX: prev.nextX, prevY: prev.nextY, prevTime: prev.nextTime,
                    nextX: p.x, nextY: p.y, nextTime: now, ...p
                };
            } else {
                playerRenderData[id] = {
                    prevX: p.x, prevY: p.y, nextX: p.x, nextY: p.y,
                    prevTime: now - 33, nextTime: now, ...p
                };
            }
        });
    }
    currentGameState = state;
    updateHud(state);
});

socket.on('game_paused', ({ by, paused }) => {
    gamePaused = paused;
    menuStatus.textContent = paused ? `Пауза: ${by}` : 'Игра продолжается';
    showNotification(paused ? `${by} приостановил игру` : `${by} продолжил игру`);
    if (paused && !menuOpen) {
        inGameMenu.style.display = 'flex';
        menuOpen = true;
    }
});

socket.on('player_left', ({ name }) => showNotification(`${name} вышел из игры`));

socket.on('resource_collected', ({ by, type }) => {
    const labels = { gold: 'золото', speed: 'ускорение', shield: 'щит' };
    showNotification(`${by} взял ${labels[type] || type}`);
    if (type === 'gold') playSound('coin');
    else if (type === 'speed') playSound('power');
    else if (type === 'shield') playSound('shield');
});

// ==================== ГЛАВНЫЙ ИГРОВОЙ ЦИКЛ ====================
function startClientGameLoop() {
    gameStartTime = performance.now();

    function gameLoop(timestamp) {
        const now = timestamp || performance.now();

        if (!currentGameState || !currentGameState.players) {
            animationFrame = requestAnimationFrame(gameLoop);
            return;
        }

        if (currentGameState.paused) {
            gameBoard.style.filter = 'brightness(0.6) saturate(0.7)';
            if (pauseOverlay) pauseOverlay.style.display = 'flex';
            animationFrame = requestAnimationFrame(gameLoop);
            return;
        } else {
            gameBoard.style.filter = 'none';
            if (pauseOverlay) pauseOverlay.style.display = 'none';
        }

        if (now - gameStartTime > 400) {
            sendInput();
        }

        // === ИГРОКИ ===
        Object.keys(currentGameState.players).forEach(id => {
            const p = currentGameState.players[id];
            if (!playerElements[id]) {
                const div = document.createElement('div');
                div.className = 'player';
                div.style.backgroundColor = p.color;

                const nameDiv = document.createElement('div');
                nameDiv.className = 'player-name';
                nameDiv.textContent = p.name;
                div.appendChild(nameDiv);

                gameBoard.appendChild(div);
                playerElements[id] = div;
            }

            const renderInfo = playerRenderData[id];
            let x = p.x, y = p.y;

            // Если игрок в стане — НЕ интерполируем (чтобы не было телепортов)
            if (renderInfo && p.stunTime <= 0) {
                const interval = Math.max(16, renderInfo.nextTime - renderInfo.prevTime);
                let t = (now - renderInfo.prevTime) / interval;
                t = Math.min(1, Math.max(0, t));

                const targetX = renderInfo.prevX + (renderInfo.nextX - renderInfo.prevX) * t;
                const targetY = renderInfo.prevY + (renderInfo.nextY - renderInfo.prevY) * t;

                const predictionTime = 0.05;
                const predictedX = targetX + (renderInfo.vx || 0) * predictionTime;
                const predictedY = targetY + (renderInfo.vy || 0) * predictionTime;

                x = targetX * 0.75 + predictedX * 0.25;
                y = targetY * 0.75 + predictedY * 0.25;
            } else {
              x = p.x;
              y = p.y;
            }

            const el = playerElements[id];
            el.style.transform = `translate3d(${x - 20}px, ${y - 20}px, 0)`;
            el.classList.toggle('player-speed', p.speedBoostTime > 0);
            el.classList.toggle('player-shield', p.shieldTime > 0);
            el.classList.toggle('player-stun', p.stunTime > 0);
        });

        // === ПРЕПЯТСТВИЯ ===
        if (currentGameState.obstacles) {
            currentGameState.obstacles.forEach(obs => {
                if (!obstacleElements[obs.id]) {
                    const d = document.createElement('div');
                    d.className = 'obstacle';
                    d.style.backgroundColor = obs.color || '#7f8c8d';
                    gameBoard.appendChild(d);
                    obstacleElements[obs.id] = d;
                }
                const el = obstacleElements[obs.id];
                const w = obs.width || 40;
                const h = obs.height || 40;
                el.style.width = `${w}px`;
                el.style.height = `${h}px`;
                el.style.transform = `translate3d(${obs.x - w/2}px, ${obs.y - h/2}px, 0)`;
            });
        }

        // === РЕСУРСЫ ===
        if (currentGameState.resources) {
            const activeIds = new Set(currentGameState.resources.map(r => r.id));

            currentGameState.resources.forEach(res => {
                if (!resourceElements[res.id]) {
                    const d = document.createElement('div');
                    d.className = `resource resource-${res.type}`;
                    d.title = res.type === 'gold' ? 'Золото' : res.type === 'speed' ? 'Ускорение' : 'Щит';
                    gameBoard.appendChild(d);
                    resourceElements[res.id] = d;
                }
                const el = resourceElements[res.id];
                const size = res.size || 14;
                el.style.width = `${size}px`;
                el.style.height = `${size}px`;
                el.style.backgroundColor = res.color || '#f1c40f';
                el.style.transform = `translate3d(${res.x - size/2}px, ${res.y - size/2}px, 0)`;
            });

            Object.keys(resourceElements).forEach(id => {
                if (!activeIds.has(id)) {
                    resourceElements[id].remove();
                    delete resourceElements[id];
                }
            });
        }

        // === ОЧИСТКА УДАЛЁННЫХ ИГРОКОВ ===
        Object.keys(playerElements).forEach(id => {
            if (!currentGameState.players[id]) {
                playerElements[id].remove();
                delete playerElements[id];
                delete playerRenderData[id];
            }
        });

        animationFrame = requestAnimationFrame(gameLoop);
    }
    gameLoop();
}

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
function toggleMenu(open) {
    menuOpen = open;
    inGameMenu.style.display = open ? 'flex' : 'none';
    gamePaused = open;

    if (open) {
        playSound('pause');
        socket.emit('pause_game');
    } else {
        playSound('resume');
        socket.emit('resume_game');
    }
}

function showNotification(message) {
    notificationToast.textContent = message;
    notificationToast.style.display = 'block';
    notificationToast.classList.remove('hide');
    notificationToast.classList.add('show');

    clearTimeout(notificationToast.hideTimeout);
    notificationToast.hideTimeout = setTimeout(() => {
        notificationToast.classList.remove('show');
        notificationToast.classList.add('hide');
        setTimeout(() => notificationToast.style.display = 'none', 250);
    }, 3000);
}

function formatTime(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function updateHud(state) {
    if (!state || !state.players) return;

    timerDisplay.textContent = formatTime(state.timer || 0);

    const entries = Object.values(state.players)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

    scoreList.innerHTML = '';
    entries.forEach(player => {
        const item = document.createElement('li');
        item.textContent = `${player.name}: ${player.score}`;
        if (player.id === socket.id) item.className = 'me-score';
        scoreList.appendChild(item);
    });
}

function showGameOver(state) {
    if (!state || !state.players) return;

    const winner = Object.values(state.players)
        .sort((a, b) => b.score - a.score)[0];

    winnerText.textContent = winner
        ? `Победитель: ${winner.name} (${winner.score})`
        : 'Игра окончена';

    gameOverScreen.style.display = 'flex';
}

function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.style.display = 'block';
}

// ==================== ЧАТ ====================
function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg || !myPlayerInfo) return;

    socket.emit('chat_message', {
        name: myPlayerInfo.name,
        message: msg
    });
    input.value = '';
}

function addChatMessage(name, message, isMe = false) {
    const container = document.getElementById('chat-messages');
    const line = document.createElement('div');
    line.className = 'chat-line';
    line.innerHTML = `<span class="chat-name">${name}:</span> ${message}`;
    if (isMe) line.style.opacity = '0.85';
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
}

// ==================== КНОПКИ ====================
restartBtn.addEventListener('click', () => window.location.reload());
menuResumeBtn.addEventListener('click', () => toggleMenu(false));
menuLeaveBtn.addEventListener('click', () => socket.emit('leave_game'));

// Чат
document.getElementById('chat-send-btn').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        sendChatMessage();
    }
});

// Получение сообщений от сервера
socket.on('chat_message', ({ name, message }) => {
    const isMe = name === myPlayerInfo?.name;
    addChatMessage(name, message, isMe);
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && gameBoard.style.display === 'block' && gameOverScreen.style.display !== 'flex') {
        toggleMenu(!menuOpen);
        e.preventDefault();
    }
});

// ==================== ЛОББИ ====================
joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username.length < 2) return showError('Имя минимум 2 символа');
    socket.emit('join_game', username);
});

startGameBtn.addEventListener('click', () => socket.emit('start_game'));

socket.on('join_error', showError);

socket.on('join_success', (playerInfo) => {
    myPlayerInfo = playerInfo;
    joinScreen.style.display = 'none';
    lobbyScreen.style.display = 'block';
});

socket.on('update_lobby', (players) => {
    playersList.innerHTML = '';
    playersCount.textContent = players.length;

    players.forEach(player => {
        const li = document.createElement('li');
        li.textContent = player.name;

        if (player.isLeader) {
            const badge = document.createElement('span');
            badge.textContent = '👑 Лидер';
            badge.className = 'leader-badge';
            li.appendChild(badge);
        }
        if (player.id === socket.id) li.style.fontWeight = 'bold';
        playersList.appendChild(li);
    });

    const amILeader = players.find(p => p.id === socket.id)?.isLeader;
    if (amILeader) {
        waitingMessage.style.display = 'none';
        startGameBtn.style.display = players.length >= 2 ? 'inline-block' : 'none';
    } else {
        startGameBtn.style.display = 'none';
        waitingMessage.style.display = 'block';
    }
});

// ==================== СТАРТ ИГРЫ ====================
socket.on('game_started', () => {
    lobbyScreen.style.display = 'none';
    gameBoard.style.display = 'block';
    inGameMenu.style.display = 'none';
    menuOpen = false;
    gamePaused = false;
    if (pauseOverlay) pauseOverlay.style.display = 'none';

    startClientGameLoop();
    playSound('start');
});

socket.on('game_ended', (state) => {
    currentGameState = state;
    updateHud(state);
    showGameOver(state);
    if (menuOpen) toggleMenu(false);
    if (pauseOverlay) pauseOverlay.style.display = 'none';
    playSound('end');
});