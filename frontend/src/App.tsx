import { useEffect, useId, useRef, useState } from "react";

import {
  ApiError,
  createBacktest,
  createForecast,
  getHistory,
  screenIndex,
  searchSecurities,
} from "./api/client";
import { PriceChart } from "./components/PriceChart";
import { TrackingDashboard } from "./components/TrackingDashboard";
import { useTracking } from "./hooks/useTracking";
import { defaultNiftySecurity, nifty50Constituents } from "./nifty50";
import type {
  BacktestResponse,
  ForecastHorizon,
  ForecastResponse,
  HistoryRange,
  HistoryResponse,
  IndexScreenResponse,
  PortfolioOutlookHorizon,
  PortfolioOutlooks,
  PortfolioPosition,
  ResearchIndexId,
  Security,
} from "./types";

const ranges: HistoryRange[] = ["6m", "1y", "2y", "5y"];
const horizons: ForecastHorizon[] = [5, 20, 60];
const researchIndices: { id: ResearchIndexId; name: string }[] = [
  { id: "nifty50", name: "NIFTY 50" },
  { id: "nifty_next50", name: "NIFTY NEXT 50" },
  { id: "nifty_midcap_select", name: "NIFTY MIDCAP SELECT" },
  { id: "nifty_smallcap100", name: "NIFTY SMALLCAP 100" },
];

type AppTab = "research" | "explore" | "tracking";

interface HoldingDraft {
  security: Security;
  quantity: string;
  averagePrice: string;
  latestClose: number;
  lastMarketDate: string;
}

interface ResearchSignal {
  label: string;
  tone: "positive" | "mixed" | "negative";
  explanation: string;
}

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

