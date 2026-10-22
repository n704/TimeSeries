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

Docker Compose sets the development-only `VITE_PROXY_TARGET` to
`http://backend:8000` so the Vite container reaches the backend service. Normal
local development keeps the default `http://localhost:8000`.

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
| `src/components/PortfolioSnapshotChart.tsx` | Per-position saved adjusted-close chart |
| `src/components/TrackingDashboard.tsx` | Local watchlist and paper portfolio presentation |
| `src/hooks/useTracking.ts` | API-backed tracking state and browser-data migration |
| `src/types.ts` | API-facing TypeScript types |
| `src/styles.css` | Design system and responsive behavior |

## User flow

1. Open the default **NIFTY 50 research** tab.
2. Reliance is selected and its 20-session forecast starts automatically.
3. Choose any of the 50 constituents from the dropdown and select
   **Predict selected stock**.
4. Review the neutral model-screening signal, price range, uncertainty,
   five-session trend alignment, seven-session holdout evidence, metadata, and
   disclaimer. A conflicting recent trend or weak holdout result is shown as
   limited evidence rather than an unqualified positive signal. The signal is
   not a buy recommendation.
5. Optionally select NIFTY 50, NIFTY NEXT 50, NIFTY MIDCAP SELECT, or NIFTY
   SMALLCAP 100 and view up to five positive 20-session median forecast changes.
6. Optionally change the display range, moving-average overlays, or forecast
   horizon.
7. Optionally open the detailed back-check for actual and predicted values from
   the latest seven known sessions. Forecast results already summarize its
   error, coverage, and directional accuracy when enough history is available.
8. Open **Stock explorer** to search any supported NSE/BSE common stock; search
   starts after a 300 ms debounce.
9. Add the selected stock to the local watchlist or save a paper position with
   quantity and average price.
10. Open **Watchlist & portfolio** to review per-position adjusted-close
    snapshot charts with average-price reference lines, the exact saved-session
    table, paper cost basis, market value, unrealized change, latest daily move,
    and a selectable 7-, 20-, or 60-session median and p10-p90 forecast range.

Watchlist and paper portfolio data is stored by the backend in its configured
local tracking database. Direct backend runs default to SQLite and Docker
Compose uses PostgreSQL. Existing browser-local tracking data is migrated once
when the database is empty. Tracking is not synchronized to a user account,
another device, or a brokerage.
For each paper position, the backend saves its latest available adjusted close
at 4:00 PM Asia/Kolkata on its exchange trading days under the provider's
exchange market date. The frontend polls tracking state once per minute so a
page left open across the capture time receives the new daily move. Weekends
and exchange holidays do not trigger provider capture or create synthetic
daily rows. Each position with saved history has a responsive chart; the
expandable table remains the accessible exact-value alternative.
Opening the tracker or changing its forecast horizon automatically requests
missing TimesFM forecasts sequentially. The 7- and 20-session views use a
20-session run; the 60-session view uses a 60-session run.

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
- Index comparison success moves keyboard focus to its result heading.
- Back-check success moves keyboard focus to its result heading.
- A symbol change aborts both forecast and back-check requests.

Maintain these rules when refactoring state or adopting a server-state library.

## Forecast evidence

When enough history is available, the primary forecast multiplies TimesFM p10,
p50, and p90 by the latest isolated holdout's `actual / p50` ratio. The
evidence panel shows the signed latest error and applied adjustment alongside:

- the latest five-session adjusted-close move and whether it aligns with the
  modeled direction;
- mean absolute percentage error from one isolated seven-session holdout;
- daily directional accuracy and p10-p90 coverage for that holdout;
- whether the modeled end direction matched the known holdout.

The panel labels the combined evidence as supportive, mixed, or limited. These
labels describe historical support for the displayed outlook, not a probability
of success or a recommendation. The detailed calculation and its limits are in
[Forecast calculation](../FORECAST_CALCULATION.md).

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
