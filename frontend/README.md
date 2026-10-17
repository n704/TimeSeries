# Frontend

Responsive React interface for Indian stock search, historical price
exploration, and TimesFM forecasts with uncertainty.

## Technology

- React 19
- TypeScript
- Vite
- Recharts
- Vitest and Testing Library

## Setup

```bash
npm install
```

## Run

```bash
npm run dev
```

The development server runs at `http://localhost:5173` and proxies `/api` and
`/health` to `http://localhost:8000`.

To use a different API origin:

```bash
VITE_API_BASE_URL=https://api.example.com/api/v1 npm run build
```

Only public frontend configuration may use the `VITE_` prefix. Never expose
market-data credentials, model credentials, or checkpoint paths.

## Source map

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Search, selection, history, forecast state, and primary layout |
| `src/api/client.ts` | Typed fetch wrapper and public API errors |
| `src/components/PriceChart.tsx` | Chart view model and Recharts rendering |
| `src/types.ts` | API-facing TypeScript types |
| `src/styles.css` | Design system and responsive behavior |

## User flow

1. Enter at least two characters of an Indian company name or NSE/BSE ticker.
2. Search starts after a 300 ms debounce.
3. Select one supported security.
4. Load and display adjusted-close history.
5. Optionally change the display range or moving-average overlays.
6. Choose 5, 20, or 60 trading sessions.
7. Generate and display the forecast, metrics, metadata, and disclaimer.
8. Optionally back-check the model against the latest seven known sessions.

## Request state rules

- Search, history, and forecast requests use `AbortController`.
- Selecting a new stock clears previous history and forecast data.
- A stale response must never overwrite the currently selected stock.
- Range changes affect historical display but not the forecast horizon.
- Forecast success moves keyboard focus to the result heading.
- Back-check success moves keyboard focus to its result heading.
- A symbol change aborts both forecast and back-check requests.

Maintain these rules when refactoring state or adopting a server-state library.

## Chart contract

Before forecasting, the chart displays historical adjusted close. After
forecasting, it adds:

- a p50 median line;
- a p10-p90 uncertainty band;
- a divider at the last historical observation;
- optional 20-session and 50-session averages.

Keep the forecast table under **Forecast values and methodology** as the text
alternative. Do not rely on color alone to distinguish series.

## Test and build

```bash
npm test
npm run build
```

`npm run build` performs no-emit TypeScript checks before creating `dist/`.

The current Vite build may report a bundle-size warning because Recharts is part
of the initial route. This is not a failed build. If performance work is in
scope, measure before introducing route or component code splitting.

## Production artifact

```bash
npm run build
```

The static artifact is written to `dist/`. Deploy that directory to a static
host only after setting the correct `VITE_API_BASE_URL` at build time. The API
must handle TLS, CORS, and the production inference adapter separately.