function formatOptionalPercent(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(2)}%`
    : "Unavailable";
}

function isObservationCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function readableError(error: unknown): string {
  if (error instanceof ApiError) {
    const available = error.details?.available_observations;
    const required = error.details?.required_observations;
    const historyDetails =
      error.code === "INSUFFICIENT_HISTORY" &&
      isObservationCount(available) &&
      isObservationCount(required)
        ? ` Available history: ${available} trading days. Minimum required for prediction: ${required} trading days.`
        : "";
    return `${error.message}${historyDetails} (Request ${error.requestId})`;
  }
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred.";
}

function getResearchSignal(forecast: ForecastResponse): ResearchSignal {
  const finalPoint = forecast.forecast.at(-1);
  const latest = forecast.analysis.latest_close;
  if (!finalPoint) {
    return {
      label: "Insufficient forecast data",
      tone: "mixed",
      explanation: "TimesFM did not return an end-of-horizon range to screen.",
    };
  }
  let signal: ResearchSignal;
  if (finalPoint.p10 > latest) {
    signal = {
      label: "Range above latest close",
      tone: "positive",
      explanation:
        "The full final p10-p90 range is above the latest adjusted close, while uncertainty still applies.",
    };
  } else if (finalPoint.p50 > latest) {
    signal = {
      label: "Positive median, overlapping downside",
      tone: "mixed",
      explanation:
        "The median ends above the latest close, but the uncertainty range still includes a lower outcome.",
    };
  } else if (finalPoint.p90 < latest) {
    signal = {
      label: "Range below latest close",
      tone: "negative",
      explanation:
        "The full final p10-p90 range is below the latest adjusted close.",
    };
  } else {
    signal = {
      label: "Mixed forecast range",
      tone: "mixed",
      explanation:
        "The final uncertainty range crosses the latest close and the median does not show positive modeled change.",
    };
  }

  if (forecast.analysis.trend_alignment === "opposed") {
    const recentChange = forecast.analysis.historical_change_5d_percent;
    const recentContext =
      recentChange === null
        ? "The latest five-session direction points the other way."
        : `The latest five-session move (${formatPercent(recentChange)}) points the other way.`;
    return {
      label: "Model range conflicts with recent trend",
      tone: "mixed",
      explanation: `${signal.explanation} ${recentContext}`,
    };
  }
  if (forecast.analysis.evidence_level === "limited") {
    return {
      label: "Model range has limited evidence",
      tone: "mixed",
      explanation:
        `${signal.explanation} The recent-pattern and holdout checks do not provide strong supporting evidence.`,
    };
  }
  return signal;
}

function getPortfolioOutlooks(forecast: ForecastResponse): PortfolioOutlooks {
  const outlooks: PortfolioOutlooks = {};
  const horizons = [7, 20, 60] as const;
  for (const horizon of horizons) {
    const point = forecast.forecast[horizon - 1];
    if (!point) continue;
    outlooks[horizon] = {
      date: point.date,
      p10: point.p10,
      p50: point.p50,
      p90: point.p90,
      generatedAt: forecast.metadata.generated_at,
    };
  }
  return outlooks;
}

export default function App() {
  const inputId = useId();
  const resultsId = useId();
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const backtestHeadingRef = useRef<HTMLHeadingElement>(null);
  const screenHeadingRef = useRef<HTMLHeadingElement>(null);
  const forecastRequestRef = useRef<AbortController | null>(null);
  const backtestRequestRef = useRef<AbortController | null>(null);
  const screenRequestRef = useRef<AbortController | null>(null);
  const portfolioForecastRequestRef = useRef<AbortController | null>(null);
  const resultFocusTimeoutRef = useRef<number | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("research");
  const [researchSymbol, setResearchSymbol] = useState(defaultNiftySecurity.symbol);
  const [researchIndexId, setResearchIndexId] =
    useState<ResearchIndexId>("nifty50");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Security[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Security | null>(defaultNiftySecurity);
  const [autoForecastSymbol, setAutoForecastSymbol] = useState<string | null>(
    defaultNiftySecurity.symbol,
  );
  const [range, setRange] = useState<HistoryRange>("1y");
  const [horizon, setHorizon] = useState<ForecastHorizon>(20);
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);
  const [indexScreen, setIndexScreen] = useState<IndexScreenResponse | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [forecasting, setForecasting] = useState(false);
  const [backtesting, setBacktesting] = useState(false);
  const [screeningIndex, setScreeningIndex] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMovingAverages, setShowMovingAverages] = useState(false);
  const [holdingDraft, setHoldingDraft] = useState<HoldingDraft | null>(null);
  const [portfolioOutlookHorizon, setPortfolioOutlookHorizon] =
    useState<PortfolioOutlookHorizon>(7);
  const [portfolioForecastProgress, setPortfolioForecastProgress] = useState({
    completed: 0,
    total: 0,
  });
  const [portfolioForecasting, setPortfolioForecasting] = useState(false);
  const [portfolioForecastError, setPortfolioForecastError] =
    useState<string | null>(null);
  const {
    watchlist,
    positions,
    trackingError,
    trackingReady,
    toggleWatchlist,
    savePosition,
    removePosition,
    refreshSnapshot,
    refreshOutlooks,
  } = useTracking();

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
      .then((response) => {
        setHistory(response);
        const latestPoint = response.prices.at(-1);
        if (latestPoint) {
          refreshSnapshot(
            response.security,
            latestPoint.adjusted_close,
            response.metadata.last_market_date,
          );
        }
      })
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

  useEffect(
    () => () => {
      screenRequestRef.current?.abort();
      screenRequestRef.current = null;
      portfolioForecastRequestRef.current?.abort();
      portfolioForecastRequestRef.current = null;
      if (resultFocusTimeoutRef.current !== null) {
        window.clearTimeout(resultFocusTimeoutRef.current);
        resultFocusTimeoutRef.current = null;
      }
    },
    [],
  );

  function scheduleResultFocus(focus: () => void) {
    if (resultFocusTimeoutRef.current !== null) {
      window.clearTimeout(resultFocusTimeoutRef.current);
    }
    resultFocusTimeoutRef.current = window.setTimeout(() => {
      resultFocusTimeoutRef.current = null;
      focus();
    }, 0);
  }

  function chooseSecurity(security: Security, autoForecast = false) {
    forecastRequestRef.current?.abort();
    forecastRequestRef.current = null;
    backtestRequestRef.current?.abort();
    backtestRequestRef.current = null;
    setForecasting(false);
    setBacktesting(false);
    setSelected({ ...security });
    setQuery(security.name);
    setSearchResults([]);
    setHistory(null);
    setForecast(null);
    setBacktest(null);
    setError(null);
    setHoldingDraft(null);
    setAutoForecastSymbol(autoForecast ? security.symbol : null);
  }

  async function generateForecast() {
    if (!selected) return;
    if (resultFocusTimeoutRef.current !== null) {
      window.clearTimeout(resultFocusTimeoutRef.current);
      resultFocusTimeoutRef.current = null;
    }
    forecastRequestRef.current?.abort();
    const controller = new AbortController();
    forecastRequestRef.current = controller;
    setForecasting(true);
    setError(null);
    try {
      const result = await createForecast(selected.symbol, horizon, controller.signal);
      if (forecastRequestRef.current === controller && !controller.signal.aborted) {
        setForecast(result);
        scheduleResultFocus(() => resultHeadingRef.current?.focus());
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
    if (resultFocusTimeoutRef.current !== null) {
      window.clearTimeout(resultFocusTimeoutRef.current);
      resultFocusTimeoutRef.current = null;
    }
    backtestRequestRef.current?.abort();
    const controller = new AbortController();
    backtestRequestRef.current = controller;
    setBacktesting(true);
    setError(null);
    try {
      const result = await createBacktest(selected.symbol, controller.signal);
      if (backtestRequestRef.current === controller && !controller.signal.aborted) {
        setBacktest(result);
        scheduleResultFocus(() => backtestHeadingRef.current?.focus());
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

  async function runIndexScreen() {
    if (resultFocusTimeoutRef.current !== null) {
      window.clearTimeout(resultFocusTimeoutRef.current);
      resultFocusTimeoutRef.current = null;
    }
    screenRequestRef.current?.abort();
    const controller = new AbortController();
    screenRequestRef.current = controller;
    setScreeningIndex(true);
    setError(null);
    try {
      const result = await screenIndex(researchIndexId, controller.signal);
      if (screenRequestRef.current === controller && !controller.signal.aborted) {
        setIndexScreen(result);
        scheduleResultFocus(() => screenHeadingRef.current?.focus());
      }
    } catch (screenError) {
      if (!controller.signal.aborted) setError(readableError(screenError));
    } finally {
      if (screenRequestRef.current === controller) {
        screenRequestRef.current = null;
        setScreeningIndex(false);
      }
    }
  }

  function predictResearchSecurity() {
    const security = nifty50Constituents.find(
      ({ symbol }) => symbol === researchSymbol,
    );
    if (security) chooseSecurity(security, true);
  }

  useEffect(() => {
    if (
      !autoForecastSymbol ||
      !history ||
      history.security.symbol !== autoForecastSymbol ||
      selected?.symbol !== autoForecastSymbol
    ) {
      return;
    }
    setAutoForecastSymbol(null);
    void generateForecast();
  }, [autoForecastSymbol, history, selected?.symbol]);

  useEffect(() => {
    if (!forecast) return;
    refreshOutlooks(
      forecast.security.symbol,
      getPortfolioOutlooks(forecast),
    );
  }, [forecast]);

  const activeHistory = history?.prices ?? forecast?.history ?? [];
  const currency =
    forecast?.security.currency ??
    backtest?.security.currency ??
    history?.security.currency ??
    "INR";
  const latest = activeHistory.at(-1);
  const researchSignal = forecast ? getResearchSignal(forecast) : null;
  const historicalEvaluation =
    forecast?.analysis.historical_evaluation ?? null;
  const selectedPosition = selected
    ? positions.find((position) => position.security.symbol === selected.symbol)
    : undefined;
  const selectedIsWatched = selected
    ? watchlist.some((item) => item.security.symbol === selected.symbol)
    : false;

  function openHoldingEditor() {
    if (!selected || !latest || !history) return;
    setHoldingDraft({
      security: selected,
      quantity: selectedPosition?.quantity.toString() ?? "",
      averagePrice:
        selectedPosition?.averagePrice.toString() ??
        latest.adjusted_close.toFixed(2),
      latestClose: latest.adjusted_close,
      lastMarketDate: history.metadata.last_market_date,
    });
  }

  function editTrackedPosition(position: PortfolioPosition) {
    setActiveTab("explore");
    chooseSecurity(position.security);
    setHoldingDraft({
      security: position.security,
      quantity: position.quantity.toString(),
      averagePrice: position.averagePrice.toString(),
      latestClose: position.latestClose,
      lastMarketDate: position.lastMarketDate,
    });
  }

  function saveHoldingDraft() {
    if (!holdingDraft) return;
    const quantity = Number(holdingDraft.quantity);
    const averagePrice = Number(holdingDraft.averagePrice);
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(averagePrice) ||
      averagePrice <= 0
    ) {
      setError("Quantity and average price must both be positive numbers.");
      return;
    }
    const currentForecast =
      forecast?.security.symbol === holdingDraft.security.symbol
        ? forecast
        : null;
    const existingOutlooks = positions.find(
      (position) =>
        position.security.symbol === holdingDraft.security.symbol,
    )?.outlooks;
    savePosition(
      holdingDraft.security,
      quantity,
      averagePrice,
      holdingDraft.latestClose,
      holdingDraft.lastMarketDate,
      {
        ...existingOutlooks,
        ...(currentForecast ? getPortfolioOutlooks(currentForecast) : {}),
      },
    );
    setHoldingDraft(null);
    setError(null);
  }

  function openTrackedSecurity(security: Security) {
    setActiveTab("explore");
    chooseSecurity(security);
  }

  async function generateMissingPortfolioOutlooks(
    nextHorizon: PortfolioOutlookHorizon,
  ) {
    setPortfolioOutlookHorizon(nextHorizon);
    portfolioForecastRequestRef.current?.abort();
    const requiredHorizon: ForecastHorizon =
      nextHorizon === 60 ? 60 : 20;
    const missing = positions.filter(
      (position) => !position.outlooks?.[nextHorizon],
    );
    setPortfolioForecastError(null);
    setPortfolioForecastProgress({ completed: 0, total: missing.length });
    if (!missing.length) {
      setPortfolioForecasting(false);
      return;
    }

    const controller = new AbortController();
    portfolioForecastRequestRef.current = controller;
    setPortfolioForecasting(true);
    const failures: string[] = [];
    let completed = 0;

    for (const position of missing) {
      if (controller.signal.aborted) return;
      try {
        const result = await createForecast(
          position.security.symbol,
          requiredHorizon,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        refreshOutlooks(
          position.security.symbol,
          getPortfolioOutlooks(result),
        );
      } catch (forecastError) {
        if (controller.signal.aborted) return;
        failures.push(
          `${position.security.symbol}: ${readableError(forecastError)}`,
        );
      } finally {
        if (!controller.signal.aborted) {
          completed += 1;
          setPortfolioForecastProgress({
            completed,
            total: missing.length,
          });
        }
      }
    }

    if (portfolioForecastRequestRef.current === controller) {
      portfolioForecastRequestRef.current = null;
      setPortfolioForecasting(false);
      if (failures.length) {
        setPortfolioForecastError(
          `Could not generate ${failures.length} of ${missing.length} portfolio forecasts. ${failures.join(" ")}`,
        );
      }
    }
  }

  function openTracking() {
    setActiveTab("tracking");
    void generateMissingPortfolioOutlooks(portfolioOutlookHorizon);
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="TimeSeries Forecast Lab home">
          <span className="brand-mark" aria-hidden="true">₹</span>
          <span className="brand-copy">
            <b>TimeSeries</b>
            <small>Forecast Lab</small>
          </span>
        </a>
        <span className="mode-badge">
          <span className="mode-dot" aria-hidden="true" />
          Local TimesFM
        </span>
      </header>

      <main>
        <div className="app-tabs" role="tablist" aria-label="Forecast workflows">
          <button
            type="button"
            role="tab"
            id="research-tab"
            aria-controls="research-panel"
            aria-selected={activeTab === "research"}
            className={activeTab === "research" ? "active" : ""}
            onClick={() => {
              setActiveTab("research");
              const preset =
                nifty50Constituents.find(({ symbol }) => symbol === selected?.symbol) ??
                defaultNiftySecurity;
              setResearchSymbol(preset.symbol);
              chooseSecurity(preset, true);
            }}
          >
            NIFTY 50 research
          </button>
          <button
            type="button"
            role="tab"
            id="explore-tab"
            aria-controls="explore-panel"
            aria-selected={activeTab === "explore"}
            className={activeTab === "explore" ? "active" : ""}
            onClick={() => setActiveTab("explore")}
          >
            Stock explorer
          </button>
          <button
            type="button"
            role="tab"
            id="tracking-tab"
            aria-controls="tracking-panel"
            aria-selected={activeTab === "tracking"}
            className={activeTab === "tracking" ? "active" : ""}
            onClick={openTracking}
          >
            Watchlist &amp; portfolio
            {(watchlist.length > 0 || positions.length > 0) && (
              <span className="tab-count" aria-label={`${watchlist.length + positions.length} saved items`}>
                {watchlist.length + positions.length}
              </span>
            )}
          </button>
        </div>

        {activeTab === "research" ? (
          <section
            className="hero research-hero"
            id="research-panel"
            role="tabpanel"
            aria-labelledby="research-tab"
          >
            <div className="research-intro">
              <p className="eyebrow">NIFTY 50 RESEARCH</p>
              <h1>Research all <span>NIFTY 50 stocks.</span></h1>
              <p className="hero-copy">
                Compare price history with a probabilistic TimesFM outlook. Start
                with Reliance or choose another index constituent.
              </p>
              <div className="hero-proof" aria-label="Research coverage">
                <span><b>50</b> index leaders</span>
                <span><b>3</b> forecast horizons</span>
                <span><b>p10-p90</b> uncertainty</span>
              </div>
            </div>
            <section className="constituent-panel" aria-labelledby="constituent-heading">
              <div className="constituent-heading">
                <div>
                  <p className="step-label">01 · CHOOSE A SECURITY</p>
                  <h2 id="constituent-heading">Predict a NIFTY 50 stock</h2>
                  <p>The 20-session forecast runs automatically.</p>
                </div>
              </div>
              <form
                className="constituent-picker"
                onSubmit={(event) => {
                  event.preventDefault();
                  predictResearchSecurity();
                }}
              >
                <label className="constituent-select">
                  <span>NIFTY 50 stock</span>
                  <select
                    value={researchSymbol}
                    onChange={(event) => setResearchSymbol(event.target.value)}
                  >
                    {nifty50Constituents.map((security) => (
                      <option key={security.symbol} value={security.symbol}>
                        {security.symbol.replace(".NS", "")} — {security.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="primary-button constituent-predict"
                  disabled={
                    loadingHistory ||
                    autoForecastSymbol !== null ||
                    forecasting ||
                    backtesting ||
                    screeningIndex
                  }
                >
                  {loadingHistory && selected?.symbol === researchSymbol
                    ? "Loading history..."
                    : forecasting && selected?.symbol === researchSymbol
                      ? "Predicting..."
                      : "Predict selected stock"}
                </button>
              </form>
              <p className="preset-note">
                Constituent snapshot from NSE Indices. Membership can change at
                index reviews; this list is for research navigation, not an
                investment recommendation.
              </p>
            </section>
          </section>
        ) : activeTab === "explore" ? (
          <section
            className="hero"
            id="explore-panel"
            role="tabpanel"
            aria-labelledby="explore-tab"
          >
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
                      setAutoForecastSymbol(null);
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
        ) : (
          <TrackingDashboard
            watchlist={watchlist}
            positions={positions}
            error={trackingError}
            onOpenSecurity={openTrackedSecurity}
            onRemoveWatchlist={(item) =>
              toggleWatchlist(
                item.security,
                item.latestClose,
                item.lastMarketDate,
              )
            }
            onEditPosition={editTrackedPosition}
            onRemovePosition={removePosition}
            outlookHorizon={portfolioOutlookHorizon}
            onOutlookHorizonChange={(nextHorizon) =>
              void generateMissingPortfolioOutlooks(nextHorizon)
            }
            forecastProgress={portfolioForecastProgress}
            forecasting={portfolioForecasting}
            forecastError={portfolioForecastError}
            loading={!trackingReady && !trackingError}
          />
        )}

        {error && (
          <div className="error-banner" role="alert">
            <span>!</span>
            <p>{error}</p>
          </div>
        )}

        {selected && activeTab !== "tracking" && (
          <section
            className="workspace"
            aria-busy={loadingHistory || forecasting || backtesting || screeningIndex}
          >
            <div className="security-heading">
              <div>
                <p className="ticker">{selected.symbol} · {selected.exchange}</p>
                <h2>{selected.name}</h2>
                {latest && (
                  <p className="latest-price">
                    <span>Latest adjusted close</span>
                    <strong>{formatPrice(latest.adjusted_close, currency)}</strong>
                  </p>
                )}
              </div>
              <div className="security-meta">
                <div className="freshness">
                  <span className="status-dot" />
                  {history ? `Through ${history.metadata.last_market_date}` : "Loading data"}
                </div>
                {history && latest && (
                  <div className="tracking-quick-actions">
                    <button
                      type="button"
                      className={selectedIsWatched ? "tracking-button active" : "tracking-button"}
                      aria-pressed={selectedIsWatched}
                      disabled={!trackingReady}
                      onClick={() =>
                        toggleWatchlist(
                          selected,
                          latest.adjusted_close,
                          history.metadata.last_market_date,
                        )
                      }
                    >
                      <span aria-hidden="true">{selectedIsWatched ? "★" : "☆"}</span>
                      {selectedIsWatched ? "In watchlist" : "Add to watchlist"}
                    </button>
                    <button
                      type="button"
                      className="tracking-button"
                      onClick={openHoldingEditor}
                      disabled={!trackingReady}
                    >
                      <span aria-hidden="true">₹</span>
                      {selectedPosition ? "Edit holding" : "Add holding"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {trackingError && (
              <p className="tracking-error compact" role="alert">{trackingError}</p>
            )}

            {holdingDraft && holdingDraft.security.symbol === selected.symbol && (
              <form
                className="holding-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveHoldingDraft();
                }}
              >
                <div>
                  <p className="step-label">
                    {selectedPosition ? "UPDATE PAPER POSITION" : "ADD PAPER POSITION"}
                  </p>
                  <h3>{holdingDraft.security.name}</h3>
                  <p>Use your own quantity and average acquisition price.</p>
                </div>
                <label>
                  <span>Quantity</span>
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    required
                    value={holdingDraft.quantity}
                    onChange={(event) =>
                      setHoldingDraft((current) =>
                        current
                          ? { ...current, quantity: event.target.value }
                          : current,
                      )
                    }
                    placeholder="10"
                  />
                </label>
                <label>
                  <span>Average price ({holdingDraft.security.currency})</span>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    required
                    value={holdingDraft.averagePrice}
                    onChange={(event) =>
                      setHoldingDraft((current) =>
                        current
                          ? { ...current, averagePrice: event.target.value }
                          : current,
                      )
                    }
                  />
                </label>
                <div className="holding-editor-actions">
                  <button type="submit" className="primary-button">
                    Save holding
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setHoldingDraft(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {forecast && (
              <section className="forecast-overview" aria-labelledby="forecast-result">
                <div className="forecast-overview-copy">
                  <div className="forecast-chip-row">
                    <p className={`trend-chip ${forecast.analysis.trend}`}>
                      TimesFM median: {forecast.analysis.trend.replace("_", " ")}
                    </p>
                    <p className={`trend-chip evidence-${forecast.analysis.evidence_level}`}>
                      Evidence: {forecast.analysis.evidence_level}
                    </p>
                  </div>
                  <h2 id="forecast-result" ref={resultHeadingRef} tabIndex={-1}>
                    TimesFM forecast
                  </h2>
                  <p>{forecast.analysis.summary}</p>
                </div>
                <div className="metric-grid overview-metrics">
                  <article>
                    <span>Latest close</span>
                    <strong>{formatPrice(forecast.analysis.latest_close, currency)}</strong>
                  </article>
                  <article>
                    <span>Forecast end</span>
                    <strong>{formatPrice(forecast.analysis.forecast_end, currency)}</strong>
                  </article>
                  <article>
                    <span>Modeled change</span>
                    <strong className={forecast.analysis.forecast_change_percent >= 0 ? "positive" : "negative"}>
                      {formatPercent(forecast.analysis.forecast_change_percent)}
                    </strong>
                  </article>
                  <article>
                    <span>Uncertainty width</span>
                    <strong>{forecast.analysis.final_interval_width_percent.toFixed(2)}%</strong>
                  </article>
                </div>
              </section>
            )}

            {forecast && (
              <section
                className={`forecast-evidence ${forecast.analysis.evidence_level}`}
                aria-labelledby="forecast-evidence-heading"
              >
                <div className="forecast-evidence-heading">
                  <div>
                    <p className="eyebrow">FORECAST EVIDENCE</p>
                    <h3 id="forecast-evidence-heading">
                      Accuracy and recent-pattern check
                    </h3>
                  </div>
                  <strong>{forecast.analysis.evidence_level} evidence</strong>
                </div>
                <div className="metric-grid evidence-metrics">
                  <article>
                    <span>Latest 5-session move</span>
                    <strong
                      className={
                        (forecast.analysis.historical_change_5d_percent ?? 0) >= 0
                          ? "positive"
                          : "negative"
                      }
                    >
                      {forecast.analysis.historical_change_5d_percent === null
                        ? "Unavailable"
                        : formatPercent(
                            forecast.analysis.historical_change_5d_percent,
                          )}
                    </strong>
                  </article>
                  <article>
                    <span>7-session back-check MAPE</span>
                    <strong>
                      {historicalEvaluation
                        ? `${historicalEvaluation.metrics.mean_absolute_percentage_error.toFixed(2)}%`
                        : "Unavailable"}
                    </strong>
                  </article>
                  <article>
                    <span>Daily direction accuracy</span>
                    <strong>
                      {historicalEvaluation
                        ? `${historicalEvaluation.metrics.directional_accuracy_percent.toFixed(2)}%`
                        : "Unavailable"}
                    </strong>
                  </article>
                  <article>
                    <span>p10-p90 holdout coverage</span>
                    <strong>
                      {historicalEvaluation
                        ? `${historicalEvaluation.metrics.interval_coverage_percent.toFixed(2)}%`
                        : "Unavailable"}
                    </strong>
                  </article>
                </div>
                <p className="evidence-note">
                  {historicalEvaluation
                    ? `The isolated holdout used data only through ${historicalEvaluation.context_end_date}; its overall direction ${
                        historicalEvaluation.metrics.end_direction_match
                          ? "matched"
                          : "did not match"
                      } the known result. These measures describe one historical window, not future certainty.`
                    : "There is enough history to forecast, but not enough earlier data for an isolated seven-session holdout. Evidence remains limited."}
                </p>
              </section>
            )}

            {activeTab === "research" && forecast && researchSignal && (
              <section className={`research-signal ${researchSignal.tone}`} aria-labelledby="research-signal-heading">
                <div>
                  <p className="eyebrow">WHAT THE MODEL RANGE SAYS</p>
                  <h3 id="research-signal-heading">{researchSignal.label}</h3>
                  <p>{researchSignal.explanation}</p>
                </div>
                <div className="signal-range">
                  <span>
                    {forecast.metadata.horizon_trading_days}-session modeled change
                  </span>
                  <strong>{formatPercent(forecast.analysis.forecast_change_percent)}</strong>
                </div>
                <p className="signal-disclaimer">
                  Research cue only. This excludes valuation, fundamentals, news,
                  and personal circumstances; it is not a buy recommendation.
                </p>
              </section>
            )}

            <section className="analysis-toolbar" aria-label="Chart and forecast controls">
              <div className="toolbar-heading">
                <p className="step-label">02 · EXPLORE THE OUTLOOK</p>
                <h3>Price history and forecast</h3>
              </div>
              <fieldset>
                <legend>History</legend>
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
              <fieldset>
                <legend>Forecast horizon</legend>
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
              <button
                type="button"
                className="primary-button toolbar-action"
                onClick={generateForecast}
                disabled={
                  !history ||
                  autoForecastSymbol !== null ||
                  forecasting ||
                  backtesting ||
                  screeningIndex
                }
              >
                {forecasting ? <><span className="spinner small" /> Forecasting…</> : forecast ? "Refresh forecast" : "Generate forecast"}
              </button>
            </section>

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

            {activeTab === "research" && (
              <section className="research-tools" aria-labelledby="research-tools-heading">
                <div className="research-tools-heading">
                  <div>
                    <p className="step-label">03 · GO DEEPER</p>
                    <h2 id="research-tools-heading">Secondary research tools</h2>
                  </div>
                  <p>Compare the wider market or check recent model accuracy.</p>
                </div>
                <div className="research-tools-grid">
                  <div className="forecast-panel screen-panel">
                    <div>
                      <p className="eyebrow">INDEX COMPARISON</p>
                      <h3>Screen for positive median forecasts</h3>
                      <p className="backtest-copy">
                        Rank up to five constituents by positive 20-session
                        median change.
                      </p>
                    </div>
                    <div className="screen-actions">
                      <label>
                        <span>Index universe</span>
                        <select
                          value={researchIndexId}
                          onChange={(event) => {
                            setResearchIndexId(event.target.value as ResearchIndexId);
                            setIndexScreen(null);
                          }}
                        >
                          {researchIndices.map((index) => (
                            <option key={index.id} value={index.id}>{index.name}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="primary-button secondary"
                        onClick={runIndexScreen}
                        disabled={
                          loadingHistory ||
                          autoForecastSymbol !== null ||
                          forecasting ||
                          backtesting ||
                          screeningIndex
                        }
                      >
                        {screeningIndex ? (
                          <><span className="spinner small" /> Comparing index...</>
                        ) : (
                          "Find top 5 for 20 sessions"
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="forecast-panel backtest-panel">
                    <div>
                      <p className="eyebrow">HISTORICAL BACK-CHECK</p>
                      <h3>Test the latest 7 known sessions</h3>
                      <p className="backtest-copy">
                        Hide seven closes, predict them, then compare the estimates
                        with what happened.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="primary-button secondary"
                      onClick={runBacktest}
                      disabled={
                        !history ||
                        autoForecastSymbol !== null ||
                        forecasting ||
                        backtesting ||
                        screeningIndex
                      }
                    >
                      {backtesting ? (
                        <><span className="spinner small" /> Back-checking…</>
                      ) : (
                        "Back-check last 7 sessions"
                      )}
                    </button>
                  </div>
                </div>
              </section>
            )}

            {activeTab === "research" && indexScreen && (
              <section className="results nifty-screen-results" aria-labelledby="nifty-screen-heading">
                <div className="result-intro">
                  <p className="trend-chip upward">Positive median screen</p>
                  <h2
                    id="nifty-screen-heading"
                    ref={screenHeadingRef}
                    tabIndex={-1}
                  >
                    Top positive {indexScreen.metadata.index_name} forecasts
                  </h2>
                  <p>
                    Analyzed {indexScreen.metadata.analyzed_count} of{" "}
                    {indexScreen.metadata.universe_size} constituents for the next{" "}
                    {indexScreen.metadata.horizon_trading_days} trading sessions;{" "}
                    {indexScreen.metadata.positive_count} had a positive median change.
                  </p>
                </div>
                {indexScreen.metadata.unavailable_symbols.length > 0 && (
                  <p className="screen-coverage-note">
                    Not analyzed: {indexScreen.metadata.unavailable_symbols.join(", ")}.
                  </p>
                )}
                {indexScreen.results.length ? (
                  <div className="forecast-details screen-table">
                    <div className="table-scroll">
                      <table>
                        <caption>Highest positive TimesFM median changes</caption>
                        <thead>
                          <tr>
                            <th>Rank</th>
                            <th>Stock</th>
                            <th>Latest close</th>
                            <th>Forecast end</th>
                            <th>Change</th>
                            <th>Final p10-p90</th>
                            <th>Range width</th>
                          </tr>
                        </thead>
                        <tbody>
                          {indexScreen.results.map((result) => (
                            <tr key={result.security.symbol}>
                              <td>{result.rank}</td>
                              <td>
                                <strong>{result.security.symbol}</strong>
                                <small>{result.security.name}</small>
                              </td>
                              <td>
                                {formatPrice(
                                  result.latest_close,
                                  result.security.currency,
                                )}
                              </td>
                              <td>
                                {formatPrice(
                                  result.forecast_end,
                                  result.security.currency,
                                )}
                                <small>{result.forecast_end_date}</small>
                              </td>
                              <td className="positive">
                                {formatPercent(result.forecast_change_percent)}
                              </td>
                              <td>
                                {formatPrice(result.final_p10, result.security.currency)}
                                {" – "}
                                {formatPrice(result.final_p90, result.security.currency)}
                              </td>
                              <td>
                                {result.final_interval_width_percent.toFixed(2)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="screen-empty">
                    No constituent had a positive median change for this horizon.
                  </p>
                )}
                <p className="disclaimer">{indexScreen.disclaimer}</p>
              </section>
            )}

            {activeTab === "explore" && (
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
                disabled={
                  !history ||
                  autoForecastSymbol !== null ||
                  forecasting ||
                  backtesting ||
                  screeningIndex
                }
              >
                {backtesting ? (
                  <><span className="spinner small" /> Back-checking…</>
                ) : (
                  "Back-check last 7 sessions"
                )}
              </button>
              </div>
            )}

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
                  <article>
                    <span>Daily direction accuracy</span>
                    <strong>
                      {formatOptionalPercent(
                        backtest.metrics.directional_accuracy_percent,
                      )}
                    </strong>
                  </article>
                </div>
                <p className="backtest-copy">
                  {typeof backtest.metrics.end_direction_match === "boolean"
                    ? `The median path's overall direction ${
                        backtest.metrics.end_direction_match
                          ? "matched"
                          : "did not match"
                      } the known holdout direction.`
                    : "Directional metrics are unavailable because the backend response is from an older API version. Restart the matching backend to load them."}
                </p>
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
              <section className="forecast-methodology" aria-labelledby="forecast-methodology-heading">
                <div className="section-heading">
                  <div>
                    <p className="step-label">DATA &amp; TRANSPARENCY</p>
                    <h2 id="forecast-methodology-heading">Forecast values and methodology</h2>
                  </div>
                  <p>Inspect the model context, source, and every predicted range.</p>
                </div>
                <details className="forecast-details">
                  <summary>Open forecast data and run details</summary>
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
        <p><strong>TimeSeries Forecast Lab</strong> · Private, local market research.</p>
        <p>Daily NSE and BSE stock forecasts only · Not financial advice.</p>
      </footer>
      <div className="sr-only" aria-live="polite">
        {screeningIndex
          ? "Comparing index forecasts"
          : backtesting
          ? "Running historical back-check"
          : forecasting
            ? "Generating forecast"
            : backtest
              ? "Historical back-check complete"
              : forecast
                ? "Forecast complete"
                : indexScreen
                  ? "Index comparison complete"
                  : ""}
      </div>
    </div>
  );
}
