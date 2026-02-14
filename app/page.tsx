'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type Player = { id: string; name: string; connected: boolean; handCount?: number; eliminated?: boolean };
type ChatItem = { id: string; type: 'chat' | 'system'; text: string; senderName: string; senderId?: string; createdAt: number };
type LastPlay = { playerId: string; count: number; order: number } | null;

type RoomState = {
  id: string;
  hostId: string;
  players: Player[];
  chat: ChatItem[];
  game: {
    mode: 'liars_deck';
    status: 'lobby' | 'playing' | 'finished';
    phase: 'lobby' | 'turn' | 'finished';
    round: number;
    tableRank: 'ACE' | 'KING' | 'QUEEN' | null;
    currentTurnPlayerId: string | null;
    mustCallLiar: boolean;
    turnDeadlineMs: number | null;
    turnTimerSeconds: number;
    handSize: number;
    pileCount: number;
    revolverRemain: number;
    revolverBulletRemain: number;
    lastPlay: LastPlay;
    eliminatedIds: string[];
    winnerId: string | null;
  };
};

type ChallengeResult = {
  callerId: string;
  accusedId: string;
  tableRank: 'ACE' | 'KING' | 'QUEEN';
  revealedCardNames: string[];
  truthful: boolean;
  penalizedPlayerId: string;
  fatal: boolean;
  eliminatedId: string | null;
  reason?: string;
};

type PenaltyResult = {
  reason: 'turn_timeout';
  playerId: string;
  fatal: boolean;
  eliminatedId: string | null;
};

const WS_URL_FROM_ENV = process.env.NEXT_PUBLIC_WS_URL;
const CARD_KIND_BY_NAME: Record<string, 'ACE' | 'KING' | 'QUEEN' | 'JOKER'> = {
  Ace: 'ACE',
  King: 'KING',
  Queen: 'QUEEN',
  Joker: 'JOKER',
};

const ADJECTIVES = ['날카로운', '은밀한', '대담한', '고요한', '불타는', '재빠른', '묵직한', '차가운', '유쾌한', '사나운'];
const NOUNS = ['여우', '늑대', '까마귀', '사자', '호랑이', '포커왕', '딜러', '조커', '카드마술사', '도박사'];

function randomNick() {
  return `${ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]}${NOUNS[Math.floor(Math.random() * NOUNS.length)]}`;
}

