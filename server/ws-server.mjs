import { WebSocketServer } from 'ws';

const PORT = Number(process.env.WS_PORT ?? 3001);
const HOST = process.env.WS_HOST ?? '127.0.0.1';

const rooms = new Map();
const sockets = new Map();

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TABLE_RANKS = ['ACE', 'KING', 'QUEEN'];
const HAND_SIZE = 5;
const TURN_TIMER_SECONDS = 30;

const RANK_TO_CARD_NAMES = {
  ACE: ['Ace'],
  KING: ['King'],
  QUEEN: ['Queen'],
  JOKER: ['Joker'],
};

const CARD_RANK = {
  Ace: 'ACE',
  King: 'KING',
  Queen: 'QUEEN',
  Joker: 'JOKER',
};

function randomId(size = 10) {
  let out = '';
  for (let i = 0; i < size; i += 1) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle(arr) {
  const clone = [...arr];
  for (let i = clone.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone;
}

function uniqueRoomCode() {
  let code = randomId(6);
  while (rooms.has(code)) code = randomId(6);
  return code;
}

function send(ws, type, payload = {}) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type, payload }));
}

function isAlive(room, playerId) {
  return !room.game.eliminatedIds.includes(playerId);
}

function activePlayers(room) {
  return room.players.filter((p) => p.connected && isAlive(room, p.id));
}

function playersWithCards(room) {
  return activePlayers(room).filter((p) => (room.game.hands[p.id] ?? []).length > 0);
}

function createLiarDeck() {
  const out = [];
  const pushRank = (rank, count) => {
    for (let i = 0; i < count; i += 1) {
      out.push(pickOne(RANK_TO_CARD_NAMES[rank]));
    }
  };
  pushRank('ACE', 6);
  pushRank('KING', 6);
  pushRank('QUEEN', 6);
  pushRank('JOKER', 2);
  return shuffle(out);
}

function createRevolverDeck() {
  return shuffle(['EMPTY', 'EMPTY', 'EMPTY', 'EMPTY', 'EMPTY', 'BULLET']);
}

function drawRevolver(room) {
  if (!room.game.revolverDeck || room.game.revolverDeck.length === 0) {
    room.game.revolverDeck = createRevolverDeck();
  }
  return room.game.revolverDeck.pop();
}

function nextCounterClockwise(room, fromPlayerId, predicate) {
  const order = room.game.turnOrder;
  if (order.length === 0) return null;
  let idx = order.indexOf(fromPlayerId);
  if (idx < 0) idx = 0;

  for (let step = 1; step <= order.length; step += 1) {
    const next = order[(idx - step + order.length) % order.length];
    if (predicate(next)) return next;
  }
  return null;
}

function defaultPredicate(room) {
  const aliveSet = new Set(activePlayers(room).map((p) => p.id));
  return (pid) => aliveSet.has(pid);
}

function withCardsPredicate(room) {
  const ids = new Set(playersWithCards(room).map((p) => p.id));
  return (pid) => ids.has(pid);
}

function roomView(room) {
  return {
    id: room.id,
    hostId: room.hostId,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      handCount: room.game.hands[p.id]?.length ?? 0,
      eliminated: room.game.eliminatedIds.includes(p.id),
    })),
    chat: room.chat,
    game: {
      mode: 'liars_deck',
      status: room.game.status,
      phase: room.game.phase,
      round: room.game.round,
      tableRank: room.game.tableRank,
      currentTurnPlayerId: room.game.currentTurnPlayerId,
      mustCallLiar: room.game.mustCallLiar,
      turnDeadlineMs: room.game.turnDeadlineMs,
      turnTimerSeconds: TURN_TIMER_SECONDS,
      handSize: HAND_SIZE,
      pileCount: room.game.pileCount,
      revolverRemain: room.game.revolverDeck.length,
      revolverBulletRemain: room.game.revolverDeck.filter((c) => c === 'BULLET').length,
      lastPlay: room.game.lastPlay
        ? {
            playerId: room.game.lastPlay.playerId,
            count: room.game.lastPlay.cardNames.length,
            order: room.game.lastPlay.order,
          }
        : null,
      eliminatedIds: room.game.eliminatedIds,
      winnerId: room.game.winnerId,
    },
  };
}

function broadcastRoom(room, type, payload = {}) {
  for (const p of room.players) {
    const ws = sockets.get(p.id);
    if (!ws) continue;
    send(ws, type, payload);
  }
}

function pushSystem(room, text) {
  room.chat = [
    { id: randomId(8), type: 'system', text, senderName: 'SYSTEM', createdAt: Date.now() },
    ...room.chat,
  ].slice(0, 80);
  broadcastRoom(room, 'system_message', { text });
}

function syncRoom(room) {
  broadcastRoom(room, 'room_state', { room: roomView(room) });
}

