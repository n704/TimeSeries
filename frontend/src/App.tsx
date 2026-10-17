import { useEffect, useId, useRef, useState } from "react";

import {
  ApiError,
  createForecast,
  getHistory,
  searchSecurities,
} from "./api/client";
import { PriceChart } from "./components/PriceChart";
import type {
  ForecastHorizon,
  ForecastResponse,
  HistoryRange,
  HistoryResponse,
  Security,
} from "./types";

const ranges: HistoryRange[] = ["6m", "1y", "2y", "5y"];
const horizons: ForecastHorizon[] = [5, 20, 60];

function formatPrice(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function readableError(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.message} (Request ${error.requestId})`;
  }
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}

export default function App() {
  const inputId = useId();
  const resultsId = useId();
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const forecastRequestRef = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Security[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Security | null>(null);
  const [range, setRange] = useState<HistoryRange>("1y");
  const [horizon, setHorizon] = useState<ForecastHorizon>(20);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [forecasting, setForecasting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMovingAverages, setShowMovingAverages] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || selected?.name === trimmed) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(async () => {
      setError(null);
      try {
        setSearchResults(await searchSecurities(trimmed, controller.signal));
      } catch (searchError) {
        if (!controller.signal.aborted) setError(readableError(searchError));
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, selected]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setLoadingHistory(true);
    setHistory(null);
    setError(null);
    getHistory(selected.symbol, range, controller.signal)
      .then(setHistory)
      .catch((historyError) => {
        if (!controller.signal.aborted) {
          setHistory(null);
          setError(readableError(historyError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingHistory(false);
      });
    return () => controller.abort();
  }, [selected, range]);

  useEffect(
    () => () => {
      forecastRequestRef.current?.abort();
      forecastRequestRef.current = null;
    },
    [selected?.symbol],
  );

  function chooseSecurity(security: Security) {
    forecastRequestRef.current?.abort();
    forecastRequestRef.current = null;
    setForecasting(false);
    setSelected(security);
    setQuery(security.name);
    setSearchResults([]);
    setHistory(null);
    setForecast(null);
    setError(null);
  }

  async function generateForecast() {
    if (!selected) return;
    forecastRequestRef.current?.abort();
    const controller = new AbortController();
    forecastRequestRef.current = controller;
    setForecasting(true);
    setError(null);
    try {
      const result = await createForecast(selected.symbol, horizon, controller.signal);
      if (forecastRequestRef.current === controller && !controller.signal.aborted) {
        setForecast(result);
        window.setTimeout(() => resultHeadingRef.current?.focus(), 0);
      }
    } catch (forecastError) {
      if (!controller.signal.aborted) setError(readableError(forecastError));
    } finally {
      if (forecastRequestRef.current === controller) {
        forecastRequestRef.current = null;
        setForecasting(false);
      }
    }
  }

  const activeHistory = history?.prices ?? forecast?.history ?? [];
  const currency = forecast?.security.currency ?? history?.security.currency ?? "USD";
  const latest = activeHistory.at(-1);

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="TimeSeries Forecast Lab home">
          <span className="brand-mark" aria-hidden="true">T</span>
          <span>TimeSeries <b>Forecast Lab</b></span>
        </a>
        <span className="mode-badge">Local TimesFM</span>
      </header>

      <main>
        <section className="hero">
          <p className="eyebrow">TIME-SERIES INTELLIGENCE</p>
          <h1>See the trend.<br /><span>Understand the uncertainty.</span></h1>
          <p className="hero-copy">
            Explore daily U.S. stock forecasts generated by TimesFM on your Mac.
            Every prediction includes its uncertainty range and source context.
          </p>

          <div className="search-wrap">
            <label htmlFor={inputId}>Search by company or ticker</label>
            <div className="search-input-wrap">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" />
              </svg>
              <input
                id={inputId}
                role="combobox"
                aria-autocomplete="list"
                aria-controls={resultsId}
                aria-expanded={searchResults.length > 0}
                value={query}
                placeholder="Try Apple, Microsoft, or AAPL"
                autoComplete="off"
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (selected) {
                    forecastRequestRef.current?.abort();
                    forecastRequestRef.current = null;
                    setForecasting(false);
                    setSelected(null);
                    setHistory(null);
                    setForecast(null);
                  }
                }}
              />
              {searching && <span className="spinner small" aria-label="Searching" />}
            </div>
            <ul
              id={resultsId}
              role="listbox"
              className={`search-results ${searchResults.length ? "open" : ""}`}
            >
              {searchResults.map((security) => (
                <li key={`${security.exchange}-${security.symbol}`} role="option">
                  <button type="button" onClick={() => chooseSecurity(security)}>
                    <span>
                      <strong>{security.name}</strong>
                      <small>{security.exchange} · {security.currency}</small>
                    </span>
                    <b>{security.symbol}</b>
                  </button>
                </li>
              ))}
            </ul>
            {!selected && query.trim().length >= 2 && !searching && !searchResults.length && (
              <p className="search-note">No supported U.S. common stock found.</p>
            )}
          </div>
        </section>

        {error && (
          <div className="error-banner" role="alert">
            <span>!</span>
            <p>{error}</p>
          </div>
        )}

        {selected && (
          <section className="workspace" aria-busy={loadingHistory || forecasting}>
            <div className="security-heading">
              <div>
                <p className="ticker">{selected.symbol} · {selected.exchange}</p>
                <h2>{selected.name}</h2>
                {latest && <p className="latest-price">{formatPrice(latest.adjusted_close, currency)}</p>}
              </div>
              <div className="freshness">
                <span className="status-dot" />
                {history ? `Through ${history.metadata.last_market_date}` : "Loading data"}
              </div>
            </div>

            <div className="control-row">
              <fieldset>
                <legend>Historical range</legend>
                <div className="segment-control">
                  {ranges.map((item) => (
                    <button
                      type="button"
                      key={item}
                      className={range === item ? "active" : ""}
                      aria-pressed={range === item}
                      onClick={() => setRange(item)}
                    >
                      {item.toUpperCase()}
                    </button>
                  ))}
                </div>
              </fieldset>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={showMovingAverages}
                  onChange={(event) => setShowMovingAverages(event.target.checked)}
                />
                <span />
                Moving averages
              </label>
            </div>

            {loadingHistory ? (
              <div className="chart-loading" role="status">
                <span className="spinner" />
                Loading daily market history…
              </div>
            ) : history ? (
              <>
                {history.metadata.is_stale && (
                  <p className="stale-warning">Market data may be stale. Check the last market date before interpreting this forecast.</p>
                )}
                <PriceChart
                  history={activeHistory}
                  forecast={forecast?.forecast}
                  currency={currency}
                  showMovingAverages={showMovingAverages}
                />
              </>
            ) : null}

            <div className="forecast-panel">
              <div>
                <p className="eyebrow">FORECAST HORIZON</p>
                <h3>Look ahead by trading session</h3>
              </div>
              <div className="forecast-actions">
                <div className="segment-control horizon">
                  {horizons.map((item) => (
                    <button
                      type="button"
                      key={item}
                      className={horizon === item ? "active" : ""}
                      aria-pressed={horizon === item}
                      onClick={() => setHorizon(item)}
                    >
                      {item} days
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={generateForecast}
                  disabled={!history || forecasting}
                >
                  {forecasting ? <><span className="spinner small" /> Forecasting…</> : "Generate forecast"}
                </button>
              </div>
            </div>

            {forecast && (
              <section className="results" aria-labelledby="forecast-result">
                <div className="result-intro">
                  <p className={`trend-chip ${forecast.analysis.trend}`}>
                    {forecast.analysis.trend.replace("_", " ")} trend
                  </p>
                  <h2 id="forecast-result" ref={resultHeadingRef} tabIndex={-1}>
                    TimesFM forecast
                  </h2>
                  <p>{forecast.analysis.summary}</p>
                </div>
                <div className="metric-grid">
                  <article>
                    <span>Latest close</span>
                    <strong>{formatPrice(forecast.analysis.latest_close, currency)}</strong>
                  </article>
                  <article>
                    <span>Forecast end</span>
                    <strong>{formatPrice(forecast.analysis.forecast_end, currency)}</strong>
                  </article>
                  <article>
                    <span>Forecast change</span>
                    <strong className={forecast.analysis.forecast_change_percent >= 0 ? "positive" : "negative"}>
                      {formatPercent(forecast.analysis.forecast_change_percent)}
                    </strong>
                  </article>
                  <article>
                    <span>Final range width</span>
                    <strong>{forecast.analysis.final_interval_width_percent.toFixed(2)}%</strong>
                  </article>
                </div>

                <details className="forecast-details">
                  <summary>Forecast values and methodology</summary>
                  <div className="details-grid">
                    <div>
                      <h3>Run details</h3>
                      <dl>
                        <div><dt>Model</dt><dd>{forecast.metadata.model}</dd></div>
                        <div><dt>Version</dt><dd>{forecast.metadata.model_version}</dd></div>
                        <div><dt>Backend</dt><dd>{forecast.metadata.backend}</dd></div>
                        <div><dt>Context</dt><dd>{forecast.metadata.context_observations} sessions</dd></div>
                        <div><dt>Data source</dt><dd>{forecast.metadata.provider}</dd></div>
                      </dl>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <caption>All forecast price estimates</caption>
                        <thead>
                          <tr><th>Date</th><th>p10</th><th>Median</th><th>p90</th></tr>
                        </thead>
                        <tbody>
                          {forecast.forecast.map((point) => (
                            <tr key={point.date}>
                              <td>{point.date}</td>
                              <td>{formatPrice(point.p10, currency)}</td>
                              <td>{formatPrice(point.p50, currency)}</td>
                              <td>{formatPrice(point.p90, currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
                <p className="disclaimer">{forecast.disclaimer}</p>
              </section>
            )}
          </section>
        )}
      </main>

      <footer>
        <p>Built for local research with Google Research TimesFM.</p>
        <p>Daily common-stock forecasts only · Not financial advice.</p>
      </footer>
      <div className="sr-only" aria-live="polite">
        {forecasting ? "Generating forecast" : forecast ? "Forecast complete" : ""}
      </div>
    </div>
  );
}
