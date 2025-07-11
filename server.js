const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs-extra");
const cookieParser = require("cookie-parser");
const cookie = require("cookie");
const { Server } = require("socket.io");

const messages = []; // ← хранит историю
const MAX_HISTORY = 50;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "https://your-frontend-url.onrender.com",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const USERS_FILE = path.join(__dirname, "users.json");
const PORT = process.env.PORT || 3000;
const MESSAGES_FILE = path.join(__dirname, "messages.json");

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

// 📦 Регистрация
app.post("/api/register", async (req, res) => {
  const { username, password, avatar } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Все поля обязательны" });

  const users = await fs.readJson(USERS_FILE).catch(() => []);
  if (users.find((u) => u.username === username))
    return res.status(409).json({ error: "Пользователь уже существует" });

  users.push({ username, password, avatar });
  await fs.writeJson(USERS_FILE, users);

  res.cookie("profile", JSON.stringify({ username, avatar }), {
    maxAge: 86400000,
    httpOnly: false,
    secure: false,
    sameSite: "lax",
  });

  res.json({ success: true });
});

// 🔑 Логин
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const users = await fs.readJson(USERS_FILE).catch(() => []);
  const user = users.find(
    (u) => u.username === username && u.password === password
  );
  if (!user) return res.status(401).json({ error: "Неверные данные" });

  res.cookie(
    "profile",
    JSON.stringify({ username: user.username, avatar: user.avatar }),
    {
      maxAge: 86400000,
      httpOnly: false,
      secure: false,
      sameSite: "lax",
    }
  );

  res.json({ success: true });
});

app.get("/api/messages", async (req, res) => {
  const { user1, user2 } = req.query;
  try {
    const allMessages = await fs.readJson(MESSAGES_FILE).catch(() => []);
    const conversation = allMessages.filter(
      (msg) =>
        (msg.from === user1 && msg.to === user2) ||
        (msg.from === user2 && msg.to === user1)
    );
    res.json(conversation.slice(-MAX_HISTORY));
  } catch (err) {
    res.status(500).json({ error: "Ошибка загрузки истории" });
  }
});

server.listen(PORT, () => {
  console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
});

// 📋 Отправка списка пользователей
const broadcastUsers = async () => {
  try {
    const allUsers = await fs.readJson(USERS_FILE).catch(() => []);
    const connectedUsernames = new Set();

    for (let [, socket] of io.of("/").sockets) {
      if (socket.username) {
        connectedUsernames.add(socket.username);
      }
    }

    for (let [, socket] of io.of("/").sockets) {
      const userList = allUsers
        .filter((u) => u.username !== socket.username) // ← исключаем самого себя
        .map((u) => ({
          username: u.username,
          avatar: u.avatar,
          online: connectedUsernames.has(u.username),
        }));

      socket.emit("users", userList); // каждому отправляем свой список
    }
  } catch (err) {
    console.error("❌ Ошибка при сборе списка пользователей:", err.message);
  }
};

// ⚡ Socket.IO
// ⚡ Socket.IO
io.on("connection", async (socket) => {
  const rawCookies = socket.handshake.headers.cookie || "";
  const parsedCookies = cookie.parse(rawCookies);
  let profile = null;

  try {
    profile = parsedCookies.profile ? JSON.parse(parsedCookies.profile) : null;
  } catch (e) {
    console.error("❌ Ошибка парсинга cookie:", e.message);
    profile = null;
  }

  if (!profile?.username) {
    socket.disconnect();
    return;
  }

  socket.username = profile.username;
  socket.avatar = profile.avatar;

  // Загружаем историю сообщений для этого пользователя
  try {
    const allMessages = await fs.readJson(MESSAGES_FILE).catch(() => []);
    const userMessages = allMessages.filter(
      (msg) => msg.from === socket.username || msg.to === socket.id
    );

    // Отправляем историю только что подключившемуся пользователю
    socket.emit("message history", userMessages.slice(-MAX_HISTORY));

    const publicHistory = allMessages.filter((msg) => msg.to === "public");
    socket.emit("public history", publicHistory.slice(-MAX_HISTORY));
  } catch (err) {
    console.error("Ошибка загрузки истории:", err);
  }

  // 🔄 Отправляем список всем
  broadcastUsers();

  socket.broadcast.emit("user connected", {
    userID: socket.id,
    username: socket.username,
  });

  // 💬 Приватные сообщения
  socket.on("private message", async ({ content, toUsername }) => {
    console.log(
      `💬 Сообщение от ${socket.username} → ${toUsername}: ${content}`
    );

    const message = {
      from: socket.username,
      to: toUsername,
      text: content,
      avatar: socket.avatar,
      timestamp: new Date().toISOString(),
    };

    try {
      const messages = await fs.readJson(MESSAGES_FILE).catch(() => []);
      messages.push(message);
      await fs.writeJson(MESSAGES_FILE, messages.slice(-MAX_HISTORY));
    } catch (err) {
      console.error("Ошибка сохранения:", err);
    }

    // 💬 Отправить получателю, если он онлайн
    for (let [id, s] of io.of("/").sockets) {
      if (s.username === toUsername) {
        io.to(id).emit("private message", message);
        break;
      }
    }

    // ✉️ Отправить самому себе подтверждение
    socket.emit("private message", message);
  });

  socket.on("public message", async (content) => {
    const message = {
      from: socket.username,
      text: content,
      avatar: socket.avatar,
      timestamp: new Date().toISOString(),
    };

    // Сохраняем в общий файл истории
    const allMessages = await fs.readJson(MESSAGES_FILE).catch(() => []);
    allMessages.push({ ...message, to: "public" }); // → метка "public"
    await fs.writeJson(MESSAGES_FILE, allMessages.slice(-MAX_HISTORY));

    io.emit("public message", message); // Отправляем всем
  });

  socket.on("disconnect", () => {
    broadcastUsers();
    socket.broadcast.emit("user disconnected", socket.id);
  });
});
