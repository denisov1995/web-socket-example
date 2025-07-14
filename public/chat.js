// ✅ chat.js — обновлённая версия с подсветкой непрочитанных и их очисткой при просмотре

window.addEventListener("DOMContentLoaded", async () => {
  const saved = localStorage.getItem("username");
  console.log();

  if (saved) {
    // ⬇️ У тебя уже есть cookie с профилем (задана при login/register)
    // Просто запускаем initChat
    await initChat();
  }
});

let socket;
let selectedUserID = null;
let selectedUsername = null;
let myUsername = null;
let unreadMessages = [];
let typingInterval = null;

async function register() {
  const username = document.getElementById("regName").value.trim();
  const password = document.getElementById("regPass").value.trim();

  try {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error);
    }

    const data = await response.json();
    if (data.success) {
      localStorage.setItem("username", username);
      myUsername = username;
      await initChat();
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert(err.message);
  }
}

async function login() {
  const username = document.getElementById("logName").value.trim();
  const password = document.getElementById("logPass").value.trim();

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error);
    }

    const data = await response.json();
    if (data.success) {
      localStorage.setItem("username", username);
      myUsername = username;
      await initChat();
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert(err.message);
  }
}

function sendPublicMessage() {
  const input = document.getElementById("publicInput");
  const text = input.value.trim();
  if (text) {
    socket.emit("public message", text);
    input.value = "";
  }
}

async function loadChatHistory(withUsername) {
  try {
    const response = await fetch(
      `/api/messages?user1=${myUsername}&user2=${withUsername}`,
      {
        credentials: "include",
      }
    );

    if (!response.ok) throw new Error("Ошибка загрузки истории");

    const messages = await response.json();
    const chatDivWrap = document.querySelector(".chat-wrapper");

    // ✅ Проверка — существует ли div заголовка
    let divTitle = chatDivWrap.querySelector(".chat-wrapper-title");
    if (!divTitle) {
      divTitle = document.createElement("div");
      divTitle.className = "chat-wrapper-title";
      chatDivWrap.prepend(divTitle); // добавляем только один раз
    }

    divTitle.innerHTML = `<b>Чат с ${withUsername}</b><br/>`;

    const chatDiv = document.getElementById("chat");
    chatDiv.innerHTML = ""; // ✅ Очищаем старые сообщения

    messages.forEach(({ from, avatar, text }) => {
      const div = document.createElement("div");
      div.className = "msg";
      if (from === myUsername) div.classList.add("you");

      if (avatar) {
        const img = document.createElement("img");
        img.src = avatar;
        img.className = "avatar";
        div.appendChild(img);
      }

      const authorLabel = from === myUsername ? "Вы" : from;
      div.appendChild(document.createTextNode(`${authorLabel}: ${text}`));
      chatDiv.appendChild(div);
    });

    // ✅ прокрутка вниз и очистка флага
    chatDiv.scrollTop = chatDiv.scrollHeight;
    unreadMessages = unreadMessages.filter((name) => name !== withUsername);
    renderUsers();

    // ✅ серверное обновление isRead
    await fetch("/api/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: withUsername, to: myUsername }),
    });
  } catch (err) {
    console.error("Ошибка загрузки истории:", err);
    document.getElementById(
      "chat"
    ).innerHTML += `<div class="error">Не удалось загрузить историю</div>`;
  }
}

function renderUsersList(users) {
  const usersDiv = document.getElementById("users");
  usersDiv.innerHTML = ""; // ✅ очищаем перед повторной отрисовкой
  console.log("users", users);

  users.forEach((user) => {
    if (user.username !== myUsername) {
      const hasUnread = unreadMessages.includes(user.username);
      const btn = document.createElement("button");
      console.log(" user.lastFrom === myUsername", user.lastFrom, myUsername);

      const previewAuthor =
        user.lastFrom === myUsername
          ? "<span style='color:#333;'>Вы: </span>"
          : "";

      const text = user.lastText ? `${previewAuthor}${user.lastText}` : "";

      const marker = hasUnread ? " ●" : "";
      btn.innerHTML = `<strong>${user.username}</strong>${marker}<br><span class="preview">${text}</span>`;

      btn.onclick = async () => {
        selectedUsername = user.username;
        document.getElementById("sendBtn").disabled = false;
        document.getElementById("msgInput").style.display = "block";
        document.getElementById("sendBtn").style.display = "flex";
        await loadChatHistory(user.username);
      };

      usersDiv.appendChild(btn);
    }
  });
}

function renderUsers() {
  // просто перерисовываем текущий список
  if (socket && socket.listeners("users").length > 0) {
    socket.emit("request users update"); // альтернативный способ
  }
}

