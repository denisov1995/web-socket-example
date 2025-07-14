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

  if (!username || !password) {
    return res.status(400).json({ error: "Все поля обязательны" });
  }

  const users = await fs.readJson(USERS_FILE).catch(() => []);

  if (users.find((u) => u.username === username)) {
    return res.status(409).json({ error: "Пользователь уже существует" });
  }

  // ✅ Сохраняем нового пользователя
  users.push({ username, password, avatar });
  await fs.writeJson(USERS_FILE, users);

  // ✅ Устанавливаем cookie только после успешной регистрации
  const profile = { username };

  res.cookie("profile", JSON.stringify(profile), {
    maxAge: 86400000, // 1 день
    httpOnly: false,
    secure: false, // можно изменить на true при HTTPS
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

app.post("/api/mark-read", async (req, res) => {
  const { from, to } = req.body;
  const messages = await fs.readJson(MESSAGES_FILE).catch(() => []);
  let changed = false;

  messages.forEach((msg) => {
    if (msg.from === from && msg.to === to && !msg.isRead) {
      msg.isRead = true;
      changed = true;
    }
  });

  if (changed) await fs.writeJson(MESSAGES_FILE, messages);
  res.json({ success: true });
});

app.get("/api/unread/:username", async (req, res) => {
  const currentUser = req.params.username;
  const messages = await fs.readJson(MESSAGES_FILE).catch(() => []);
  const senders = new Set();

  messages.forEach((msg) => {
    if (msg.to === currentUser && !msg.isRead) {
      senders.add(msg.from);
    }
  });

  res.json([...senders]);
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
    const allMessages = await fs.readJson(MESSAGES_FILE).catch(() => []);

    const connectedUsernames = new Set();

    for (let [, socket] of io.of("/").sockets) {
      if (socket.username) {
        connectedUsernames.add(socket.username);
      }
    }

    for (let [, socket] of io.of("/").sockets) {
      const userList = allUsers
        .filter((u) => u.username !== socket.username)
        .map((u) => {
          const last = allMessages
            .filter(
              (msg) =>
                (msg.from === u.username && msg.to === socket.username) ||
                (msg.from === socket.username && msg.to === u.username)
            )
            .slice(-1)[0];

          return {
            username: u.username,
            avatar: u.avatar,
            online: connectedUsernames.has(u.username),
            lastText: last?.text || "",
            lastFrom: last?.from || null,
          };
        });

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
    console.error("❌ Cookie парсинг:", e.message);
  }

  if (!profile?.username) {
    socket.disconnect();
    return;
  }

  socket.username = profile.username;

  // ✅ Загрузка аватара из users.json
  const users = await fs.readJson(USERS_FILE).catch(() => []);
  const currentUser = users.find((u) => u.username === profile.username);
  

  socket.username = profile.username;
  socket.avatar = currentUser?.avatar || null;

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
  socket.on("request users update", () => {
    broadcastUsers();
  });

  // 🔄 Отправляем список всем
  broadcastUsers();

  socket.broadcast.emit("user connected", {
    userID: socket.id,
    username: socket.username,
  });

  socket.on("typing", ({ to }) => {
    for (let [id, s] of io.of("/").sockets) {
      if (s.username === to) {
        io.to(id).emit("typing", { from: socket.username });
        break;
      }
    }
  });

  socket.on("stop typing", ({ to }) => {
    for (let [id, s] of io.of("/").sockets) {
      if (s.username === to) {

        io.to(id).emit("stop typing", { from: socket.username });
        break;
      }
    }
  });

  // 💬 Приватные сообщения
  socket.on("private message", async ({ content, toUsername }) => {


    const message = {
      from: socket.username,
      to: toUsername,
      text: content,
      avatar: socket.avatar,
      timestamp: new Date().toISOString(),
      isRead: false, // ⬅️ новый флаг
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

  socket.on("private image", async ({ toUsername, image }) => {

    const message = {
      from: socket.username,
      to: toUsername,
      avatar: socket.avatar,
      image, // Base64
      timestamp: new Date().toISOString(),
      isRead: false,
    };

    const messages = await fs.readJson(MESSAGES_FILE).catch(() => []);
    messages.push(message);
    await fs.writeJson(MESSAGES_FILE, messages.slice(-MAX_HISTORY));

    // Отправка получателю и себе
    for (let [id, s] of io.of("/").sockets) {
      if (s.username === toUsername) {
        io.to(id).emit("private image", message);
      }
    }

    socket.emit("private image", message);
  });

  socket.on("disconnect", () => {
    broadcastUsers();
    socket.broadcast.emit("user disconnected", socket.id);
  });
});