function attachPlayerToSocket(ws, roomId, playerId) {
  ws.playerId = playerId;
  ws.roomId = roomId;
  sockets.set(playerId, ws);
}

function sendHand(room, playerId) {
  const ws = sockets.get(playerId);
  if (!ws) return;
  send(ws, 'hand_state', { cards: room.game.hands[playerId] ?? [] });
}

function sendHands(room) {
  for (const p of room.players.filter((x) => x.connected)) sendHand(room, p.id);
}

function checkWinner(room) {
  const alive = activePlayers(room);
  if (alive.length === 1) {
    room.game.status = 'finished';
    room.game.phase = 'finished';
    room.game.winnerId = alive[0].id;
    pushSystem(room, `${alive[0].name} 승리!`);
    return true;
  }
  return false;
}

function resolveStarter(room, preferredId) {
  const aliveSet = new Set(activePlayers(room).map((p) => p.id));
  if (preferredId && aliveSet.has(preferredId)) return preferredId;
  if (!preferredId) return activePlayers(room)[0]?.id ?? null;
  return nextCounterClockwise(room, preferredId, (pid) => aliveSet.has(pid));
}

function startRound(room, starterId) {
  const alive = activePlayers(room).map((p) => p.id);
  room.game.round += 1;
  room.game.tableRank = pickOne(TABLE_RANKS);
  room.game.lastPlay = null;
  room.game.pileCount = 0;
  room.game.mustCallLiar = false;

  const deck = createLiarDeck();
  const hands = {};
  for (const pid of alive) {
    hands[pid] = deck.splice(0, HAND_SIZE);
  }
  room.game.hands = hands;

  room.game.currentTurnPlayerId = resolveStarter(room, starterId);
  room.game.turnDeadlineMs = Date.now() + TURN_TIMER_SECONDS * 1000;
  sendHands(room);
}

function createRoom(ws, name) {
  const roomId = uniqueRoomCode();
  const playerId = randomId(8);

  const room = {
    id: roomId,
    hostId: playerId,
    players: [{ id: playerId, name, connected: true }],
    chat: [],
    game: {
      status: 'lobby',
      phase: 'lobby',
      round: 0,
      tableRank: null,
      turnOrder: [],
      currentTurnPlayerId: null,
      turnDeadlineMs: null,
      mustCallLiar: false,
      pileCount: 0,
      lastPlay: null,
      hands: {},
      revolverDeck: createRevolverDeck(),
      eliminatedIds: [],
      winnerId: null,
    },
  };

  rooms.set(roomId, room);
  attachPlayerToSocket(ws, roomId, playerId);
  send(ws, 'room_joined', { roomId, playerId });
  pushSystem(room, `${name} 님이 방을 만들었습니다.`);
  syncRoom(room);
}

function joinRoom(ws, roomId, name) {
  const room = rooms.get(roomId);
  if (!room) return send(ws, 'error', { message: 'Room not found' });
  if (room.game.status !== 'lobby') return send(ws, 'error', { message: 'Game in progress' });
  if (room.players.length >= 4) return send(ws, 'error', { message: 'Room is full (max 4)' });

  const playerId = randomId(8);
  room.players.push({ id: playerId, name, connected: true });
  attachPlayerToSocket(ws, roomId, playerId);

  send(ws, 'room_joined', { roomId, playerId });
  pushSystem(room, `${name} 님이 참가했습니다.`);
  syncRoom(room);
}

function startGame(ws) {
  const room = rooms.get(ws.roomId);
  if (!room) return;
  if (room.hostId !== ws.playerId) return send(ws, 'error', { message: 'Host only' });

  const alive = room.players.filter((p) => p.connected);
  if (alive.length < 2) return send(ws, 'error', { message: 'Need at least 2 players' });

  room.game.status = 'playing';
  room.game.phase = 'turn';
  room.game.turnOrder = alive.map((p) => p.id);
  room.game.eliminatedIds = [];
  room.game.winnerId = null;
  room.game.revolverDeck = createRevolverDeck();

  startRound(room, room.game.turnOrder[0]);
  pushSystem(room, `Round ${room.game.round} 시작 · 테이블 랭크 ${room.game.tableRank}`);
  syncRoom(room);
}

function removeCardsFromHand(hand, picked) {
  const clone = [...hand];
  for (const card of picked) {
    const idx = clone.indexOf(card);
    if (idx === -1) return null;
    clone.splice(idx, 1);
  }
  return clone;
}

