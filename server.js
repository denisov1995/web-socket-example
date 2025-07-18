const express = require("express");
const http = require("http");
const path = require("path");
const cookieParser = require("cookie-parser");
const cookie = require("cookie");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const { open } = require("sqlite");

const MAX_HISTORY = 50;
console.log('🔥 Сервер перезапущен!');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "https://your-frontend-url.onrender.com",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

// Инициализация базы данных
async function initializeDB() {
  const db = await open({
    filename: path.join(__dirname, "chat.db"),
    driver: sqlite3.Database,
  });

  // Создание таблиц, если они не существуют
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      avatar TEXT
    );
    
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT,
      receiver TEXT,
      text TEXT,
      image TEXT,
      is_read BOOLEAN DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      avatar TEXT
    );
  `);

  return db;
}

// Инициализация DB при старте
let db;
initializeDB().then((database) => {
  db = database;
  server.listen(PORT, () => {
    console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
  });
});

// 📦 Регистрация
app.post("/api/register", async (req, res) => {
  const { username, password, avatar } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Все поля обязательны" });
  }

  try {
    // Проверяем существование пользователя
    const existingUser = await db.get(
      "SELECT username FROM users WHERE username = ?",
      [username]
    );

    if (existingUser) {
      return res.status(409).json({ error: "Пользователь уже существует" });
    }

    // Сохраняем нового пользователя
    await db.run(
      "INSERT INTO users (username, password, avatar) VALUES (?, ?, ?)",
      [username, password, avatar]
    );

    // Устанавливаем cookie
    const profile = { username };
    res.cookie("profile", JSON.stringify(profile), {
      maxAge: 86400000,
      httpOnly: false,
      secure: false,
      sameSite: "lax",
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка регистрации:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// 🔑 Логин
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const user = await db.get(
      "SELECT username FROM users WHERE username = ? AND password = ?",
      [username, password]
    );

    if (!user) {
      return res.status(401).json({ error: "Неверные данные" });
    }

    res.cookie("profile", JSON.stringify({ username: user.username }), {
      maxAge: 86400000,
      httpOnly: false,
      secure: false,
      sameSite: "lax",
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка входа:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/api/mark-read", async (req, res) => {
  const { from, to } = req.body;

  try {
    await db.run(
      "UPDATE messages SET is_read = 1 WHERE sender = ? AND receiver = ? AND is_read = 0",
      [from, to]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка обновления статуса прочтения:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/api/unread/:username", async (req, res) => {
  const currentUser = req.params.username;

  try {
    const senders = await db.all(
      `SELECT DISTINCT sender 
       FROM messages 
       WHERE receiver = ? AND is_read = 0`,
      [currentUser]
    );

    res.json(senders.map((s) => s.sender));
  } catch (err) {
    console.error("Ошибка получения непрочитанных:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.get("/api/messages", async (req, res) => {
  const { user1, user2 } = req.query;

  try {
    const messages = await db.all(
      `SELECT * FROM messages 
       WHERE (sender = ? AND receiver = ?) 
          OR (sender = ? AND receiver = ?)
       ORDER BY timestamp DESC
       LIMIT ?`,
      [user1, user2, user2, user1, MAX_HISTORY]
    );

    res.json(messages.reverse());
  } catch (err) {
    console.error("Ошибка загрузки истории:", err);
    res.status(500).json({ error: "Ошибка загрузки истории" });
  }
});

// 📋 Отправка списка пользователей
const broadcastUsers = async () => {
  try {
    const allUsers = await db.all("SELECT username, avatar FROM users");
    const connectedUsernames = new Set();

    for (let [, socket] of io.of("/").sockets) {
      if (socket.username) {
        connectedUsernames.add(socket.username);
      }
    }

    for (let [, socket] of io.of("/").sockets) {
      const userList = await Promise.all(
        allUsers
          .filter((u) => u.username !== socket.username)
          .map(async (u) => {
            const lastMessage = await db.get(
              `SELECT text, sender 
               FROM messages 
               WHERE (sender = ? AND receiver = ?) 
                  OR (sender = ? AND receiver = ?)
               ORDER BY timestamp DESC 
               LIMIT 1`,
              [u.username, socket.username, socket.username, u.username]
            );

            return {
              username: u.username,
              avatar: u.avatar,
              online: connectedUsernames.has(u.username),
              lastText: lastMessage?.text || "",
              lastFrom: lastMessage?.sender || null,
            };
          })
      );

      socket.emit("users", userList);
    }
  } catch (err) {
    console.error("❌ Ошибка при сборе списка пользователей:", err.message);
  }
};

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

  // Получаем данные пользователя из БД
  const user = await db.get(
    "SELECT username, avatar FROM users WHERE username = ?",
    [profile.username]
  );

  if (!user) {
    socket.disconnect();
    return;
  }

  socket.username = user.username;
  socket.avatar = user.avatar;

  // Загружаем историю сообщений для этого пользователя
  try {
    const userMessages = await db.all(
      `SELECT * FROM messages 
       WHERE sender = ? OR receiver = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
      [socket.username, socket.username, MAX_HISTORY]
    );

    socket.emit("message history", userMessages.reverse());

    const publicHistory = await db.all(
      `SELECT * FROM messages 
       WHERE receiver = 'public'
       ORDER BY timestamp DESC
       LIMIT ?`,
      [MAX_HISTORY]
    );

    socket.emit("public history", publicHistory.reverse());
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
      sender: socket.username,
      receiver: toUsername,
      text: content,
      avatar: socket.avatar,
      is_read: false,
    };

    try {
      await db.run(
        `INSERT INTO messages (sender, receiver, text, avatar, is_read)
         VALUES (?, ?, ?, ?, ?)`,
        [
          message.sender,
          message.receiver,
          message.text,
          message.avatar,
          message.is_read,
        ]
      );

      // Отправить получателю, если он онлайн
      for (let [id, s] of io.of("/").sockets) {
        if (s.username === toUsername) {
          io.to(id).emit("private message", {
            ...message,
            from: message.sender,
            to: message.receiver,
            isRead: message.is_read,
          });
          break;
        }
      }

      // Отправить самому себе подтверждение
      socket.emit("private message", {
        ...message,
        from: message.sender,
        to: message.receiver,
        isRead: message.is_read,
      });
    } catch (err) {
      console.error("Ошибка сохранения сообщения:", err);
    }

    broadcastUsers();
  });

  socket.on("public message", async (content) => {
    const message = {
      sender: socket.username,
      receiver: "public",
      text: content,
      avatar: socket.avatar,
    };

    try {
      await db.run(
        `INSERT INTO messages (sender, receiver, text, avatar)
         VALUES (?, ?, ?, ?)`,
        [message.sender, message.receiver, message.text, message.avatar]
      );

      io.emit("public message", {
        from: message.sender,
        text: message.text,
        avatar: message.avatar,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Ошибка сохранения публичного сообщения:", err);
    }
  });

  socket.on("private image", async ({ toUsername, image }) => {
    const message = {
      sender: socket.username,
      receiver: toUsername,
      image,
      avatar: socket.avatar,
      text: "[Изображение 📷]",
      is_read: false,
    };

    try {
      await db.run(
        `INSERT INTO messages (sender, receiver,text, image, avatar, is_read)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          message.sender,
          message.receiver,
          message.text,
          message.image,
          message.avatar,
          message.is_read,
        ]
      );

      // Отправка получателю и себе
      for (let [id, s] of io.of("/").sockets) {
        if (s.username === toUsername) {
          io.to(id).emit("private image", {
            ...message,
            from: message.sender,
            to: message.receiver,
            isRead: message.is_read,

            timestamp: new Date().toISOString(),
          });
        }
      }

      socket.emit("private image", {
        ...message,
        from: message.sender,
        to: message.receiver,
        isRead: message.is_read,
        timestamp: new Date().toISOString(),
      });
      broadcastUsers();
    } catch (err) {
      console.error("Ошибка сохранения изображения:", err);
    }
  });

  socket.on("disconnect", () => {
    broadcastUsers();
    socket.broadcast.emit("user disconnected", socket.id);
  });
});
