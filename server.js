const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  const address = process.env.HOST || 'http://localhost';
  console.log(`✅ Приложение запущено: ${address}:${PORT}`);
});

// WebSocket обработка
wss.on('connection', ws => {
  ws.send('Добро пожаловать в чат!');

  ws.on('message', message => {
    const text = typeof message === 'string' ? message : message.toString();
    console.log('📨 Получено сообщение:', text);

    // Рассылаем всем клиентам
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(text);
      }
    });
  });
});
