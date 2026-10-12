const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "../public")));

const MAX_PLAYERS = 13;
const MATCH_DELAY = 60_000;

const players = new Map();
const activeMatches = new Map();
let matchTimer = null;

function countActive() {
  let n = 0;
  for (const p of players.values()) {
    if (["LOBBY", "MATCHED", "PLAYING"].includes(p.status)) n++;
  }
  return n;
}

function alivePlayers() {
  return [...players.values()].filter(
    p => ["LOBBY", "MATCHED", "PLAYING"].includes(p.status)
  );
}

function broadcastLobby() {
  const list = alivePlayers().map(p => ({
    id: p.id,
    name: p.name,
    ready: p.ready,
    status: p.status
  }));

  const readyCount = list.filter(p => p.ready).length;
  const needReady = Math.ceil(list.length / 2);

  io.emit("lobbyUpdate", {
    players: list,
    readyCount,
    needReady,
    canMatch: list.length >= 2 && readyCount >= needReady
  });
}

function startMatchTimer() {
  if (matchTimer) return;
  matchTimer = setTimeout(() => runMatch(), MATCH_DELAY);
}

function tryMatchIfNeeded() {
  const list = alivePlayers();
  if (list.length < 2) return;

  const readyCount = list.filter(p => p.ready).length;
  const needReady = Math.ceil(list.length / 2);

  if (readyCount >= needReady) {
    runMatch();
  } else {
    startMatchTimer();
  }
}

function runMatch() {
  clearTimeout(matchTimer);
  matchTimer = null;

  const list = alivePlayers();
  if (list.length < 2) {
    broadcastLobby();
    return;
  }

  const queue = [...list];
  const matches = [];

  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();

    const matchId = `match_${Date.now()}_${matches.length}`;
    const match = {
      id: matchId,
      playerA: a.id,
      playerB: b.id,
      round: 1,
      maxRounds: 3,
      aWins: 0,
      bWins: 0,
      state: "CHOOSING"
    };

    a.status = "MATCHED";
    b.status = "MATCHED";
    a.opponent = b.id;
    b.opponent = a.id;
    a.matchId = matchId;
    b.matchId = matchId;
    a.choice = null;
    b.choice = null;

    matches.push(match);
    activeMatches.set(matchId, match);
  }

  for (const p of queue) {
    p.status = "LOBBY";
    p.ready = false;
    const s = io.sockets.sockets.get(p.id);
    if (s) s.emit("byeMessage", "本轮轮空，请继续等待下一轮匹配。");
  }

  for (const m of matches) {
    const a = players.get(m.playerA);
    const b = players.get(m.playerB);

    if (a) {
      io.to(a.id).emit("matchStart", {
        matchId: m.id,
        opponent: b?.name || "未知",
        round: m.round,
        maxRounds: m.maxRounds
      });
    }

    if (b) {
      io.to(b.id).emit("matchStart", {
        matchId: m.id,
        opponent: a?.name || "未知",
        round: m.round,
        maxRounds: m.maxRounds
      });
    }
  }

  broadcastLobby();
}

function resolveRound(a, b) {
  if (a === b) return "DRAW";
  if (
    (a === "rock" && b === "scissors") ||
    (a === "scissors" && b === "paper") ||
    (a === "paper" && b === "rock")
  ) {
    return "A";
  }
  return "B";
}

function finishRound(match) {
  const a = players.get(match.playerA);
  const b = players.get(match.playerB);

  if (match.aWins >= 2 || match.bWins >= 2) {
    endMatch(match, a, b);
    return;
  }

  match.round++;
  match.state = "CHOOSING";
  if (a) a.choice = null;
  if (b) b.choice = null;

  io.to(match.playerA).emit("nextRound", {
    round: match.round,
    maxRounds: match.maxRounds
  });

  io.to(match.playerB).emit("nextRound", {
    round: match.round,
    maxRounds: match.maxRounds
  });
}

function endMatch(match, a, b) {
  activeMatches.delete(match.id);

  let winner, loser;
  if (match.aWins >= 2) {
    winner = a;
    loser = b;
  } else {
    winner = b;
    loser = a;
  }

  if (loser) {
    loser.status = "ELIMINATED";
    loser.opponent = null;
    loser.matchId = null;
    loser.choice = null;
    const s = io.sockets.sockets.get(loser.id);
    if (s) s.emit("eliminated");
  }

  if (winner) {
    winner.status = "LOBBY";
    winner.ready = false;
    winner.opponent = null;
    winner.matchId = null;
    winner.choice = null;
    winner.wins += 1;
    const s = io.sockets.sockets.get(winner.id);
    if (s) s.emit("backToLobby");
  }

  broadcastAlive();
  broadcastLobby();
}

