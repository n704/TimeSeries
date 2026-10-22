import type {
  PortfolioOutlookHorizon,
  PortfolioPosition,
  WatchlistItem,
  Security,
} from "../types";
import { PortfolioSnapshotChart } from "./PortfolioSnapshotChart";

interface TrackingDashboardProps {
  watchlist: WatchlistItem[];
  positions: PortfolioPosition[];
  error: string | null;
  onOpenSecurity: (security: Security) => void;
  onRemoveWatchlist: (item: WatchlistItem) => void;
  onEditPosition: (position: PortfolioPosition) => void;
  onRemovePosition: (symbol: string) => void;
  outlookHorizon: PortfolioOutlookHorizon;
  onOutlookHorizonChange: (horizon: PortfolioOutlookHorizon) => void;
  forecastProgress: { completed: number; total: number };
  forecasting: boolean;
  forecastError: string | null;
  loading: boolean;
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

interface DailyMovement {
  symbol: string;
  date: string;
  previousDate: string;
  adjustedClose: number;
  priceChange: number;
  priceChangePercent: number;
  positionChange: number;
  position: PortfolioPosition;
}

function getDailyMovements(position: PortfolioPosition): DailyMovement[] {
  const history = position.priceHistory ?? [];
  return history.slice(1).map((snapshot, index) => {
    const previous = history[index];
    const priceChange = snapshot.adjustedClose - previous.adjustedClose;
    return {
      symbol: position.security.symbol,
      date: snapshot.date,
      previousDate: previous.date,
      adjustedClose: snapshot.adjustedClose,
      priceChange,
      priceChangePercent: (priceChange / previous.adjustedClose) * 100,
      positionChange: priceChange * position.quantity,
      position,
    };
  });
}

export function TrackingDashboard({
  watchlist,
  positions,
  error,
  onOpenSecurity,
  onRemoveWatchlist,
  onEditPosition,
  onRemovePosition,
  outlookHorizon,
  onOutlookHorizonChange,
  forecastProgress,
  forecasting,
  forecastError,
  loading,
}: TrackingDashboardProps) {
  const totalCost = positions.reduce(
    (sum, position) => sum + position.quantity * position.averagePrice,
    0,
  );
  const marketValue = positions.reduce(
    (sum, position) => sum + position.quantity * position.latestClose,
    0,
  );
  const change = marketValue - totalCost;
  const changePercent = totalCost ? (change / totalCost) * 100 : 0;
  const dailyHistory = positions
    .flatMap(getDailyMovements)
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) ||
        left.symbol.localeCompare(right.symbol),
    );
  const latestDailyDate = dailyHistory[0]?.date ?? null;
  const latestDailyMovements = latestDailyDate
    ? dailyHistory.filter((movement) => movement.date === latestDailyDate)
    : [];
  const latestDailyChange = latestDailyMovements.reduce(
    (sum, movement) => sum + movement.positionChange,
    0,
  );
  const previousDailyValue = latestDailyMovements.reduce(
    (sum, movement) =>
      sum +
      (movement.adjustedClose - movement.priceChange) *
        movement.position.quantity,
    0,
  );
  const latestDailyChangePercent = previousDailyValue
    ? (latestDailyChange / previousDailyValue) * 100
    : 0;
  const latestMovementBySymbol = new Map(
    positions.flatMap(getDailyMovements).map((movement) => [
      movement.symbol,
      movement,
    ]),
  );
  const forecastedPositions = positions.filter(
    (position) => position.outlooks?.[outlookHorizon] !== undefined,
  );
  const projectedValue = forecastedPositions.reduce(
    (sum, position) =>
      sum +
      position.quantity *
        (position.outlooks?.[outlookHorizon]?.p50 ?? 0),
    0,
  );
  const hasCompleteOutlook =
    positions.length > 0 && forecastedPositions.length === positions.length;
  const positionsWithSnapshots = positions.filter(
    (position) => (position.priceHistory?.length ?? 0) > 0,
  );

  return (
    <section
      className="tracking-dashboard"
      id="tracking-panel"
      role="tabpanel"
      aria-labelledby="tracking-tab"
    >
      <div className="tracking-hero">
        <div>
          <p className="eyebrow">PRIVATE RESEARCH TRACKER</p>
          <h1>Your market, <span>in one view.</span></h1>
          <p>
            Save stocks for later and track paper positions using adjusted
            closes, 4 PM trading-day price snapshots, and probabilistic
            TimesFM outlooks.
          </p>
        </div>
        <div className="privacy-card">
          <strong>Saved in the local database</strong>
          <span>Persistent without an account, brokerage connection, or trade execution.</span>
        </div>
      </div>

      {loading && (
        <div className="portfolio-forecast-status tracking-sync-status" role="status">
          <span className="spinner small" />
          <div>
            <strong>Loading saved watchlist and portfolio</strong>
            <span>Synchronizing with the local database</span>
          </div>
        </div>
      )}
      {error && <p className="tracking-error" role="alert">{error}</p>}

      <section className="portfolio-section" aria-labelledby="portfolio-heading">
        <div className="tracking-section-heading">
          <div>
            <p className="step-label">PAPER PORTFOLIO</p>
            <h2 id="portfolio-heading">Position overview</h2>
          </div>
          <div className="portfolio-heading-actions">
            <label>
              <span>Forecast horizon</span>
              <select
                aria-label="Portfolio forecast horizon"
                value={outlookHorizon}
                onChange={(event) =>
                  onOutlookHorizonChange(
                    Number(event.target.value) as PortfolioOutlookHorizon,
                  )
                }
              >
                <option value={7}>7 sessions</option>
                <option value={20}>20 sessions</option>
                <option value={60}>60 sessions</option>
              </select>
            </label>
            <span>{positions.length} of 20 positions</span>
          </div>
        </div>

        {forecasting && (
          <div className="portfolio-forecast-status" role="status">
            <span className="spinner small" />
            <div>
              <strong>
                Generating {outlookHorizon}-session portfolio forecasts
              </strong>
              <span>
                {forecastProgress.completed} of {forecastProgress.total} positions complete
              </span>
            </div>
          </div>
        )}
        {forecastError && (
          <p className="tracking-error portfolio-forecast-error" role="alert">
            {forecastError}
          </p>
        )}

        {positions.length ? (
          <>
            <div className="portfolio-summary">
              <article>
                <span>Market value</span>
                <strong>{formatPrice(marketValue, "INR")}</strong>
              </article>
              <article>
                <span>Cost basis</span>
                <strong>{formatPrice(totalCost, "INR")}</strong>
              </article>
              <article>
                <span>Unrealized change</span>
                <strong className={change >= 0 ? "positive" : "negative"}>
                  {formatPrice(change, "INR")}
                </strong>
              </article>
              <article>
                <span>Change</span>
                <strong className={changePercent >= 0 ? "positive" : "negative"}>
                  {formatPercent(changePercent)}
                </strong>
              </article>
              <article>
                <span>Latest daily move</span>
                {latestDailyDate ? (
                  <>
                    <strong
                      className={
                        latestDailyChange >= 0 ? "positive" : "negative"
                      }
                    >
                      {formatPrice(latestDailyChange, "INR")}
                    </strong>
                    <small>
                      {formatPercent(latestDailyChangePercent)} ·{" "}
                      {latestDailyMovements.length} of {positions.length} through{" "}
                      {latestDailyDate}
                    </small>
                  </>
                ) : (
                  <>
                    <strong>Pending</strong>
                    <small>Two saved market closes are required</small>
                  </>
                )}
              </article>
              <article className="projected-value">
                <span>Projected value · {outlookHorizon} sessions</span>
                <strong>
                  {hasCompleteOutlook
                    ? formatPrice(projectedValue, "INR")
                    : forecasting
                      ? "Generating…"
                      : "Forecast pending"}
                </strong>
                {!hasCompleteOutlook && (
                  <small>
                    {forecastedPositions.length} of {positions.length} positions
                  </small>
                )}
              </article>
            </div>
            <section
              className="portfolio-snapshots"
              aria-labelledby="portfolio-snapshots-heading"
            >
              <div className="portfolio-snapshots-heading">
                <div>
                  <p className="step-label">SAVED MARKET HISTORY</p>
                  <h3 id="portfolio-snapshots-heading">
                    Portfolio snapshot charts
                  </h3>
                </div>
                <p>
                  Adjusted closes captured at 4:00 PM on exchange trading days;
                  dashed lines mark each position's average price.
                </p>
              </div>
              {positionsWithSnapshots.length ? (
                <div className="portfolio-snapshot-grid">
                  {positionsWithSnapshots.map((position) => (
                    <PortfolioSnapshotChart
                      key={position.security.symbol}
                      position={position}
                    />
                  ))}
                </div>
              ) : (
                <p className="snapshot-chart-empty">
                  Snapshot charts appear after the first scheduled market-day
                  capture.
                </p>
              )}
            </section>
            <div className="portfolio-table table-scroll">
              <table>
                <caption className="sr-only">Locally saved paper portfolio positions</caption>
                <thead>
                  <tr>
                    <th>Stock</th>
                    <th>Quantity</th>
                    <th>Average price</th>
                    <th>Last close</th>
                    <th>Daily move</th>
                    <th>{outlookHorizon}-session forecast</th>
                    <th>Projected value</th>
                    <th>Market value</th>
                    <th>Change</th>
                    <th><span className="sr-only">Position actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((position) => {
                    const outlook = position.outlooks?.[outlookHorizon];
                    const dailyMovement = latestMovementBySymbol.get(
                      position.security.symbol,
                    );
                    const positionCost = position.quantity * position.averagePrice;
                    const positionValue = position.quantity * position.latestClose;
                    const positionChange =
                      ((position.latestClose - position.averagePrice) /
                        position.averagePrice) *
                      100;
                    const outlookChange = outlook
                      ? ((outlook.p50 - position.latestClose) /
                          position.latestClose) *
                        100
                      : null;
                    return (
                      <tr key={position.security.symbol}>
                        <td>
                          <button
                            type="button"
                            className="table-security"
                            onClick={() => onOpenSecurity(position.security)}
                          >
                            <strong>{position.security.symbol}</strong>
                            <small>{position.security.name}</small>
                          </button>
                        </td>
                        <td>{position.quantity.toLocaleString()}</td>
                        <td>{formatPrice(position.averagePrice, position.security.currency)}</td>
                        <td>
                          {formatPrice(position.latestClose, position.security.currency)}
                          <small>{position.lastMarketDate}</small>
                        </td>
                        <td>
                          {dailyMovement ? (
                            <>
                              <strong
                                className={
                                  dailyMovement.positionChange >= 0
                                    ? "positive"
                                    : "negative"
                                }
                              >
                                {formatPrice(
                                  dailyMovement.positionChange,
                                  position.security.currency,
                                )}
                              </strong>
                              <small>
                                {formatPercent(
                                  dailyMovement.priceChangePercent,
                                )}{" "}
                                price · {dailyMovement.date}
                              </small>
                            </>
                          ) : (
                            <span className="forecast-pending">
                              After two saved closes
                            </span>
                          )}
                        </td>
                        <td className="forecast-cell">
                          {outlook ? (
                            <>
                              <strong>
                                {formatPrice(
                                  outlook.p50,
                                  position.security.currency,
                                )}
                              </strong>
                              <small>
                                {outlook.date} ·{" "}
                                {formatPrice(
                                  outlook.p10,
                                  position.security.currency,
                                )}
                                {" – "}
                                {formatPrice(
                                  outlook.p90,
                                  position.security.currency,
                                )}
                              </small>
                              <small className={outlookChange !== null && outlookChange >= 0 ? "positive" : "negative"}>
                                {outlookChange === null
                                  ? ""
                                  : `${formatPercent(outlookChange)} vs last close`}
                              </small>
                            </>
                          ) : (
                            <span className="forecast-pending">
                              {forecasting
                                ? `Generating ${outlookHorizon}-session forecast…`
                                : `Run a ${outlookHorizon === 60 ? "60" : "20"}-session forecast`}
                            </span>
                          )}
                        </td>
                        <td>
                          {outlook
                            ? formatPrice(
                                position.quantity * outlook.p50,
                                position.security.currency,
                              )
                            : "—"}
                        </td>
                        <td>{formatPrice(positionValue, position.security.currency)}</td>
                        <td className={positionValue >= positionCost ? "positive" : "negative"}>
                          {formatPercent(positionChange)}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button type="button" onClick={() => onEditPosition(position)}>
                              Edit
                            </button>
                            <button type="button" onClick={() => onRemovePosition(position.security.symbol)}>
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {dailyHistory.length > 0 && (
              <details className="forecast-details portfolio-history">
                <summary>View saved daily price changes</summary>
                <div className="table-scroll">
                  <table>
                    <caption>Saved end-of-day portfolio price changes</caption>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Stock</th>
                        <th>Adjusted close</th>
                        <th>Price move</th>
                        <th>Position move</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dailyHistory.slice(0, 100).map((movement) => (
                        <tr key={`${movement.symbol}-${movement.date}`}>
                          <td>{movement.date}</td>
                          <td>{movement.symbol}</td>
                          <td>
                            {formatPrice(
                              movement.adjustedClose,
                              movement.position.security.currency,
                            )}
                          </td>
                          <td
                            className={
                              movement.priceChange >= 0 ? "positive" : "negative"
                            }
                          >
                            {formatPrice(
                              movement.priceChange,
                              movement.position.security.currency,
                            )}
                            <small>
                              {formatPercent(movement.priceChangePercent)} from{" "}
                              {movement.previousDate}
                            </small>
                          </td>
                          <td
                            className={
                              movement.positionChange >= 0
                                ? "positive"
                                : "negative"
                            }
                          >
                            {formatPrice(
                              movement.positionChange,
                              movement.position.security.currency,
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        ) : (
          <div className="tracking-empty">
            <span aria-hidden="true">₹</span>
            <div>
              <h3>No paper positions yet</h3>
              <p>Open a stock in Research or Stock explorer, then choose “Add holding.”</p>
            </div>
          </div>
        )}
      </section>

      <section className="watchlist-section" aria-labelledby="watchlist-heading">
        <div className="tracking-section-heading">
          <div>
            <p className="step-label">WATCHLIST</p>
            <h2 id="watchlist-heading">Stocks to revisit</h2>
          </div>
          <span>{watchlist.length} of 20 stocks</span>
        </div>
        {watchlist.length ? (
          <div className="watchlist-grid">
            {watchlist.map((item) => (
              <article key={item.security.symbol} className="watchlist-card">
                <div>
                  <p>{item.security.symbol} · {item.security.exchange}</p>
                  <h3>{item.security.name}</h3>
                </div>
                <div className="watchlist-price">
                  <span>Last adjusted close</span>
                  <strong>{formatPrice(item.latestClose, item.security.currency)}</strong>
                  <small>Through {item.lastMarketDate}</small>
                </div>
                <div className="watchlist-actions">
                  <button type="button" className="primary-button secondary" onClick={() => onOpenSecurity(item.security)}>
                    Open research
                  </button>
                  <button type="button" className="text-button" onClick={() => onRemoveWatchlist(item)}>
                    Remove
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="tracking-empty">
            <span aria-hidden="true">☆</span>
            <div>
              <h3>Your watchlist is empty</h3>
              <p>Open a stock, then choose “Add to watchlist” beside its market date.</p>
            </div>
          </div>
        )}
      </section>

      <p className="tracking-disclaimer">
        Daily prices are saved locally at 4:00 PM Asia/Kolkata only on exchange
        trading days, using the provider's latest available adjusted close.
        Weekends and exchange holidays do not trigger captures or create
        synthetic market prices. Values and selected-horizon p10-p90 forecasts
        are not live quotes, guarantees, or brokerage records. This feature
        does not place orders or provide investment advice.
      </p>
    </section>
  );
}