function submitCard(ws, cardNames) {
  const room = rooms.get(ws.roomId);
  if (!room) return;

  if (room.game.phase !== 'turn') return send(ws, 'error', { message: 'Not turn phase' });
  if (room.game.currentTurnPlayerId !== ws.playerId) return send(ws, 'error', { message: 'Not your turn' });
  if (room.game.mustCallLiar) return send(ws, 'error', { message: 'You must call LIAR now' });
  if (!Array.isArray(cardNames)) return send(ws, 'error', { message: 'cardNames must be array' });
  if (cardNames.length < 1 || cardNames.length > 3) return send(ws, 'error', { message: 'Play 1~3 cards' });

  const hand = room.game.hands[ws.playerId] ?? [];
  const nextHand = removeCardsFromHand(hand, cardNames);
  if (!nextHand) return send(ws, 'error', { message: 'Card not in hand' });

  room.game.hands[ws.playerId] = nextHand;
  room.game.pileCount += cardNames.length;
  room.game.lastPlay = {
    playerId: ws.playerId,
    cardNames,
    order: room.game.pileCount,
  };

  sendHand(room, ws.playerId);

  const holders = playersWithCards(room).map((p) => p.id);
  if (holders.length === 1) {
    room.game.currentTurnPlayerId = holders[0];
    room.game.mustCallLiar = true;
    room.game.turnDeadlineMs = Date.now() + TURN_TIMER_SECONDS * 1000;
    pushSystem(room, `남은 손패 1명. ${room.players.find((p) => p.id === holders[0])?.name} 님은 LIAR를 호출해야 합니다.`);
    syncRoom(room);
    return;
  }

  if (holders.length === 0) {
    const starter = nextCounterClockwise(room, ws.playerId, defaultPredicate(room));
    startRound(room, starter);
    pushSystem(room, `카드 소진으로 새 라운드 시작 · 테이블 랭크 ${room.game.tableRank}`);
    syncRoom(room);
    return;
  }

  room.game.mustCallLiar = false;
  room.game.currentTurnPlayerId = nextCounterClockwise(room, ws.playerId, withCardsPredicate(room));
  room.game.turnDeadlineMs = Date.now() + TURN_TIMER_SECONDS * 1000;
  syncRoom(room);
}

function resolveLiar(room, callerId, reason = 'manual') {
  const accusedId = room.game.lastPlay.playerId;
  const cards = room.game.lastPlay.cardNames;
  const truthful = cards.every((name) => {
    const rank = CARD_RANK[name] ?? 'UNKNOWN';
    return rank === room.game.tableRank || rank === 'JOKER';
  });

  const penalizedPlayerId = truthful ? ws.playerId : accusedId;
  const chamber = drawRevolver(room);
  const fatal = chamber === 'BULLET';
  let eliminatedId = null;

  if (fatal && !room.game.eliminatedIds.includes(penalizedPlayerId)) {
    room.game.eliminatedIds.push(penalizedPlayerId);
    eliminatedId = penalizedPlayerId;
  }

  broadcastRoom(room, 'challenge_result', {
    callerId,
    accusedId,
    tableRank: room.game.tableRank,
    revealedCardNames: cards,
    truthful,
    penalizedPlayerId,
    fatal,
    eliminatedId,
    reason,
  });

  if (checkWinner(room)) {
    syncRoom(room);
    return;
  }

  const starter = resolveStarter(room, penalizedPlayerId);
  startRound(room, starter);
  pushSystem(room, `LIAR 판정 완료. 새 라운드 시작 · 테이블 랭크 ${room.game.tableRank}`);
  syncRoom(room);
}

function callLiar(ws) {
  const room = rooms.get(ws.roomId);
  if (!room) return;

  if (room.game.phase !== 'turn') return send(ws, 'error', { message: 'Not turn phase' });
  if (room.game.currentTurnPlayerId !== ws.playerId) return send(ws, 'error', { message: 'Not your turn' });
  if (!room.game.lastPlay) return send(ws, 'error', { message: 'No previous play' });
  if (room.game.lastPlay.playerId === ws.playerId) return send(ws, 'error', { message: 'Cannot call LIAR on your own play' });

  resolveLiar(room, ws.playerId, 'manual');
}