function broadcastAlive() {
  const alive = alivePlayers();

  const spectators = [...players.values()].filter(
    p => p.status === "ELIMINATED"
  );

  for (const m of activeMatches.values()) {
    const a = players.get(m.playerA);
    const b = players.get(m.playerB);
    const data = {
      matchId: m.id,
      round: m.round,
      maxRounds: m.maxRounds,
      aName: a?.name || "玩家A",
      bName: b?.name || "玩家B",
      aWins: m.aWins,
      bWins: m.bWins,
      state: m.state
    };

    if (a) io.to(a.id).emit("spectatorUpdate", data);
    if (b) io.to(b.id).emit("spectatorUpdate", data);

    for (const sp of spectators) {
      const s = io.sockets.sockets.get(sp.id);
      if (s) s.emit("spectatorUpdate", data);
    }
  }

  if (alive.length === 1) {
    const winner = alive[0];
    winner.status = "FINISHED";

    io.emit("gameOver", { winner: winner.name });

    setTimeout(() => {
      io.emit("showStarrySky");
      setTimeout(() => {
        releaseAll();
      }, 6000);
    }, 3000);
  }
}

function releaseAll() {
  for (const p of players.values()) {
    const s = io.sockets.sockets.get(p.id);
    if (s) s.emit("logout");
  }
  players.clear();
  activeMatches.clear();
  clearTimeout(matchTimer);
  matchTimer = null;
}

io.on("connection", socket => {
  if (countActive() >= MAX_PLAYERS) {
    socket.emit("accessDenied", "未获取准入资格");
    return;
  }

  socket.on("createAccount", name => {
    if (countActive() >= MAX_PLAYERS) {
      socket.emit("accessDenied", "未获取准入资格");
      return;
    }

    const player = {
      id: socket.id,
      name: name || `玩家${socket.id.slice(0, 4)}`,
      status: "LOBBY",
      wins: 0,
      losses: 0,
      ready: false,
      opponent: null,
      matchId: null,
      choice: null
    };

    players.set(socket.id, player);
    socket.emit("accountCreated", player);
    broadcastLobby();
  });

  socket.on("setReady", () => {
    const p = players.get(socket.id);
    if (!p || p.status !== "LOBBY") return;
    p.ready = true;
    broadcastLobby();
    tryMatchIfNeeded();
  });

  socket.on("chatMessage", message => {
    const p = players.get(socket.id);
    if (!p || p.status !== "LOBBY") {
      socket.emit("chatError", "当前无法发言");
      return;
    }
    io.emit("chatMessage", {
      name: p.name,
      message,
      time: Date.now()
    });
  });

  socket.on("makeChoice", ({ matchId, choice }) => {
    const match = activeMatches.get(matchId);
    if (!match || match.state !== "CHOOSING") return;

    const player = players.get(socket.id);
    if (!player || player.matchId !== matchId) return;
    if (!["rock", "paper", "scissors"].includes(choice)) return;
    if (player.choice) return;

    player.choice = choice;

    const a = players.get(match.playerA);
    const b = players.get(match.playerB);

    if (!a || !b) return;
    if (!a.choice || !b.choice) return;

    match.state = "RESOLVING";

    const result = resolveRound(a.choice, b.choice);
    if (result === "A") match.aWins++;
    if (result === "B") match.bWins++;

    io.to(match.playerA).emit("roundResult", {
      round: match.round,
      myChoice: a.choice,
      opponentChoice: b.choice,
      result
    });

    io.to(match.playerB).emit("roundResult", {
      round: match.round,
      myChoice: b.choice,
      opponentChoice: a.choice,
      result: result === "A" ? "B" : result === "B" ? "A" : "DRAW"
    });

    setTimeout(() => finishRound(match), 2500);
  });

  socket.on("disconnect", () => {
    const p = players.get(socket.id);
    if (!p) return;

    if (p.matchId) {
      const match = activeMatches.get(p.matchId);
      if (match) {
        const otherId = match.playerA === p.id ? match.playerB : match.playerA;
        const other = players.get(otherId);
        if (other) {
          other.status = "LOBBY";
          other.ready = false;
          other.opponent = null;
          other.matchId = null;
          other.choice = null;
          const s = io.sockets.sockets.get(other.id);
          if (s) s.emit("backToLobby");
        }
        activeMatches.delete(match.id);
      }
    }

    players.delete(socket.id);
    broadcastLobby();
    broadcastAlive();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("服务启动:", PORT));