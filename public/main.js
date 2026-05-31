const socket = io();

// ==================== AUDIO MANAGER ====================
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

// ==================== DOM ELEMENTS ====================
const joinScreen = document.getElementById('join-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameBoard = document.getElementById('game-board');
const gameWrapper = document.getElementById('game-wrapper');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const errorMessage = document.getElementById('error-message');
const playersList = document.getElementById('players-list');
const playersCount = document.getElementById('players-count');
const startGameBtn = document.getElementById('start-game-btn');
const waitingMessage = document.getElementById('waiting-message');
const timerDisplay = document.getElementById('timer');
const scoreList = document.getElementById('score-list');
const sidebarPlayerCount = document.getElementById('sidebar-player-count');
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
let chatOpen = true;
let lastLeaderboardHTML = "";

document.addEventListener('click', () => {
    if (!audioContext) initAudio();
}, { once: true });

// ==================== KEYBOARD ====================
const keys = {};
window.addEventListener('keydown', (e) => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

let lastInputTime = 0;
let lastSentInput = JSON.stringify({ up: false, down: false, left: false, right: false });

function sendInput() {
    if (!currentGameState || !myPlayerInfo || currentGameState.paused) return;
    
    const input = {
        up: Boolean(keys['w'] || keys['arrowup']),
        down: Boolean(keys['s'] || keys['arrowdown']),
        left: Boolean(keys['a'] || keys['arrowleft']),
        right: Boolean(keys['d'] || keys['arrowright'])
    };
    
    const inputString = JSON.stringify(input);
    
    // Отправляем данные на сервер ТОЛЬКО если состояние клавиш изменилось
    if (inputString !== lastSentInput) {
        socket.emit('player_input', input);
        lastSentInput = inputString;
    }
}

// ==================== SOCKET EVENTS ====================
socket.on('game_state_update', (state) => {
    const now = performance.now();
    const TICK_RATE = 1000 / 30; // Expected time between packets (~33.3ms)

    if (state.players) {
        Object.keys(state.players).forEach(id => {
            const p = state.players[id];
            const prev = playerRenderData[id];
            
            if (prev && prev.targetTime) {
                playerRenderData[id] = {
                    ...prev,
                    prevX: prev.nextX, 
                    prevY: prev.nextY, 
                    startTime: now, // start new interpolation from now
                    nextX: p.x, 
                    nextY: p.y, 
                    targetTime: now + TICK_RATE, // Expected to arrive in 33.3 ms
                    ...p
                };
            } else {
                // first time seeing this player, no interpolation yet
                playerRenderData[id] = {
                    prevX: p.x, prevY: p.y, 
                    nextX: p.x, nextY: p.y,
                    startTime: now, targetTime: now + TICK_RATE, 
                    ...p
                };
            }
        });
    }

    // === ФИКС ПРЕПЯТСТВИЙ ===
    // Берем препятствия из предыдущего состояния, так как сервер их больше не присылает каждый тик
    state.obstacles = currentGameState && currentGameState.obstacles ? currentGameState.obstacles : [];

    currentGameState = state;
    updateHud(state);
});

socket.on('game_paused', ({ by, paused }) => {
    gamePaused = paused;
    menuStatus.textContent = paused ? `Pause: ${by}` : 'Game is running';
    showNotification(paused ? `${by} paused the game` : `${by} resumed the game`);
    
    if (paused) {
        // if the game is paused, SHOW menu to everyone (including the one who paused)
        if (!menuOpen) {
            inGameMenu.style.display = 'flex';
            menuOpen = true;
        }
    } else {
        // if the game is resumed, HIDE menu from everyone
        if (menuOpen) {
            inGameMenu.style.display = 'none';
            menuOpen = false;
        }
    }
});

socket.on('player_left', ({ name }) => showNotification(`${name} left the game`));

socket.on('resource_collected', ({ by, type }) => {
    const labels = { gold: 'gold', speed: 'speed', shield: 'shield' };
    showNotification(`${by} collected ${labels[type] || type}`);
    if (type === 'gold') playSound('coin');
    else if (type === 'speed') playSound('power');
    else if (type === 'shield') playSound('shield');
});

// ==================== MAIN GAME LOOP ====================
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

        // === PLAYERS ===
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

            // if player is stunned, we want to freeze them at the last position until stun wears off
            if (renderInfo && p.stunTime <= 0) {
                const duration = renderInfo.targetTime - renderInfo.startTime;
                
                // Calculate progress (from 0 to 1)
                let t = (now - renderInfo.startTime) / duration;
                t = Math.min(1, Math.max(0, t)); // Hard limit t to 0..1

                // Smooth transition from old position to new
                x = renderInfo.prevX + (renderInfo.nextX - renderInfo.prevX) * t;
                y = renderInfo.prevY + (renderInfo.nextY - renderInfo.prevY) * t;
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

        // === OBSTACLES ===
        if (currentGameState.obstacles) {
            currentGameState.obstacles.forEach(obs => {
                // DOM is only created once per obstacle, since they don't move or change
                if (!obstacleElements[obs.id]) {
                    const d = document.createElement('div');
                    d.className = 'obstacle';
                    d.style.backgroundColor = obs.color || '#7f8c8d';
                    const w = obs.width || 40;
                    const h = obs.height || 40;
                    d.style.width = `${w}px`;
                    d.style.height = `${h}px`;
                    d.style.transform = `translate3d(${obs.x - w/2}px, ${obs.y - h/2}px, 0)`;
                    
                    gameBoard.appendChild(d);
                    obstacleElements[obs.id] = d;
                }
            });
        }

        // === RESOURCES ===
        if (currentGameState.resources) {
            const activeIds = new Set(currentGameState.resources.map(r => r.id));

            currentGameState.resources.forEach(res => {
                // set the coordinates and dimensions ONLY when the coin spawns.
                if (!resourceElements[res.id]) {
                    const d = document.createElement('div');
                    d.className = `resource resource-${res.type}`;
                    d.title = res.type === 'gold' ? 'Gold' : res.type === 'speed' ? 'Speed' : 'Shield';
                    
                    const size = res.size || 14;
                    d.style.width = `${size}px`;
                    d.style.height = `${size}px`;
                    d.style.backgroundColor = res.color || '#f1c40f';
                    d.style.transform = `translate3d(${res.x - size/2}px, ${res.y - size/2}px, 0)`;
                    
                    gameBoard.appendChild(d);
                    resourceElements[res.id] = d;
                }
            });

            // remove coins that are no longer in the game state (collected or expired)
            Object.keys(resourceElements).forEach(id => {
                if (!activeIds.has(id)) {
                    resourceElements[id].remove();
                    delete resourceElements[id];
                }
            });
        }

        // === CLEANUP REMOVED PLAYERS ===
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

// ==================== HELPER FUNCTIONS ====================
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

    // We update the timer without any problems, the text nodes are lightweight
    timerDisplay.textContent = formatTime(state.timer || 0);

    const entries = Object.values(state.players)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

    // Собираем новый HTML в строку (в памяти, не трогая DOM)
    let newHTML = "";
    entries.forEach((player, index) => {
        const isMeClass = player.id === socket.id ? 'class="me-score"' : '';
        newHTML += `
            <li ${isMeClass}>
                <span class="rank" style="background-color: ${player.color}">${index + 1}</span>
                <span class="player-name">${player.name}</span>
                <span class="score" style="color: ${player.color}">${player.score} <span class="pts">pts</span></span>
            </li>
        `;
    });

    // touch the DOM only if the HTML has actually changed (to minimize reflows)
    if (lastLeaderboardHTML !== newHTML) {
        scoreList.innerHTML = newHTML;
        lastLeaderboardHTML = newHTML;
    }

    // Update sidebar player count, but only if it has changed (to avoid unnecessary DOM updates)
    if (sidebarPlayerCount && sidebarPlayerCount.textContent !== entries.length.toString()) {
        sidebarPlayerCount.textContent = entries.length;
    }
}

function showGameOver(state) {
    if (!state || !state.players) return;

    const winner = Object.values(state.players)
        .sort((a, b) => b.score - a.score)[0];

    winnerText.textContent = winner
        ? `Winner: ${winner.name} (${winner.score})`
        : 'Game Over';

    gameOverScreen.style.display = 'flex';
}

function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.style.display = 'block';
}

// ==================== CHAT ====================
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
    
    // Удаляем заглушку, если она еще там
    const placeholder = container.querySelector('.chat-placeholder');
    if (placeholder) placeholder.remove();

    const line = document.createElement('div');
    line.className = 'chat-line';
    line.innerHTML = `<span class="chat-name">${name}:</span> ${message}`;
    if (isMe) line.style.opacity = '0.85';
    container.appendChild(line);
    container.scrollTop = container.scrollHeight;
}

