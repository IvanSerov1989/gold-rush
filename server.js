const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Указываем Express отдавать все файлы из папки public автоматически
app.use(express.static(path.join(__dirname, 'public')));

// Хранилище игроков: { socketId: { id, name, isLeader } }
const players = {};
const MAX_PLAYERS = 4;
let gameInProgress = false;

io.on('connection', (socket) => {
    console.log(`Подключение: ${socket.id}`);

    // Обработка попытки входа
    socket.on('join_game', (username) => {
        if (gameInProgress) {
            return socket.emit('join_error', 'Игра уже началась!');
        }
        if (Object.keys(players).length >= MAX_PLAYERS) {
            return socket.emit('join_error', 'Лобби заполнено (макс 4 игрока)!');
        }
        
        // Проверка на уникальность имени
        const isNameTaken = Object.values(players).some(p => p.name === username);
        if (isNameTaken) {
            return socket.emit('join_error', 'Это имя уже занято!');
        }

        // Если игроков нет, первый становится лидером
        const isLeader = Object.keys(players).length === 0;

        players[socket.id] = {
            id: socket.id,
            name: username,
            isLeader: isLeader
        };

        // Отправляем успешный ответ клиенту
        socket.emit('join_success', players[socket.id]);
        
        // Обновляем лобби для всех
        io.emit('update_lobby', Object.values(players));
    });

    // Обработка старта игры лидером
    socket.on('start_game', () => {
        if (players[socket.id] && players[socket.id].isLeader) {
            gameInProgress = true;
            io.emit('game_started');
        }
    });

    // Обработка отключения
    socket.on('disconnect', () => {
        console.log(`Отключение: ${socket.id}`);
        if (players[socket.id]) {
            const wasLeader = players[socket.id].isLeader;
            delete players[socket.id];

            // Если вышел лидер и в лобби еще есть люди, передаем лидерство первому попавшемуся
            const remainingPlayers = Object.keys(players);
            if (wasLeader && remainingPlayers.length > 0) {
                players[remainingPlayers[0]].isLeader = true;
            }

            if (remainingPlayers.length === 0) {
                gameInProgress = false; // Сбрасываем статус игры, если все вышли
            }

            io.emit('update_lobby', Object.values(players));
        }
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});