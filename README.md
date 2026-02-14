# Ace Table - Liars Game

Next.js + Tailwind frontend and WebSocket room server.

## Run

1. Install deps

```bash
yarn install
```

2. Start websocket server

```bash
yarn ws
```

3. Start frontend (new terminal)

```bash
yarn dev
```

4. Open `http://localhost:3000`

## Environment

- `NEXT_PUBLIC_WS_URL` (default local: `ws://127.0.0.1:3001`)
- `WS_PORT` (default: `3001`)
- `WS_HOST` (default: `127.0.0.1`)
