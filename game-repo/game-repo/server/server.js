const express = require('express');
const http = require('http');
const { Server } from require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '../public')));

let waitingPlayers = [];
let matches = {};

function getLobbyPlayers() {
  return Object.values(io.sockets.sockets)
    .filter(s => s.state === 'lobby' || s.state === 'waiting')
    .map(s => ({ nickname: s.nickname, state: s.state }));
}

function getMoveName(move) {
  return move || '';
}

io.on('connection', (socket) => {
  
  // 玩家进入大厅
  socket.on('join', (nickname) => {
    socket.nickname = nickname;
    socket.roomCode = null;
    socket.state = 'lobby';
    io.emit('updatePlayers', getLobbyPlayers());
  });

  // 请求匹配
  socket.on('requestMatch', () => {
    if (socket.state === 'fighting' || socket.state === 'spectator') return;

    if (waitingPlayers.length > 0) {
      const opponent = waitingPlayers.pop();
      const roomCode = 'match-' + Date.now();

      matches[roomCode] = {
        player1: socket.id,
        player2: opponent.id,
        p1Nickname: socket.nickname,
        p2Nickname: opponent.nickname,
        state: 'fighting',
        round: 0,
        p1Wins: 0,
        p2Wins: 0,
        log: []
      };

      socket.join(roomCode);
      opponent.join(roomCode);
      socket.roomCode = roomCode;
      opponent.roomCode = roomCode;
      socket.state = 'fighting';
      opponent.state = 'fighting';

      io.to(roomCode).emit('matchStart', {
        p1: socket.nickname,
        p2: opponent.nickname,
        round: 1
      });
      
      io.emit('updatePlayers', getLobbyPlayers());
    } else {
      waitingPlayers.push(socket);
      socket.state = 'waiting';
      io.emit('updatePlayers', getLobbyPlayers());
    }
  });

  // 玩家出拳 (严格按照固定3局修改)
  socket.on('makeMove', (move) => {
    if (!socket.roomCode || !matches[socket.roomCode]) return;
    
    const match = matches[socket.roomCode];
    if (match.state !== 'fighting') return;

    if (socket.id === match.player1) match.p1Move = move;
    else if (socket.id === match.player2) match.p2Move = move;

    // 双方都出拳
    if (match.p1Move && match.p2Move) {
      const p1 = match.p1Move;
      const p2 = match.p2Move;
      match.round++; // 每出一拳，局数+1

      let resultText = '';
      if (p1 === p2) {
        resultText = '平局';
        match.log.push(`第${match.round}局 你: ${getMoveName(p1)} 对手: ${getMoveName(p2)} | 平局`);
      } else if (
        (p1 === '石头' && p2 === '剪刀') ||
        (p1 === '剪刀' && p2 === '布') ||
        (p1 === '布' && p2 === '石头')
      ) {
        match.p1Wins++;
        resultText = `${match.p1Nickname} 胜`;
        match.log.push(`第${match.round}局 ${match.p1Nickname}: ${getMoveName(p1)} ${match.p2Nickname}: ${getMoveName(p2)} | ${match.p1Nickname} 胜`);
      } else {
        match.p2Wins++;
        resultText = `${match.p2Nickname} 胜`;
        match.log.push(`第${match.round}局 ${match.p1Nickname}: ${getMoveName(p1)} ${match.p2Nickname}: ${getMoveName(p2)} | ${match.p2Nickname} 胜`);
      }

      // 发送本局结果
      io.to(socket.roomCode).emit('roundResult', {
        round: match.round,
        result: resultText,
        log: match.log,
        p1Wins: match.p1Wins,
        p2Wins: match.p2Wins
      });

      // 【核心修改】如果打满了3局，强制结束比赛
      if (match.round >= 3) {
        match.state = 'finished';
        let winner = '平局，无人淘汰';
        if (match.p1Wins >= 2) {
          winner = match.p1Nickname;
        } else if (match.p2Wins >= 2) {
          winner = match.p2Nickname;
        }
        
        // 通知双方比赛结束并返回聊天大厅
        io.to(socket.roomCode).emit('gameOver', { winner: winner, log: match.log });
        
        // 清理房间数据，并将两人状态改为大厅
        delete matches[socket.roomCode];
        socket.leave(socket.roomCode);
        socket.roomCode = null;
        socket.state = 'lobby';
        
        let opponentSocket = io.sockets.sockets.get(socket.id === match.player1 ? match.player2 : match.player1);
        if (opponentSocket) {
          opponentSocket.leave(socket.roomCode);
          opponentSocket.roomCode = null;
          opponentSocket.state = 'lobby';
        }

        // 重新广播大厅人员
        io.emit('updatePlayers', getLobbyPlayers());
      } else {
        // 没到3局，重置出拳准备下一局
        delete match.p1Move;
        delete match.p2Move;
      }
    }
  });

  // 聊天
  socket.on('chatMessage', (msg) => {
    if (socket.state === 'fighting' && socket.roomCode) {
      io.to(socket.roomCode).emit('chatMessage', { user: socket.nickname, text: msg, type: 'private' });
    } else {
      io.emit('chatMessage', { user: socket.nickname, text: msg, type: 'chat' });
    }
  });

  // 玩家断开
  socket.on('disconnect', () => {
    waitingPlayers = waitingPlayers.filter(p => p.id !== socket.id);
    if (socket.roomCode && matches[socket.roomCode]) {
      delete matches[socket.roomCode];
      socket.leave(socket.roomCode);
      io.emit('updatePlayers', getLobbyPlayers());
    }
    io.emit('updatePlayers', getLobbyPlayers());
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`服务已启动，端口: ${PORT}`));