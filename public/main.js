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

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);

    switch (type) {
        case 'coin': // Сбор монеты
            oscillator.type = 'sawtooth';
            oscillator.frequency.value = 880;
            gain.gain.value = 0.3;
            filter.type = 'lowpass';
            filter.frequency.value = 1200;
            setTimeout(() => gain.gain.linearRampToValueAtTime(0.001, audioContext.currentTime + 0.15), 50);
            break;

        case 'start': // Старт игры
            oscillator.type = 'sine';
            oscillator.frequency.value = 440;
            gain.gain.value = 0.4;
            setTimeout(() => oscillator.frequency.linearRampToValueAtTime(880, audioContext.currentTime + 0.4), 100);
            setTimeout(() => gain.gain.linearRampToValueAtTime(0.001, audioContext.currentTime + 0.6), 300);
            break;

        case 'end': // Конец игры
            oscillator.type = 'sawtooth';
            oscillator.frequency.value = 220;
            gain.gain.value = 0.5;
            setTimeout(() => oscillator.frequency.linearRampToValueAtTime(110, audioContext.currentTime + 1.2), 200);
            setTimeout(() => gain.gain.linearRampToValueAtTime(0.001, audioContext.currentTime + 1.5), 800);
            break;

        case 'pause': // Пауза
            oscillator.type = 'square';
            oscillator.frequency.value = 300;
            gain.gain.value = 0.25;
            setTimeout(() => gain.gain.linearRampToValueAtTime(0.001, audioContext.currentTime + 0.2), 80);
            break;

        case 'resume': // Продолжение
            oscillator.type = 'sine';
            oscillator.frequency.value = 600;
            gain.gain.value = 0.3;
            setTimeout(() => gain.gain.linearRampToValueAtTime(0.001, audioContext.currentTime + 0.25), 100);
            break;
    }

    oscillator.start();
    setTimeout(() => oscillator.stop(), 2000);
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
let projectileElements = {};
let currentGameState = null;
let animationFrame = null;
let playerRenderData = {};
let menuOpen = false;
let gamePaused = false;

// Запуск аудио при первом клике (требование браузеров)
document.addEventListener('click', () => {
    if (!audioContext) initAudio();
}, { once: true });

// ==================== КЛАВИАТУРА ====================
const keys = {};
window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

let lastInputTime = 0;
function sendInput() {
    if (!currentGameState || !myPlayerInfo || gamePaused) return;
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

// ==================== МЕНЮ И УВЕДОМЛЕНИЯ ====================
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

// ==================== КНОПКИ ====================
restartBtn.addEventListener('click', () => window.location.reload());

menuResumeBtn.addEventListener('click', () => toggleMenu(false));

menuLeaveBtn.addEventListener('click', () => {
    socket.emit('leave_game');
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && gameBoard.style.display === 'block' && gameOverScreen.style.display !== 'flex') {
        toggleMenu(!menuOpen);
        e.preventDefault();
    }
});

// ==================== SOCKET СОБЫТИЯ ====================
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

// ==================== ГЛАВНЫЙ ИГРОВОЙ ЦИКЛ ====================
function startClientGameLoop() {
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
                        nextX: p.x, nextY: p.y, nextTime: now,
                        color: p.color, name: p.name, score: p.score,
                        vx: p.vx || 0, vy: p.vy || 0
                    };
                } else {
                    playerRenderData[id] = {
                        prevX: p.x, prevY: p.y, nextX: p.x, nextY: p.y,
                        prevTime: now - 33, nextTime: now,
                        color: p.color, name: p.name, score: p.score,
                        vx: p.vx || 0, vy: p.vy || 0
                    };
                }
            });

            Object.keys(playerRenderData).forEach(id => {
                if (!state.players[id]) delete playerRenderData[id];
            });
        }

        currentGameState = state;
        updateHud(state);
    });

    function gameLoop(timestamp) {
        const now = timestamp || performance.now();
        if (!currentGameState || !currentGameState.players) {
            animationFrame = requestAnimationFrame(gameLoop);
            return;
        }

        sendInput();

        // === ИГРОКИ (интерполяция) ===
        Object.keys(currentGameState.players).forEach(id => {
            const p = currentGameState.players[id];
            if (!playerElements[id]) {
                const playerDiv = document.createElement('div');
                playerDiv.className = 'player';
                playerDiv.style.backgroundColor = p.color;

                const nameDiv = document.createElement('div');
                nameDiv.className = 'player-name';
                nameDiv.textContent = p.name;
                playerDiv.appendChild(nameDiv);

                gameBoard.appendChild(playerDiv);
                playerElements[id] = playerDiv;
            }

            const renderInfo = playerRenderData[id];
            let x = p.x, y = p.y;

            if (renderInfo) {
                const interval = Math.max(16, renderInfo.nextTime - renderInfo.prevTime);
                let t = (now - renderInfo.prevTime) / interval;
                t = Math.min(1, Math.max(0, t));

                const targetX = renderInfo.prevX + (renderInfo.nextX - renderInfo.prevX) * t;
                const targetY = renderInfo.prevY + (renderInfo.nextY - renderInfo.prevY) * t;

                const predictionTime = 0.05;
                const predictedX = targetX + (renderInfo.vx || 0) * predictionTime;
                const predictedY = targetY + (renderInfo.vy || 0) * predictionTime;

                x = targetX * 0.7 + predictedX * 0.3;
                y = targetY * 0.7 + predictedY * 0.3;
            }

            const el = playerElements[id];
            el.style.transform = `translate3d(${x - 20}px, ${y - 20}px, 0)`;
        });

        // ==================== ЗВУК ПРИ СБОРЕ МОНЕТЫ ====================
        if (currentGameState.resources) {
            const currentCount = currentGameState.resources.length;

            if (typeof window.lastResourceCount === 'number' && currentCount < window.lastResourceCount) {
                playSound('coin');
            }

            window.lastResourceCount = currentCount;
        }

        // Препятствия
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

        // Ресурсы
        if (currentGameState.resources) {
            currentGameState.resources.forEach(res => {
                if (!resourceElements[res.id]) {
                    const d = document.createElement('div');
                    d.className = 'resource';
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
        }

        // Очистка удалённых элементов
        Object.keys(playerElements).forEach(id => {
            if (!currentGameState.players[id]) {
                playerElements[id].remove();
                delete playerElements[id];
            }
        });

        // ==================== ВИЗУАЛЬНЫЙ ЭФФЕКТ ПАУЗЫ ====================
        if (currentGameState.paused) {
            gameBoard.style.filter = 'brightness(0.6) saturate(0.7)';
            if (pauseOverlay) pauseOverlay.style.display = 'flex';
        } else {
            gameBoard.style.filter = 'none';
            if (pauseOverlay) pauseOverlay.style.display = 'none';
        }

        animationFrame = requestAnimationFrame(gameLoop);
    }

    gameLoop();
}

function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.style.display = 'block';
}