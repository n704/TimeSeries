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

1. Open the default **NIFTY 50 research** tab.
2. Reliance is selected and its 20-session forecast starts automatically.
3. Choose any of the 50 constituents from the dropdown and select
   **Predict selected stock**.
4. Review the neutral model-screening signal, price range, uncertainty, metadata,
   and disclaimer. The signal is not a buy recommendation.
5. Optionally change the display range, moving-average overlays, or forecast
   horizon.
6. Optionally back-check the model against the latest seven known sessions.
7. Open **Stock explorer** to search any supported NSE/BSE common stock; search
   starts after a 300 ms debounce.

The checked-in research list is a snapshot of the official
[NIFTY 50 constituent CSV](https://www.niftyindices.com/IndexConstituent/ind_nifty50list.csv).
Index membership can change during scheduled reviews.

## Request state rules

- Search, history, and forecast requests use `AbortController`.
- Selecting a new stock clears previous history and forecast data.
- A stale response must never overwrite the currently selected stock.
- The NIFTY 50 prediction button loads and forecasts only the stock currently
  chosen in the dropdown.
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
