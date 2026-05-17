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

// --- ОТПРАВКА ДАННЫХ НА СЕРВЕР ---

joinBtn.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username.length < 2) {
        showError('Имя должно быть не короче 2 символов');
        return;
    }
    socket.emit('join_game', username);
});

startGameBtn.addEventListener('click', () => {
    socket.emit('start_game');
});

// --- ОБРАБОТКА ОТВЕТОВ ОТ СЕРВЕРА ---

// Ошибка при входе
socket.on('join_error', (message) => {
    showError(message);
});

// Успешный вход
socket.on('join_success', (playerInfo) => {
    myPlayerInfo = playerInfo;
    joinScreen.style.display = 'none';
    lobbyScreen.style.display = 'block';
});

// Обновление списка лобби
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
        // Выделяем себя в списке
        if (player.id === socket.id) {
            li.style.fontWeight = 'bold';
        }
        playersList.appendChild(li);
    });

    // Показываем кнопку старта ТОЛЬКО лидеру, если игроков >= 2
    // (Для теста можно поменять players.length >= 2 на >= 1, чтобы запустить одному)
    const amILeader = players.find(p => p.id === socket.id)?.isLeader;
    if (amILeader) {
        waitingMessage.style.display = 'none';
        startGameBtn.style.display = players.length >= 2 ? 'inline-block' : 'none';
        if (players.length < 2) {
             waitingMessage.style.display = 'block';
             waitingMessage.textContent = 'Ждем других игроков...';
        }
    } else {
        startGameBtn.style.display = 'none';
        waitingMessage.style.display = 'block';
        waitingMessage.textContent = 'Ожидаем лидера для старта...';
    }
});

// Старт игры
socket.on('game_started', () => {
    lobbyScreen.style.display = 'none';
    gameBoard.style.display = 'block'; // Показываем игровое поле
    console.log('Игра началась! Переход к игровому циклу.');
});

// Вспомогательная функция
function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.style.display = 'block';
}