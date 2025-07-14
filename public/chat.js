// ✅ chat.js — обновлённая версия с подсветкой непрочитанных и их очисткой при просмотре

window.addEventListener("DOMContentLoaded", async () => {
  const saved = localStorage.getItem("username");

  if (saved) {
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

  const avatarInput = document.getElementById("regAvatar");
  const avatarFile = avatarInput.files[0];

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const avatar = avatarFile ? await toBase64(avatarFile) : null;

  try {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password, avatar }),
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

    let divTitle = chatDivWrap.querySelector(".chat-wrapper-title");
    if (!divTitle) {
      divTitle = document.createElement("div");
      divTitle.className = "chat-wrapper-title";
      chatDivWrap.prepend(divTitle);
    }

    divTitle.innerHTML = `<b>Чат с ${withUsername}</b><br/>`;

    const chatDiv = document.getElementById("chat");
    chatDiv.innerHTML = "";

    messages.forEach(({ sender: from, avatar, text, image, timestamp }) => {
      const div = document.createElement("div");
      div.className = "msg";
      if (from === myUsername) div.classList.add("you");

      if (avatar) {
        const imgAvatar = document.createElement("img");
        imgAvatar.src = avatar;
        imgAvatar.className = "avatar";
        div.appendChild(imgAvatar);
      }

      const authorLabel = from === myUsername ? "Вы" : from;

      if (text) {
        div.appendChild(document.createTextNode(`${authorLabel}: ${text}`));
      }

      if (image) {
        if (!text) {
          div.appendChild(document.createTextNode(`${authorLabel}: `));
        }
        const img = document.createElement("img");
        img.src = image;
        img.style.maxWidth = "200px";
        img.style.borderRadius = "6px";
        img.style.marginTop = "6px";
        div.appendChild(img);
      }

      if (timestamp) {
        const timeDiv = document.createElement("div");
        const dt = new Date(timestamp);
        const hours = String(dt.getHours()).padStart(2, "0");
        const minutes = String(dt.getMinutes()).padStart(2, "0");
        const formatted = `${hours}:${minutes}`;
        timeDiv.className = "msg-time";
        timeDiv.innerText = formatted;
        div.appendChild(timeDiv);
      }

      chatDiv.appendChild(div);
    });

    chatDiv.scrollTop = chatDiv.scrollHeight;
    unreadMessages = unreadMessages.filter((name) => name !== withUsername);
    renderUsers();

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
  usersDiv.innerHTML = "";

  users.forEach((user) => {
    if (user.username !== myUsername) {
      const hasUnread = unreadMessages.includes(user.username);
      const btn = document.createElement("button");
      const users = document.createElement("div");

      if (user.avatar) {
        const img = document.createElement("img");
        img.src = user.avatar;
        img.className = "avatar";
        users.appendChild(img);
      }

      const statusDot = user.online
        ? `<span class="status-dot online" title="online"></span>`
        : `<span class="status-dot offline" title="offline"></span>`;

      const previewAuthor =
        user.lastFrom === myUsername
          ? "<span style='color:#333;'>Вы: </span>"
          : user.lastFrom
          ? `<span style='color:#555;'>${user.lastFrom}: </span>`
          : "";

      const previewText = user.lastText
        ? `${previewAuthor}${user.lastText}`
        : "";

      const marker = hasUnread ? " ●" : "";

      btn.innerHTML = `
        ${statusDot}
        <strong>${user.username}</strong>${marker}<br>
        <span class="preview">${previewText}</span>
      `;

      users.onclick = async () => {
        selectedUsername = user.username;
        document.getElementById("sendBtn").disabled = false;
        document.getElementById("msgInput").style.display = "block";
        document.getElementById("sendBtn").style.display = "flex";
        await loadChatHistory(user.username);
      };
      users.appendChild(btn);
      usersDiv.appendChild(users);
    }
  });
}

function renderUsers() {
  if (socket && socket.listeners("users").length > 0) {
    socket.emit("request users update");
  }
}

async function initChat() {
  document.getElementById("auth").style.display = "none";
  document.getElementById("chatUI").style.display = "block";

  socket = io({ withCredentials: true });

  myUsername = localStorage.getItem("username");

  const unreadResponse = await fetch(`/api/unread/${myUsername}`);
  unreadMessages = await unreadResponse.json();

  renderUsers();

  socket.on("users", (users) => {
    renderUsersList(users);
  });

  document.getElementById("chat").innerHTML = `<div class="empty-chat">
  Select a chat to start messaging
</div>`;

  document.getElementById("msgInput").addEventListener("input", () => {
    if (selectedUsername) {
      socket.emit("typing", { to: selectedUsername });
    }
  });

  document.getElementById("msgInput").addEventListener("blur", () => {
    if (selectedUsername) {
      socket.emit("stop typing", { to: selectedUsername });
    }
  });

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
      clearInterval(typingInterval);
      typingInterval = null;
    }
  });

  socket.on("public message", ({ sender: from, avatar, text }) => {
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

  socket.on("private message", ({ sender: from, receiver: to, avatar, text }) => {
    console.log('receiver', to);
    
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
      if (!unreadMessages.includes(from)) unreadMessages.push(from);
      renderUsers();
    }
  });

  socket.on("private image", ({ sender: from, receiver: to, image, avatar }) => {
    const isRelevant =
      from === selectedUsername ||
      (from === myUsername && to === selectedUsername);

    if (!isRelevant) return;

    const div = document.createElement("div");
    div.className = "msg";
    if (from === myUsername) div.classList.add("you");

    if (avatar) {
      const imgAvatar = document.createElement("img");
      imgAvatar.src = avatar;
      imgAvatar.className = "avatar";
      div.appendChild(imgAvatar);
    }

    const label = from === myUsername ? "Вы" : from;
    div.appendChild(document.createTextNode(`${label}: `));

    const img = document.createElement("img");
    img.src = image;
    img.style.maxWidth = "200px";
    img.style.borderRadius = "6px";
    img.style.marginTop = "6px";
    div.appendChild(img);

    const chatDiv = document.getElementById("chat");
    chatDiv.appendChild(div);
    chatDiv.scrollTop = chatDiv.scrollHeight;
  });

  socket.on("public history", (messages) => {
    const chatDiv = document.getElementById("publicChat");
    messages.forEach(({ sender: from, avatar, text }) => {
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
  } else {
    content.style.display = "none";
    header.textContent = "Приватный чат ▸";
  }
}

async function sendImage() {
  const fileInput = document.getElementById("imgInput");
  const file = fileInput.files[0];

  if (!file || !selectedUsername) return;

  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result;
    socket.emit("private image", {
      toUsername: selectedUsername,
      image: base64,
    });
  };
  reader.readAsDataURL(file);
}