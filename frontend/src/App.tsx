import { useEffect, useId, useRef, useState } from "react";

import {
  ApiError,
  createBacktest,
  createForecast,
  getHistory,
  searchSecurities,
} from "./api/client";
import { PriceChart } from "./components/PriceChart";
import type {
  BacktestResponse,
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
  const backtestHeadingRef = useRef<HTMLHeadingElement>(null);
  const forecastRequestRef = useRef<AbortController | null>(null);
  const backtestRequestRef = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Security[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Security | null>(null);
  const [range, setRange] = useState<HistoryRange>("1y");
  const [horizon, setHorizon] = useState<ForecastHorizon>(20);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [forecasting, setForecasting] = useState(false);
  const [backtesting, setBacktesting] = useState(false);
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
      backtestRequestRef.current?.abort();
      backtestRequestRef.current = null;
    },
    [selected?.symbol],
  );

  function chooseSecurity(security: Security) {
    forecastRequestRef.current?.abort();
    forecastRequestRef.current = null;
    backtestRequestRef.current?.abort();
    backtestRequestRef.current = null;
    setForecasting(false);
    setBacktesting(false);
    setSelected(security);
    setQuery(security.name);
    setSearchResults([]);
    setHistory(null);
    setForecast(null);
    setBacktest(null);
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

  async function runBacktest() {
    if (!selected) return;
    backtestRequestRef.current?.abort();
    const controller = new AbortController();
    backtestRequestRef.current = controller;
    setBacktesting(true);
    setError(null);
    try {
      const result = await createBacktest(selected.symbol, controller.signal);
      if (backtestRequestRef.current === controller && !controller.signal.aborted) {
        setBacktest(result);
        window.setTimeout(() => backtestHeadingRef.current?.focus(), 0);
      }
    } catch (backtestError) {
      if (!controller.signal.aborted) setError(readableError(backtestError));
    } finally {
      if (backtestRequestRef.current === controller) {
        backtestRequestRef.current = null;
        setBacktesting(false);
      }
    }
  }

  const activeHistory = history?.prices ?? forecast?.history ?? [];
  const currency =
    forecast?.security.currency ??
    backtest?.security.currency ??
    history?.security.currency ??
    "INR";
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
            Explore daily Indian stock forecasts generated by TimesFM on your Mac.
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
                placeholder="Try Reliance, Infosys, or TCS"
                autoComplete="off"
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (selected) {
                    forecastRequestRef.current?.abort();
                    forecastRequestRef.current = null;
                    backtestRequestRef.current?.abort();
                    backtestRequestRef.current = null;
                    setForecasting(false);
                    setBacktesting(false);
                    setSelected(null);
                    setHistory(null);
                    setForecast(null);
                    setBacktest(null);
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
              <p className="search-note">No supported NSE or BSE stock found.</p>
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
          <section
            className="workspace"
            aria-busy={loadingHistory || forecasting || backtesting}
          >
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
                  disabled={!history || forecasting || backtesting}
                >
                  {forecasting ? <><span className="spinner small" /> Forecasting…</> : "Generate forecast"}
                </button>
              </div>
            </div>

            <div className="forecast-panel backtest-panel">
              <div>
                <p className="eyebrow">HISTORICAL BACK-CHECK</p>
                <h3>Test the latest 7 known sessions</h3>
                <p className="backtest-copy">
                  Hide the latest seven closes, predict them from earlier data,
                  then compare the estimates with what actually happened.
                </p>
              </div>
              <button
                type="button"
                className="primary-button secondary"
                onClick={runBacktest}
                disabled={!history || forecasting || backtesting}
              >
                {backtesting ? (
                  <><span className="spinner small" /> Back-checking…</>
                ) : (
                  "Back-check last 7 sessions"
                )}
              </button>
            </div>

            {backtest && (
              <section className="results" aria-labelledby="backtest-result">
                <div className="result-intro">
                  <p className="trend-chip">7-session holdout</p>
                  <h2
                    id="backtest-result"
                    ref={backtestHeadingRef}
                    tabIndex={-1}
                  >
                    Historical back-check
                  </h2>
                  <p>
                    TimesFM saw data only through {backtest.metadata.context_end_date}.
                    Its next seven estimates are compared with the known closes below.
                  </p>
                </div>
                <div className="metric-grid backtest-metrics">
                  <article>
                    <span>Mean absolute error</span>
                    <strong>
                      {formatPrice(backtest.metrics.mean_absolute_error, currency)}
                    </strong>
                  </article>
                  <article>
                    <span>Mean absolute percentage error</span>
                    <strong>
                      {backtest.metrics.mean_absolute_percentage_error.toFixed(2)}%
                    </strong>
                  </article>
                  <article>
                    <span>p10-p90 coverage</span>
                    <strong>
                      {backtest.metrics.interval_coverage_percent.toFixed(2)}%
                    </strong>
                  </article>
                </div>
                <div className="forecast-details backtest-details">
                  <div className="table-scroll">
                    <table>
                      <caption>Predicted and actual prices for the holdout sessions</caption>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Actual</th>
                          <th>Median</th>
                          <th>Error</th>
                          <th>p10</th>
                          <th>p90</th>
                        </tr>
                      </thead>
                      <tbody>
                        {backtest.points.map((point) => (
                          <tr key={point.date}>
                            <td>{point.date}</td>
                            <td>{formatPrice(point.actual, currency)}</td>
                            <td>{formatPrice(point.p50, currency)}</td>
                            <td>
                              {formatPercent(
                                ((point.p50 - point.actual) / point.actual) * 100,
                              )}
                            </td>
                            <td>{formatPrice(point.p10, currency)}</td>
                            <td>{formatPrice(point.p90, currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <p className="disclaimer">{backtest.disclaimer}</p>
              </section>
            )}

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
        <p>Daily NSE and BSE stock forecasts only · Not financial advice.</p>
      </footer>
      <div className="sr-only" aria-live="polite">
        {backtesting
          ? "Running historical back-check"
          : forecasting
            ? "Generating forecast"
            : backtest
              ? "Historical back-check complete"
              : forecast
                ? "Forecast complete"
                : ""}
      </div>
    </div>
  );
}
