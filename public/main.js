const socket = io();

// DOM элементы
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

let myPlayerInfo = null;
let playerElements = {};   // { socketId: DOM-элемент }
let obstacleElements = {}; // { id: DOM-element }
let resourceElements = {};
let projectileElements = {};
let currentGameState = null;
let animationFrame = null;
let playerRenderData = {}; // Интерполяция позиций игроков между обновлениями

// ==================== УПРАВЛЕНИЕ КЛАВИАТУРОЙ ====================
const keys = {};                    // Текущее состояние клавиш

// Отслеживаем нажатие и отпускание клавиш
window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
});

window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
});

// Функция, которая отправляет текущее состояние клавиш на сервер
function sendInput() {
    if (!currentGameState || !myPlayerInfo) return;

    const input = {
        up:    keys['w'] || keys['arrowup'],
        down:  keys['s'] || keys['arrowdown'],
        left:  keys['a'] || keys['arrowleft'],
        right: keys['d'] || keys['arrowright']
    };

    // Отправляем только если есть движение
    if (input.up || input.down || input.left || input.right) {
        socket.emit('player_input', input);
    }
}

// ==================== ЛОББИ ====================
joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username.length < 2) return showError('Имя минимум 2 символа');
    socket.emit('join_game', username);
});

startGameBtn.addEventListener('click', () => {
    socket.emit('start_game');
});

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
    
    // Запускаем клиентский игровой цикл
    startClientGameLoop();
});

// ==================== ИГРОВОЙ ЦИКЛ КЛИЕНТА (60 FPS) ====================
function startClientGameLoop() {
    // Слушаем обновления от сервера
    socket.on('game_state_update', (state) => {
        const now = performance.now();

        if (state.players) {
            Object.keys(state.players).forEach(id => {
                const p = state.players[id];
                const prev = playerRenderData[id];

                if (prev && prev.nextTime) {
                  playerRenderData[id] = {
                      ...prev,
                      prevX: prev.nextX,
                      prevY: prev.nextY,
                      prevTime: prev.nextTime,
                      nextX: p.x,
                      nextY: p.y,
                      nextTime: now,
                      color: p.color,
                      name: p.name,
                      score: p.score          // ← добавь эту строку
                  };
                } else {
                  playerRenderData[id] = {
                      prevX: p.x,
                      prevY: p.y,
                      nextX: p.x,
                      nextY: p.y,
                      prevTime: now - 33,
                      nextTime: now,
                      color: p.color,
                      name: p.name,
                      score: p.score          // ← добавь эту строку
                  };
                }
            });

            Object.keys(playerRenderData).forEach(id => {
                if (!state.players[id]) {
                    delete playerRenderData[id];
                }
            });
        }

        currentGameState = state;
    });

    // Главный цикл рендеринга
    function gameLoop(timestamp) {
        const now = timestamp || performance.now();
        if (!currentGameState || !currentGameState.players) {
            animationFrame = requestAnimationFrame(gameLoop);
            return;
        }

        sendInput();

        // Создаём/обновляем DOM-элементы игроков
        Object.keys(currentGameState.players).forEach(id => {
            const p = currentGameState.players[id];
            
            if (!playerElements[id]) {
                // Создаём нового игрока
                const playerDiv = document.createElement('div');
                playerDiv.className = 'player';
                playerDiv.style.backgroundColor = p.color;
                
                // Имя над игроком
                const nameDiv = document.createElement('div');
                nameDiv.className = 'player-name';
                nameDiv.textContent = p.name;
                playerDiv.appendChild(nameDiv);
                
                gameBoard.appendChild(playerDiv);
                playerElements[id] = playerDiv;
            }

            const renderInfo = playerRenderData[id];
            let x = p.x;
            let y = p.y;

            if (renderInfo) {
                const interval = Math.max(16, renderInfo.nextTime - renderInfo.prevTime);
                let t = (now - renderInfo.prevTime) / interval;
                t = Math.min(1, Math.max(0, t));
                x = renderInfo.prevX + (renderInfo.nextX - renderInfo.prevX) * t;
                y = renderInfo.prevY + (renderInfo.nextY - renderInfo.prevY) * t;
            }

            const el = playerElements[id];
            el.style.transform = `translate3d(${x - 20}px, ${y - 20}px, 0)`;
        });

        // Создаём/обновляем DOM-элементы препятствий (obstacles)
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
                // obstacles are typically rectangular
                el.style.width = (obs.width || 40) + 'px';
                el.style.height = (obs.height || 40) + 'px';
                el.style.transform = `translate3d(${obs.x - (obs.width||40)/2}px, ${obs.y - (obs.height||40)/2}px, 0)`;
            });
        }

        // Ресурсы (например, золото, health)
        if (currentGameState.resources) {
            currentGameState.resources.forEach(res => {
                if (!resourceElements[res.id]) {
                    const d = document.createElement('div');
                    d.className = 'resource';
                    d.title = res.type || 'resource';
                    gameBoard.appendChild(d);
                    resourceElements[res.id] = d;
                }
                const el = resourceElements[res.id];
                const size = res.size || 14;
                el.style.width = size + 'px';
                el.style.height = size + 'px';
                el.style.backgroundColor = res.color || '#f1c40f';
                el.style.transform = `translate3d(${res.x - size/2}px, ${res.y - size/2}px, 0)`;
            });
        }

        // Снаряды / проектайлы
        if (currentGameState.projectiles) {
            currentGameState.projectiles.forEach(pr => {
                if (!projectileElements[pr.id]) {
                    const d = document.createElement('div');
                    d.className = 'projectile';
                    gameBoard.appendChild(d);
                    projectileElements[pr.id] = d;
                }
                const el = projectileElements[pr.id];
                const size = pr.size || 8;
                el.style.width = size + 'px';
                el.style.height = size + 'px';
                el.style.backgroundColor = pr.color || '#ecf0f1';
                el.style.transform = `translate3d(${pr.x - size/2}px, ${pr.y - size/2}px, 0)`;
            });
        }

        // Удаляем игроков, которые вышли
        Object.keys(playerElements).forEach(id => {
            if (!currentGameState.players[id]) {
                playerElements[id].remove();
                delete playerElements[id];
            }
        });

        // Удаляем препятствия, ресурсы и снаряды, которые исчезли
        Object.keys(obstacleElements).forEach(id => {
            if (!currentGameState.obstacles || !currentGameState.obstacles.find(o => o.id === id)) {
                obstacleElements[id].remove();
                delete obstacleElements[id];
            }
        });

        Object.keys(resourceElements).forEach(id => {
            if (!currentGameState.resources || !currentGameState.resources.find(r => r.id === id)) {
                resourceElements[id].remove();
                delete resourceElements[id];
            }
        });

        Object.keys(projectileElements).forEach(id => {
            if (!currentGameState.projectiles || !currentGameState.projectiles.find(p => p.id === id)) {
                projectileElements[id].remove();
                delete projectileElements[id];
            }
        });

        animationFrame = requestAnimationFrame(gameLoop);
    }

    gameLoop(); // Запуск цикла
}

// Вспомогательная функция
function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.style.display = 'block';
}