# Little by Little

A focused multiplication practice app with shared player scores and a global mistake-weighted question pool. Start with facts through 5, then move up to 10 or 12. Questions missed in this browser return after two other questions; facts commonly missed by all players also get selected more often. SQLite records every submitted answer.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The command starts both Vite and the API. Local database files are stored in `data/`. Use **New session** to clear the current range's local practice session; lifetime scores remain on the server.

## Hosting

The repository includes `railway.toml` for a single-service Railway deployment. Push the project to a GitHub repository, create a Railway project from it, add a persistent volume mounted at `/data`, and set `DATA_DIR=/data` in the service variables. Railway will build with `npm run build`, start with `npm start`, and check `/api/health`. Generate a public domain in the service networking settings.

Do not run multiple replicas against the same SQLite file. Keep one service replica with its volume mounted at `/data` so player and answer records survive restarts and deploys.

Players have a unique display name and a random private ID stored in that browser. This is a lightweight shared leaderboard, not a login system: clearing browser storage loses that player's identity, and scores cannot be recovered across devices. Add real authentication before using the board for prizes or other high-stakes competition.

## Checks

```sh
npm run lint
npm run build
npm run test:api
```

## Handwriting font

The chart-derived font pack remains available as `public/fonts/letter-chart-hand.woff2` and `public/fonts/letter-chart-hand.ttf`; the app currently uses Arial for readability.

To rebuild the font after changing the source chart at `scripts/assets/letter-chart-reupload.JPG`, install the dependencies listed in `scripts/requirements-font.txt` and run:

```sh
python scripts/build_handwritten_font.py
```