function handleTurnTimeout(room) {
  if (room.game.status !== 'playing' || room.game.phase !== 'turn') return;
  if (!room.game.turnDeadlineMs || Date.now() < room.game.turnDeadlineMs) return;

  const currentId = room.game.currentTurnPlayerId;
  if (!currentId) return;
  const currentName = room.players.find((p) => p.id === currentId)?.name ?? currentId;

  if (room.game.mustCallLiar && room.game.lastPlay) {
    pushSystem(room, `시간초과: ${currentName} 자동 LIAR 호출`);
    resolveLiar(room, currentId, 'timeout_auto_liar');
    return;
  }

  const chamber = drawRevolver(room);
  const fatal = chamber === 'BULLET';
  let eliminatedId = null;
  if (fatal && !room.game.eliminatedIds.includes(currentId)) {
    room.game.eliminatedIds.push(currentId);
    eliminatedId = currentId;
  }

  broadcastRoom(room, 'penalty_result', {
    reason: 'turn_timeout',
    playerId: currentId,
    fatal,
    eliminatedId,
  });

  if (checkWinner(room)) {
    syncRoom(room);
    return;
  }

  const holders = playersWithCards(room).map((p) => p.id);
  if (holders.length === 0) {
    const starter = nextCounterClockwise(room, currentId, defaultPredicate(room));
    startRound(room, starter);
    pushSystem(room, `턴 시간초과 처리 후 새 라운드 시작 · 테이블 랭크 ${room.game.tableRank}`);
    syncRoom(room);
    return;
  }

  if (holders.length === 1) {
    room.game.currentTurnPlayerId = holders[0];
    room.game.mustCallLiar = true;
    room.game.turnDeadlineMs = Date.now() + TURN_TIMER_SECONDS * 1000;
    pushSystem(room, `시간초과 처리 후 남은 손패 1명: ${room.players.find((p) => p.id === holders[0])?.name} 님은 LIAR를 호출해야 합니다.`);
    syncRoom(room);
    return;
  }

  room.game.currentTurnPlayerId = nextCounterClockwise(room, currentId, withCardsPredicate(room));
  room.game.mustCallLiar = false;
  room.game.turnDeadlineMs = Date.now() + TURN_TIMER_SECONDS * 1000;
  pushSystem(room, `시간초과: ${currentName} 패널티 처리, 다음 턴 진행`);
  syncRoom(room);
}

function sendChat(ws, text) {
  const room = rooms.get(ws.roomId);
  if (!room) return;

  const sender = room.players.find((p) => p.id === ws.playerId);
  const msg = String(text ?? '').trim();
  if (!msg) return;

  room.chat = [
    {
      id: randomId(8),
      type: 'chat',
      text: msg.slice(0, 200),
      senderName: sender?.name ?? 'Unknown',
      senderId: ws.playerId,
      createdAt: Date.now(),
    },
    ...room.chat,
  ].slice(0, 80);

  syncRoom(room);
}

function handleDisconnect(ws) {
  const roomId = ws.roomId;
  const playerId = ws.playerId;
  if (!roomId || !playerId) return;
  sockets.delete(playerId);

  const room = rooms.get(roomId);
  if (!room) return;

  const player = room.players.find((p) => p.id === playerId);
  if (player) player.connected = false;

  if (room.players.every((p) => !p.connected)) {
    rooms.delete(roomId);
    return;
  }

  if (room.hostId === playerId) {
    const nextHost = room.players.find((p) => p.connected);
    if (nextHost) room.hostId = nextHost.id;
  }

  if (room.game.status === 'playing' && !room.game.eliminatedIds.includes(playerId)) {
    room.game.eliminatedIds.push(playerId);
  }

  if (room.game.currentTurnPlayerId === playerId) {
    room.game.currentTurnPlayerId = nextCounterClockwise(room, playerId, defaultPredicate(room));
    room.game.turnDeadlineMs = Date.now() + TURN_TIMER_SECONDS * 1000;
  }

  if (room.game.status === 'playing' && checkWinner(room)) {
    syncRoom(room);
    return;
  }

  pushSystem(room, `${player?.name ?? 'Unknown'} 님 연결이 종료되었습니다.`);
  syncRoom(room);
}

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on('error', (err) => {
  console.error(`WebSocket server failed: ${err.message}`);
  process.exit(1);
});

wss.on('connection', (ws) => {
  send(ws, 'system_message', { text: '서버에 연결되었습니다.' });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      const type = msg?.type;
      const payload = msg?.payload ?? {};

      if (type === 'create_room') return createRoom(ws, String(payload.name ?? 'Guest').slice(0, 24));
      if (type === 'join_room') return joinRoom(ws, String(payload.roomId ?? '').toUpperCase(), String(payload.name ?? 'Guest').slice(0, 24));

      if (!ws.roomId || !ws.playerId) return send(ws, 'error', { message: 'Join a room first' });
      if (type === 'start_game') return startGame(ws);
      if (type === 'submit_card') return submitCard(ws, payload.cardNames ?? []);
      if (type === 'challenge_last_play') return callLiar(ws);
      if (type === 'chat_message') return sendChat(ws, payload.text);

      return send(ws, 'error', { message: `Unknown message type: ${type}` });
    } catch (err) {
      return send(ws, 'error', { message: `Bad request: ${err.message}` });
    }
  });

  ws.on('close', () => handleDisconnect(ws));
});

setInterval(() => {
  for (const room of rooms.values()) {
    try {
      handleTurnTimeout(room);
    } catch (err) {
      console.error(`Timeout handler error in room ${room.id}: ${err.message}`);
    }
  }
}, 1000);

console.log(`WebSocket server running on ws://${HOST}:${PORT}`);
