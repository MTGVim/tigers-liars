# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js App Router frontend.
  - `app/page.tsx` is the main game UI (room, card play, vote, chat panels).
  - `app/layout.tsx`, `app/globals.css` define global layout and styling.
- `server/`: standalone WebSocket backend.
  - `server/ws-server.mjs` manages room lifecycle, turn flow, card submission, voting, and chat.
- `public/cards/`: runtime card assets served by Next.js (`/cards/<name>.png`).
- Config: `next.config.mjs`, `tailwind.config.ts`, `postcss.config.js`, `tsconfig.json`.

## Build, Test, and Development Commands
- `yarn install`: install dependencies and sync `yarn.lock`.
- `yarn ws`: run WebSocket server (defaults to `127.0.0.1:3001`).
- `yarn dev`: run frontend in development mode.
- `yarn build`: production build check for frontend.
- `yarn start`: run production frontend after build.

Example local run:
1. `yarn ws`
2. `NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3001 yarn dev`

## Coding Style & Naming Conventions
- Language: TypeScript/TSX for frontend, ESM JavaScript (`.mjs`) for WS server.
- Indentation: 2 spaces; semicolons required.
- Naming:
  - React components/types: `PascalCase`.
  - variables/functions: `camelCase`.
  - constants: `UPPER_SNAKE_CASE`.
- Keep game protocol event names explicit and stable (`create_room`, `submit_card`, `chat_message`, etc.).

## Testing Guidelines
- No automated test suite is configured yet.
- Minimum validation before PR:
  - `yarn build` passes.
  - Manual multiplayer smoke test with 2+ clients for: create/join room, start game, card turns, vote, and chat.
- When adding tests, colocate near feature files with `*.test.ts` or `*.test.tsx` naming.

## Commit & Pull Request Guidelines
- Follow Conventional Commit style seen in history (`docs: ...`, `feat: ...`, `fix: ...`).
- Keep commits focused by layer (`app/*` vs `server/*`), and explain protocol changes clearly.
- PRs should include:
  - summary of gameplay/backend behavior changes,
  - any env/config updates,
  - screenshots or short clips for UI changes,
  - manual test notes (what flows were verified).

## Security & Configuration Tips
- Do not commit secrets. Use env vars (`NEXT_PUBLIC_WS_URL`, `WS_HOST`, `WS_PORT`).
- Validate all incoming WS payloads defensively and avoid trusting client state.