export default function Home() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [wsUrl, setWsUrl] = useState<string>(WS_URL_FROM_ENV ?? '');
  const [joinCode, setJoinCode] = useState('');
  const [myCards, setMyCards] = useState<string[]>([]);
  const [chatText, setChatText] = useState('');
  const [systemLogs, setSystemLogs] = useState<string[]>([]);
  const [challengeResult, setChallengeResult] = useState<ChallengeResult | null>(null);
  const [penaltyResult, setPenaltyResult] = useState<PenaltyResult | null>(null);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [handTab, setHandTab] = useState<'ALL' | 'ACE' | 'KING' | 'QUEEN'>('ALL');
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);

  const isHost = room?.hostId === playerId;
  const myTurn = room?.game.currentTurnPlayerId === playerId;
  const mustCallLiar = Boolean(room?.game.mustCallLiar);
  const canChallenge = Boolean(myTurn && room?.game.lastPlay && room.game.lastPlay.playerId !== playerId);

  const playersById = useMemo(() => {
    const map = new Map<string, Player>();
    for (const p of room?.players ?? []) map.set(p.id, p);
    return map;
  }, [room?.players]);

  const visibleCards = useMemo(() => {
    return myCards
      .map((cardName, idx) => ({ cardName, idx }))
      .filter((item) => {
        if (handTab === 'ALL') return true;
        return (CARD_KIND_BY_NAME[item.cardName] ?? 'UNKNOWN') === handTab;
      });
  }, [myCards, handTab]);

  function pushLog(text: string) {
    setSystemLogs((prev) => [text, ...prev].slice(0, 30));
  }

  function send(type: string, payload: Record<string, unknown>) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      pushLog('WebSocket 연결 대기 중입니다. 잠시 후 다시 시도하세요.');
      setToast({ text: '서버 연결 대기 중', type: 'error' });
      return false;
    }
    ws.send(JSON.stringify({ type, payload }));
    return true;
  }

  useEffect(() => {
    if (!displayName) setDisplayName(randomNick());
  }, [displayName]);

  useEffect(() => {
    if (WS_URL_FROM_ENV) {
      setWsUrl(WS_URL_FROM_ENV);
      return;
    }
    const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (isLocalhost) {
      setWsUrl('ws://127.0.0.1:3001');
      return;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    setWsUrl(`${protocol}://${window.location.hostname}:3001`);
  }, []);

  useEffect(() => {
    if (!wsUrl) return;
    let active = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        if (!active) return;
        setConnected(true);
        setToast({ text: '서버 연결됨', type: 'success' });
      });

      ws.addEventListener('close', () => {
        if (!active) return;
        setConnected(false);
        setToast({ text: '서버 연결 끊김. 재시도 중', type: 'error' });
        reconnectTimer = setTimeout(connect, 1000);
      });

      ws.addEventListener('error', () => {
        if (!active) return;
        setConnected(false);
      });

      ws.addEventListener('message', (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.type === 'room_joined') {
          setPlayerId(msg.payload.playerId);
          pushLog(`Room ${msg.payload.roomId} joined`);
        }
        if (msg.type === 'room_state') setRoom(msg.payload.room);
        if (msg.type === 'hand_state') setMyCards(msg.payload.cards ?? []);
        if (msg.type === 'challenge_result') setChallengeResult(msg.payload);
        if (msg.type === 'penalty_result') setPenaltyResult(msg.payload);
        if (msg.type === 'system_message') pushLog(msg.payload.text);
        if (msg.type === 'error') pushLog(`Error: ${msg.payload.message}`);
      });
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [wsUrl]);

  useEffect(() => {
    setSelectedCards([]);
  }, [myCards.join('|')]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const update = () => setIsNarrowViewport(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  function onCreateRoom(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim()) return;
    send('create_room', { name: displayName.trim() });
  }

  function onJoinRoom(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim() || !joinCode.trim()) return;
    send('join_room', { name: displayName.trim(), roomId: joinCode.trim().toUpperCase() });
  }

  function onStartGame() {
    send('start_game', {});
    setChallengeResult(null);
  }

  function toggleCard(cardName: string, index: number) {
    const token = `${cardName}::${index}`;
    setSelectedCards((prev) => {
      if (prev.includes(token)) return prev.filter((x) => x !== token);
      if (prev.length >= 3) return prev;
      return [...prev, token];
    });
  }

  function submitSelectedCards() {
    const cardNames = selectedCards.map((x) => x.split('::')[0]);
    if (cardNames.length < 1 || cardNames.length > 3) return;
    send('submit_card', { cardNames });
    setSelectedCards([]);
  }

  function onChallenge() {
    send('challenge_last_play', {});
  }

  function onSendChat(e: FormEvent) {
    e.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    send('chat_message', { text });
    setChatText('');
  }

  async function copyRoomCode() {
    if (!room?.id) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(room.id);
        pushLog(`Room code copied: ${room.id}`);
        setToast({ text: '방번호 복사 완료', type: 'success' });
        return;
      }

      const textarea = document.createElement('textarea');
      textarea.value = room.id;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);

      if (ok) {
        pushLog(`Room code copied: ${room.id}`);
        setToast({ text: '방번호 복사 완료', type: 'success' });
      } else {
        pushLog(`Copy failed. Room code: ${room.id}`);
        setToast({ text: '복사 실패', type: 'error' });
      }
    } catch {
      pushLog(`Copy failed. Room code: ${room.id}`);
      setToast({ text: '복사 실패', type: 'error' });
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-6 md:px-8">
      {toast && (
        <div
          className={`fixed right-4 top-4 z-50 rounded-lg px-4 py-2 text-sm font-semibold shadow-lg ${
            toast.type === 'success' ? 'bg-emerald-500 text-black' : 'bg-red-600 text-white'
          }`}
        >
          {toast.text}
        </div>
      )}

      <section className="glass rounded-2xl p-5">
        <h1 className="text-3xl text-amber-100 md:text-4xl">Tiger&apos;s Table: Liar&apos;s Deck</h1>
        <p className="mt-2 text-sm text-amber-200/80">상태: {connected ? 'connected' : 'connecting...'} | 서버: {wsUrl}</p>
      </section>

      {!room && (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="glass rounded-2xl p-5 md:col-span-2">
            <h2 className="text-xl text-amber-100">닉네임</h2>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-3 w-full rounded-lg border border-amber-300/40 bg-black/30 px-3 py-2" placeholder="닉네임" />
          </div>

          <form className="glass rounded-2xl p-5" onSubmit={onCreateRoom}>
            <h2 className="text-xl text-amber-100">방 만들기</h2>
            <button disabled={!displayName.trim()} className="mt-3 rounded-lg bg-amber-600 px-4 py-2 font-semibold text-black disabled:opacity-40">Create</button>
          </form>

          <form className="glass rounded-2xl p-5" onSubmit={onJoinRoom}>
            <h2 className="text-xl text-amber-100">방 참가</h2>
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} className="mt-3 w-full rounded-lg border border-amber-300/40 bg-black/30 px-3 py-2 uppercase" placeholder="ROOM CODE" />
            <button disabled={!displayName.trim() || !joinCode.trim()} className="mt-3 rounded-lg bg-orange-700 px-4 py-2 font-semibold disabled:opacity-40">Join</button>
          </form>
        </section>
      )}

      {room && (
        <section className="flex flex-col gap-4">
          <div className="glass rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-2xl text-amber-100">Table {room.id}</h2>
              <div className="flex items-center gap-2">
                <p className="text-sm text-amber-200/80">Round {room.game.round} · Table Rank: {room.game.tableRank ?? '-'}</p>
                <button onClick={copyRoomCode} className="rounded-md bg-amber-600 px-2 py-1 text-xs font-semibold text-black">코드 복사</button>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {room.players.map((p) => (
                <div
                  key={p.id}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    room.game.winnerId === p.id
                      ? 'border-emerald-300 bg-emerald-900/30 ring-1 ring-emerald-300/70'
                      : room.game.currentTurnPlayerId === p.id
                        ? 'border-amber-300 bg-amber-900/25 ring-1 ring-amber-300/60'
                        : 'border-amber-400/20 bg-black/20'
                  }`}
                >
                  <p>{p.name} {p.id === playerId ? '(You)' : ''}</p>
                  <p className="text-amber-200/75">Hand: {p.handCount ?? 0} · {p.eliminated ? 'ELIMINATED' : 'ALIVE'}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-xl border border-amber-400/30 bg-black/25 p-4">
              <p className="text-sm text-amber-200/80">현재 턴: {playersById.get(room.game.currentTurnPlayerId ?? '')?.name ?? '-'}</p>
              <p className="text-sm text-amber-200/80">초기 손패: {room.game.handSize}장 · 리볼버 남은 카드: {room.game.revolverRemain} · 남은 총알: {room.game.revolverBulletRemain}</p>
              <p className="text-sm text-amber-200/80">테이블 누적 카드 수: {room.game.pileCount}</p>
              <p className="text-sm text-amber-200/80">최근 플레이: {room.game.lastPlay ? `${playersById.get(room.game.lastPlay.playerId)?.name ?? '-'} · ${room.game.lastPlay.count}장` : '-'}</p>
              <p className="text-sm text-amber-200/80">턴 제한: {room.game.turnTimerSeconds}초</p>
              {room.game.mustCallLiar && <p className="mt-1 text-sm font-semibold text-red-300">현재 플레이어는 LIAR 호출만 가능합니다.</p>}
              {isHost && room.game.status !== 'playing' && <button onClick={onStartGame} className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-black">Start Game</button>}
            </div>

            {challengeResult && (
              <div className="mt-5 rounded-xl border border-orange-300/30 bg-black/25 p-4 text-sm">
                <p>LIAR 판정: {challengeResult.truthful ? '진실 플레이(호출자 패널티)' : '거짓 플레이(피고 패널티)'}</p>
                <p>공개 카드: {challengeResult.revealedCardNames.join(', ')} · Table Rank: {challengeResult.tableRank}</p>
                <p>패널티 대상: {playersById.get(challengeResult.penalizedPlayerId)?.name ?? challengeResult.penalizedPlayerId}</p>
                <p>러시안 룰렛: {challengeResult.fatal ? '치명탄(탈락)' : '공포탄(생존)'}</p>
              </div>
            )}

            {penaltyResult && (
              <div className="mt-3 rounded-xl border border-red-300/30 bg-black/25 p-4 text-sm">
                <p>시간초과 패널티: {playersById.get(penaltyResult.playerId)?.name ?? penaltyResult.playerId}</p>
                <p>러시안 룰렛: {penaltyResult.fatal ? '치명탄(탈락)' : '공포탄(생존)'}</p>
              </div>
            )}

            <div className="mt-5 rounded-xl border border-amber-400/30 bg-black/25 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg text-amber-100">내 손패 (세로 카드)</h3>
                {canChallenge && <button onClick={onChallenge} className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold">LIAR 호출</button>}
              </div>
              <div className="mt-2 text-xs text-amber-200/70">선택 카드: {selectedCards.length} / 3</div>
              <div className="mt-2 flex gap-2">
                {(['ALL', 'ACE', 'KING', 'QUEEN'] as const).map((tab) => (
                  <button key={tab} onClick={() => setHandTab(tab)} className={`rounded-md px-3 py-1 text-xs font-semibold ${handTab === tab ? 'bg-amber-500 text-black' : 'bg-black/40 text-amber-100'}`}>
                    {tab === 'ALL' ? '전체' : tab}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex items-end overflow-x-hidden pb-2">
                {visibleCards.map(({ cardName, idx }) => (
                  <button
                    key={`${cardName}-${idx}`}
                    onClick={() => toggleCard(cardName, idx)}
                    disabled={!myTurn || room.game.status !== 'playing' || mustCallLiar}
                    style={{
                      marginLeft: idx === 0 ? 0 : isNarrowViewport ? -28 : 0,
                      zIndex: idx + 1,
                    }}
                    className="relative h-36 w-24 shrink-0 rounded-lg text-left transition-transform hover:-translate-y-1 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <div
                      className={`relative h-36 w-24 overflow-hidden rounded-lg ${
                        selectedCards.includes(`${cardName}::${idx}`) ? 'ring-2 ring-inset ring-amber-300' : ''
                      }`}
                    >
                      <img
                        src={`/cards/${cardName}.png`}
                        alt={cardName}
                        className="pointer-events-none absolute left-1/2 top-1/2 h-36 w-24 -translate-x-1/2 -translate-y-1/2 object-contain"
                      />
                    </div>
                  </button>
                ))}
                {visibleCards.length === 0 && <p className="text-sm text-amber-200/70">해당 탭에 카드 없음</p>}
              </div>

              <button onClick={submitSelectedCards} disabled={!myTurn || selectedCards.length === 0 || room.game.status !== 'playing' || mustCallLiar} className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40">
                선택 카드 내기 ({selectedCards.length})
              </button>
            </div>

            {room.game.winnerId && (
              <div className="mt-5 rounded-xl border border-emerald-300/40 bg-emerald-900/20 p-4">
                <p className="font-semibold text-emerald-200">우승: {playersById.get(room.game.winnerId)?.name ?? room.game.winnerId}</p>
                {isHost && <p className="mt-1 text-xs text-emerald-200/80">호스트는 Start Game 버튼으로 새 게임을 시작할 수 있습니다.</p>}
              </div>
            )}
          </div>

          <aside className="grid gap-4 md:grid-cols-2">
            <section className="glass rounded-2xl p-5">
              <h3 className="text-xl text-amber-100">채팅방</h3>
              <form onSubmit={onSendChat} className="mt-3 flex gap-2">
                <input value={chatText} onChange={(e) => setChatText(e.target.value)} className="w-full rounded-lg border border-amber-300/40 bg-black/30 px-3 py-2" placeholder="메시지 입력" />
                <button className="rounded-lg bg-amber-600 px-3 py-2 font-semibold text-black">전송</button>
              </form>
              <div className="mt-3 max-h-[280px] space-y-2 overflow-auto">
                {(room.chat ?? []).map((m) => (
                  <div key={m.id} className="rounded border border-amber-300/20 bg-black/20 px-3 py-2 text-sm">
                    <p className="text-xs text-amber-200/70">{m.senderName}</p>
                    <p>{m.text}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="glass rounded-2xl p-5">
              <h3 className="text-xl text-amber-100">시스템 로그</h3>
              <div className="mt-3 max-h-[220px] space-y-2 overflow-auto">
                {systemLogs.map((m, i) => (
                  <p key={`${m}-${i}`} className="rounded border border-amber-300/20 bg-black/20 px-3 py-2 text-sm">{m}</p>
                ))}
              </div>
            </section>
          </aside>
        </section>
      )}
    </main>
  );
}
