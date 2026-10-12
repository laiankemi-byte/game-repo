const socket = io();

let me = null;
let currentMatchId = null;

const views = {
  access: document.getElementById("view-access"),
  create: document.getElementById("view-create"),
  lobby: document.getElementById("view-lobby"),
  game: document.getElementById("view-game"),
  eliminated: document.getElementById("view-eliminated"),
  winner: document.getElementById("view-winner"),
  stars: document.getElementById("view-stars")
};

function showView(name) {
  for (const v of Object.values(views)) v.classList.add("hidden");
  if (views[name]) views[name].classList.remove("hidden");
}

showView("create");

history.replaceState(null, "", location.href);
window.addEventListener("popstate", () => {
  history.replaceState(null, "", location.href);
});

socket.on("accessDenied", msg => {
  alert(msg);
  showView("access");
});

document.getElementById("createBtn").onclick = () => {
  const name = document.getElementById("nameInput").value.trim();
  if (!name) return alert("请输入名字");
  socket.emit("createAccount", name);
};

socket.on("accountCreated", player => {
  me = player;
  showView("lobby");
});

const readyBtn = document.getElementById("readyBtn");
readyBtn.onclick = () => {
  socket.emit("setReady");
  readyBtn.disabled = true;
  readyBtn.textContent = "已准备";
};

const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

sendBtn.onclick = () => {
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit("chatMessage", msg);
  chatInput.value = "";
};

chatInput.addEventListener("keydown", e => {
  if (e.key === "Enter") sendBtn.click();
});

socket.on("lobbyUpdate", data => {
  const info = document.getElementById("lobbyInfo");
  info.textContent = `在线 ${data.players.length} 人 | 已准备 ${data.readyCount}/${data.needReady}`;

  const list = document.getElementById("playerList");
  list.innerHTML = "";
  for (const p of data.players) {
    const div = document.createElement("div");
    div.textContent = `${p.name} ${p.ready ? "[已准备]" : ""}`;
    list.appendChild(div);
  }
});

socket.on("chatMessage", data => {
  const list = document.getElementById("chatList");
  const div = document.createElement("div");
  div.textContent = `${data.name}: ${data.message}`;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
});

socket.on("byeMessage", msg => {
  const list = document.getElementById("chatList");
  const div = document.createElement("div");
  div.textContent = `[系统] ${msg}`;
  list.appendChild(div);
});

socket.on("matchStart", data => {
  currentMatchId = data.matchId;
  showView("game");

  const info = document.getElementById("matchInfo");
  info.textContent = `对手: ${data.opponent} | 第 ${data.round}/${data.maxRounds} 局`;

  document.getElementById("gameLog").innerHTML = "";
  document.getElementById("options").style.pointerEvents = "auto";
});

document.getElementById("options").onclick = e => {
  const btn = e.target;
  if (!btn.dataset.choice) return;
  if (!currentMatchId) return;
  socket.emit("makeChoice", {
    matchId: currentMatchId,
    choice: btn.dataset.choice
  });
  document.getElementById("options").style.pointerEvents = "none";
};

socket.on("roundResult", data => {
  const log = document.getElementById("gameLog");
  const map = { rock: "石头", paper: "布", scissors: "剪刀" };
  const div = document.createElement("div");
  div.textContent = `第${data.round}局 你: ${map[data.myChoice]} 对手: ${map[data.opponentChoice]} | ${data.result === "DRAW" ? "平局" : data.result === "A" ? "你胜" : "你负"}`;
  log.appendChild(div);
});

socket.on("nextRound", data => {
  const info = document.getElementById("matchInfo");
  info.textContent = `第 ${data.round}/${data.maxRounds} 局`;
  document.getElementById("options").style.pointerEvents = "auto";
});

socket.on("backToLobby", () => {
  currentMatchId = null;
  showView("lobby");
  if (readyBtn) {
    readyBtn.disabled = false;
    readyBtn.textContent = "准备";
  }
});

socket.on("eliminated", () => {
  currentMatchId = null;
  showView("eliminated");
  document.getElementById("spectatorBox").innerHTML = "<p>等待对战信息…</p>";
});

socket.on("spectatorUpdate", data => {
  const box = document.getElementById("spectatorBox");
  if (!box) return;
  box.innerHTML = `
    <p>${data.aName} vs ${data.bName}</p>
    <p>第 ${data.round}/${data.maxRounds} 局 | 比分 ${data.aWins}:${data.bWins}</p>
    <p>状态: ${data.state}</p>
  `;
});

socket.on("gameOver", data => {
  showView("winner");
  document.getElementById("winnerText").textContent = `${data.winner} 获得最终胜利！`;
});

socket.on("showStarrySky", () => {
  showView("stars");
  const stars = document.getElementById("stars");
  stars.innerHTML = "";

  for (let i = 0; i < 120; i++) {
    const star = document.createElement("div");
    star.className = "star";
    star.style.left = Math.random() * 100 + "%";
    star.style.top = Math.random() * 100 + "%";
    star.style.animationDelay = Math.random() * 2 + "s";
    stars.appendChild(star);
  }
});

socket.on("logout", () => {
  me = null;
  currentMatchId = null;
  showView("create");
});