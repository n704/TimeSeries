import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PortfolioPosition } from "../types";

interface PortfolioSnapshotChartDatum {
  date: string;
  marketValue: number;
  updatedPositions: number;
}

interface PortfolioSnapshotChartProps {
  positions: PortfolioPosition[];
}

export function buildPortfolioSnapshotChartData(
  positions: PortfolioPosition[],
): PortfolioSnapshotChartDatum[] {
  if (!positions.length) return [];

  const holdings = positions.map((position) => ({
    position,
    history: [...(position.priceHistory ?? [])].sort((left, right) =>
      left.date.localeCompare(right.date),
    ),
  }));
  if (holdings.some(({ history }) => history.length === 0)) return [];

  const firstCompleteDate = holdings.reduce(
    (latest, { history }) =>
      history[0].date > latest ? history[0].date : latest,
    holdings[0].history[0].date,
  );
  const dates = Array.from(
    new Set(
      holdings.flatMap(({ history }) =>
        history
          .filter((snapshot) => snapshot.date >= firstCompleteDate)
          .map((snapshot) => snapshot.date),
      ),
    ),
  ).sort();

  return dates.map((date) => {
    let marketValue = 0;
    let updatedPositions = 0;
    for (const { position, history } of holdings) {
      let latestClose: number | null = null;
      let updatedOnDate = false;
      for (const snapshot of history) {
        if (snapshot.date > date) break;
        latestClose = snapshot.adjustedClose;
        updatedOnDate = snapshot.date === date;
      }
      if (latestClose === null) continue;
      marketValue += latestClose * position.quantity;
      if (updatedOnDate) updatedPositions += 1;
    }
    return { date, marketValue, updatedPositions };
  });
}

export function getPortfolioSnapshotChartDomain(
  positions: PortfolioPosition[],
): [number, number] {
  const data = buildPortfolioSnapshotChartData(positions);
  const costBasis = positions.reduce(
    (total, position) =>
      total + position.averagePrice * position.quantity,
    0,
  );
  const values = [costBasis, ...data.map((snapshot) => snapshot.marketValue)];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum;
  const isEffectivelyFlat =
    range <= Math.max(Math.abs(maximum), 1) * 0.0001;
  const padding = isEffectivelyFlat
    ? Math.max(maximum * 0.05, 1)
    : range * 0.08;
  return [Math.max(0, minimum - padding), maximum + padding];
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

export function PortfolioSnapshotChart({
  positions,
}: PortfolioSnapshotChartProps) {
  const data = buildPortfolioSnapshotChartData(positions);
  if (!data.length) return null;

  const currency = positions[0].security.currency;
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
  const costBasis = positions.reduce(
    (total, position) =>
      total + position.averagePrice * position.quantity,
    0,
  );
  const first = data[0];
  const latest = data[data.length - 1];
  const domain = getPortfolioSnapshotChartDomain(positions);
  const positionLabel =
    positions.length === 1 ? "1 position" : `${positions.length} positions`;

  return (
    <article className="snapshot-chart-card">
      <div className="snapshot-chart-card-heading">
        <div>
          <p>ENTIRE PAPER PORTFOLIO</p>
          <h4>
            {positions.length} tracked{" "}
            {positions.length === 1 ? "position" : "positions"}
          </h4>
        </div>
        <div className="snapshot-chart-latest">
          <span>Latest saved value</span>
          <strong>{formatter.format(latest.marketValue)}</strong>
        </div>
      </div>
      <div
        className="snapshot-chart-shell"
        role="img"
        aria-label={`Entire portfolio saved value chart from ${first.date} through ${latest.date} for ${positionLabel}`}
      >
        <ResponsiveContainer width="100%" height={340}>
          <LineChart
            data={data}
            margin={{ top: 20, right: 18, bottom: 8, left: 0 }}
          >
            <CartesianGrid
              stroke="#dce9e1"
              strokeDasharray="3 6"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tickFormatter={dateLabel}
              minTickGap={24}
              stroke="#6f8379"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={domain}
              tickFormatter={(value: number) => formatter.format(value)}
              width={90}
              stroke="#6f8379"
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              labelFormatter={(label) => dateLabel(String(label))}
              formatter={(value) => [
                formatter.format(Number(value)),
                "Portfolio value",
              ]}
              contentStyle={{
                background: "#082f25",
                border: "1px solid #27614e",
                borderRadius: "12px",
                color: "#f3fff7",
              }}
              itemStyle={{ color: "#f3fff7" }}
              labelStyle={{ color: "#d2e7da" }}
            />
            <ReferenceLine
              y={costBasis}
              stroke="#bd7d2a"
              strokeDasharray="5 5"
              ifOverflow="extendDomain"
              label={{
                value: "Cost basis",
                fill: "#8a5c20",
                fontSize: 11,
                position: "insideTopRight",
              }}
            />
            <Line
              type="monotone"
              dataKey="marketValue"
              name="Portfolio value"
              stroke="#0b8f60"
              strokeWidth={2.5}
              dot={data.length <= 12 ? { r: 3, fill: "#0b8f60" } : false}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="snapshot-chart-meta">
        <span>
          {data.length} saved portfolio{" "}
          {data.length === 1 ? "session" : "sessions"}
        </span>
        <span>
          Latest capture refreshed {latest.updatedPositions} of{" "}
          {positions.length} positions
        </span>
      </div>
    </article>
  );
}
