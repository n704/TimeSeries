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
  adjustedClose: number;
  positionValue: number;
}

interface PortfolioSnapshotChartProps {
  position: PortfolioPosition;
}

export function buildPortfolioSnapshotChartData(
  position: PortfolioPosition,
): PortfolioSnapshotChartDatum[] {
  return [...(position.priceHistory ?? [])]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((snapshot) => ({
      date: snapshot.date,
      adjustedClose: snapshot.adjustedClose,
      positionValue: snapshot.adjustedClose * position.quantity,
    }));
}

export function getPortfolioSnapshotChartDomain(
  position: PortfolioPosition,
): [number, number] {
  const values = [
    position.averagePrice,
    ...(position.priceHistory ?? []).map(
      (snapshot) => snapshot.adjustedClose,
    ),
  ];
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
  position,
}: PortfolioSnapshotChartProps) {
  const data = buildPortfolioSnapshotChartData(position);
  if (!data.length) return null;

  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: position.security.currency,
    maximumFractionDigits: 2,
  });
  const first = data[0];
  const latest = data[data.length - 1];
  const domain = getPortfolioSnapshotChartDomain(position);

  return (
    <article className="snapshot-chart-card">
      <div className="snapshot-chart-card-heading">
        <div>
          <p>
            {position.security.symbol} · {position.security.exchange}
          </p>
          <h4>{position.security.name}</h4>
        </div>
        <div className="snapshot-chart-latest">
          <span>Latest saved close</span>
          <strong>{formatter.format(latest.adjustedClose)}</strong>
        </div>
      </div>
      <div
        className="snapshot-chart-shell"
        role="img"
        aria-label={`${position.security.symbol} saved adjusted-close snapshot chart from ${first.date} through ${latest.date}`}
      >
        <ResponsiveContainer width="100%" height={250}>
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
              width={76}
              stroke="#6f8379"
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              labelFormatter={(label) => dateLabel(String(label))}
              formatter={(value) => [
                formatter.format(Number(value)),
                "Adjusted close",
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
              y={position.averagePrice}
              stroke="#bd7d2a"
              strokeDasharray="5 5"
              ifOverflow="extendDomain"
              label={{
                value: "Average price",
                fill: "#8a5c20",
                fontSize: 11,
                position: "insideTopRight",
              }}
            />
            <Line
              type="monotone"
              dataKey="adjustedClose"
              name="Adjusted close"
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
          {data.length} saved {data.length === 1 ? "session" : "sessions"}
        </span>
        <span>
          Position value {formatter.format(latest.positionValue)}
        </span>
      </div>
    </article>
  );
}
