# Little by Little

A focused multiplication practice app. Start with facts through 5, then move up to 10 or 12. Missed facts return after two other questions, mixed in with facts you have not answered yet. Your answers, streak, accuracy, and review queue are saved in this browser.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Use **New session** to clear the current range's practice progress. Changing the table range also starts a fresh session.

## Checks

```sh
npm run lint
npm run build
```

## Handwriting font

The chart-derived font is available as `public/fonts/letter-chart-hand.woff2` for the app and `public/fonts/letter-chart-hand.ttf` for desktop use. Its glyphs include uppercase and lowercase letters, digits, and the chart's math/general symbols. Characters not present on the chart use the browser's system fallback.

To rebuild the font after changing the source chart at `scripts/assets/letter-chart-reupload.JPG`, install the dependencies listed in `scripts/requirements-font.txt` and run:

```sh
python scripts/build_handwritten_font.py
```