async function initChat() {
  // ⬇️ Показываем чат, скрываем форму авторизации
  document.getElementById("auth").style.display = "none";
  document.getElementById("chatUI").style.display = "block";

  socket = io({ withCredentials: true });

  // ✅ Устанавливаем имя пользователя
  myUsername = localStorage.getItem("username");
  console.log("myUsername", myUsername);

  // ✅ Загружаем список тех, от кого есть непрочитанные
  const unreadResponse = await fetch(`/api/unread/${myUsername}`);
  unreadMessages = await unreadResponse.json();

  renderUsers();

  // ✅ Получаем список пользователей от сервера
  socket.on("users", (users) => {
    renderUsersList(users);
  });

  document.getElementById("chat").innerHTML = `<div class="empty-chat">
  Select a chat to start messaging
</div>`;

  // ✅ Событие «печатает...»
  document.getElementById("msgInput").addEventListener("input", () => {
    if (selectedUsername) {
      socket.emit("typing", { to: selectedUsername });
    }
  });

  // ✅ Остановка «печатает...»
  document.getElementById("msgInput").addEventListener("blur", () => {
    if (selectedUsername) {
      console.log(6555, selectedUsername);
      socket.emit("stop typing", { to: selectedUsername });
    }
  });

  // ✅ Отображение индикатора «печатает...»
  socket.on("typing", ({ from }) => {
    if (selectedUsername === from && !typingInterval) {
      const indicator = document.getElementById("typingIndicator");
      let dots = "";
      indicator.textContent = `${from} печатает`;

      typingInterval = setInterval(() => {
        dots = dots.length < 3 ? dots + "." : "";
        indicator.textContent = `${from} печатает${dots}`;
      }, 500);
    }
  });

  socket.on("stop typing", ({ from }) => {
    if (selectedUsername === from) {
      const indicator = document.getElementById("typingIndicator");
      indicator.textContent = "";
      clearInterval(typingInterval); // ✅ Останавливаем бегущие точки
      typingInterval = null;
    }
  });

  // ✅ Общие сообщения
  socket.on("public message", ({ from, avatar, text }) => {
    const div = document.createElement("div");
    div.className = "msg";
    if (from === myUsername) div.classList.add("you");

    if (avatar) {
      const img = document.createElement("img");
      img.src = avatar;
      img.className = "avatar";
      div.appendChild(img);
    }

    const label = from === myUsername ? "Вы" : from;
    div.appendChild(document.createTextNode(`${label}: ${text}`));
    document.getElementById("publicChat").appendChild(div);
  });

  // ✅ Приватные сообщения
  socket.on("private message", ({ from, to, avatar, text }) => {
    const isRelevant =
      from === selectedUsername ||
      (from === myUsername && to === selectedUsername);

    if (isRelevant) {
      const div = document.createElement("div");
      div.className = "msg";
      if (from === myUsername) div.classList.add("you");

      if (avatar) {
        const img = document.createElement("img");
        img.src = avatar;
        img.className = "avatar";
        div.appendChild(img);
      }

      const label = from === myUsername ? "Вы" : from;
      div.appendChild(document.createTextNode(`${label}: ${text}`));
      document.getElementById("chat").appendChild(div);
      document.getElementById("chat").scrollTop =
        document.getElementById("chat").scrollHeight;
    } else if (to === myUsername) {
      // ✅ Добавляем в список непрочитанных, если чат не открыт
      if (!unreadMessages.includes(from)) unreadMessages.push(from);
      renderUsers();
    }
  });

  // ✅ История общего чата
  socket.on("public history", (messages) => {
    const chatDiv = document.getElementById("publicChat");
    messages.forEach(({ from, avatar, text }) => {
      const div = document.createElement("div");
      div.className = "msg";
      if (from === myUsername) div.classList.add("you");
      if (avatar) {
        const img = document.createElement("img");
        img.src = avatar;
        img.className = "avatar";
        div.appendChild(img);
      }
      const label = from === myUsername ? "Вы" : from;
      div.appendChild(document.createTextNode(`${label}: ${text}`));
      chatDiv.appendChild(div);
    });
  });
}

function sendMessage() {
  const input = document.getElementById("msgInput");
  const text = input.value.trim();

  if (text && selectedUsername) {
    socket.emit("private message", {
      content: text,
      toUsername: selectedUsername,
    });
    input.value = "";
  }

  socket.emit("stop typing", { to: selectedUsername });
}

function togglePublicChat() {
  const content = document.getElementById("publicChatContent");
  const header = document.querySelector("#publicChatContainer h3");

  if (content.style.display === "none") {
    console.log("yes");

    content.style.display = "block";
    header.textContent = "Общий чат ▾";
  } else {
    content.style.display = "none";
    header.textContent = "Общий чат ▸";
  }
}

function togglePrivateChat() {
  const content = document.getElementById("privateChatContent");
  const header = document.querySelector("#privateChatContainer h3");

  if (content.style.display === "none") {
    content.style.display = "flex";
    header.textContent = "Приватный чат ▾";
    console.log("header.textContent ", header.textContent);
  } else {
    content.style.display = "none";
    header.textContent = "Приватный чат ▸";
  }
}