// ==================== BUTTONS ====================
restartBtn.addEventListener('click', () => window.location.reload());
menuResumeBtn.addEventListener('click', () => toggleMenu(false));
menuLeaveBtn.addEventListener('click', () => {
    socket.emit('leave_game');
    setTimeout(() => {
        window.location.reload(); 
    }, 100);
});

// Chat
document.getElementById('chat-send-btn').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        sendChatMessage();
    }
});

// Receiving messages from the server
socket.on('chat_message', ({ name, message }) => {
    const isMe = name === myPlayerInfo?.name;
    addChatMessage(name, message, isMe);
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && gameWrapper.style.display === 'flex' && gameOverScreen.style.display !== 'flex') {
        toggleMenu(!menuOpen);
        e.preventDefault();
    }
});

// ==================== LOBBY ====================
joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username.length < 2) return showError('Name must be at least 2 characters long');
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
            badge.textContent = '👑 Leader';
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

// ==================== GAME STARTED ====================
socket.on('game_started', (data) => {
    lobbyScreen.style.display = 'none';
    gameWrapper.style.display = 'flex';
    inGameMenu.style.display = 'none';
    menuOpen = false;
    gamePaused = false;
    if (pauseOverlay) pauseOverlay.style.display = 'none';

    // === СОХРАНЯЕМ ПРЕПЯТСТВИЯ ПРИ СТАРТЕ ===
    currentGameState = { obstacles: data ? data.obstacles : [] };

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