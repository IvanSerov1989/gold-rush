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

// Логика работы с сетью (Socket.io)
io.on('connection', (socket) => {
    console.log(`Игрок подключился: ${socket.id}`);

    socket.on('disconnect', () => {
        console.log(`Игрок отключился: ${socket.id}`);
    });
});

server.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});