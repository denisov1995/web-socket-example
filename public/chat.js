let socket;
let selectedUserID = null;
let selectedUsername = null;
let myUsername = null;

async function register() {
  const username = document.getElementById("regName").value.trim();
  const password = document.getElementById("regPass").value.trim();
  const file = document.getElementById("regAvatar").files[0];

  if (!username || !password || !file) return alert("Заполните все поля");
  if (file.size > 1024 * 1024)
    return alert("Аватар слишком большой (макс 1MB)");

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password, avatar: reader.result }),
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
  };
  reader.readAsDataURL(file);
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

async function loadChatHistory(withUsername) {
  try {
    const response = await fetch(`/api/messages?user1=${myUsername}&user2=${withUsername}`, {
      credentials: 'include'
    });
    
    if (!response.ok) throw new Error('Ошибка загрузки истории');
    
    const messages = await response.json();
    const chatDiv = document.getElementById("chat");
    chatDiv.innerHTML = `<b>Чат с ${withUsername}</b><br/>`;
    
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
      
      div.appendChild(document.createTextNode(`${from}: ${text}`));
      chatDiv.appendChild(div);
    });
    
    // Прокрутка вниз
    chatDiv.scrollTop = chatDiv.scrollHeight;
  } catch (err) {
    console.error("Ошибка загрузки истории:", err);
    document.getElementById("chat").innerHTML += `<div class="error">Не удалось загрузить историю</div>`;
  }
}

async function initChat() {
  document.getElementById("auth").style.display = "none";
  document.getElementById("chatUI").style.display = "block";

  socket = io({ withCredentials: true });
  myUsername = localStorage.getItem("username");

  socket.on("users", (users) => {
    const usersDiv = document.getElementById("users");
    usersDiv.innerHTML = "<b>Пользователи:</b><br/>";
    
    users.forEach((user) => {
      if (user.userID !== socket.id) {
        const btn = document.createElement("button");
        btn.textContent = user.username;
        btn.onclick = async () => {
          selectedUserID = user.userID;
          selectedUsername = user.username;
          document.getElementById("sendBtn").disabled = false;
          await loadChatHistory(user.username);
        };
        usersDiv.appendChild(btn);
      }
    });
  });

  socket.on("private message", ({ from, avatar, text }) => {
    // Показываем сообщение только если оно от выбранного пользователя
    if (from === selectedUsername) {
      const div = document.createElement("div");
      div.className = "msg";
      if (from === myUsername) {
        div.classList.add("you");
      }
      if (avatar) {
        const img = document.createElement("img");
        img.src = avatar;
        img.className = "avatar";
        div.appendChild(img);
      }
      div.appendChild(document.createTextNode(`${from}: ${text}`));
      document.getElementById("chat").appendChild(div);
      
      // Прокрутка вниз
      document.getElementById("chat").scrollTop = document.getElementById("chat").scrollHeight;
    }
  });
}

function sendMessage() {
  const input = document.getElementById("msgInput");
  const text = input.value.trim();
  
  if (text && selectedUserID && selectedUsername) {
    socket.emit("private message", {
      content: text,
      to: selectedUserID,
    });

    // Локально отображаем сообщение
    const chatDiv = document.getElementById("chat");
    const div = document.createElement("div");
    div.className = "msg you";
    div.textContent = `Вы: ${text}`;
    chatDiv.appendChild(div);
    
    // Прокрутка вниз
    chatDiv.scrollTop = chatDiv.scrollHeight;
    
    input.value = "";
  }
}