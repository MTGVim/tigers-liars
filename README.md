# Tiger's Table - Liars Game
<img width="971" height="835" alt="스크린샷 2026-02-14 오전 11 18 06" src="https://github.com/user-attachments/assets/2894a537-3add-4d4e-a467-201fcf24eaeb" />

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
