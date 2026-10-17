import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ForecastPoint, PricePoint } from "../types";

interface ChartDatum {
  date: string;
  historical?: number;
  forecast?: number;
  interval?: [number, number];
  sma20?: number;
  sma50?: number;
}

interface PriceChartProps {
  history: PricePoint[];
  forecast?: ForecastPoint[];
  currency: string;
  showMovingAverages: boolean;
}

function movingAverage(
  history: PricePoint[],
  index: number,
  window: number,
): number | undefined {
  if (index + 1 < window) return undefined;
  const values = history.slice(index + 1 - window, index + 1);
  return values.reduce((sum, point) => sum + point.adjusted_close, 0) / window;
}

export function buildChartData(
  history: PricePoint[],
  forecast: ForecastPoint[] = [],
): ChartDatum[] {
  const historical: ChartDatum[] = history.map((point, index) => ({
    date: point.date,
    historical: point.adjusted_close,
    sma20: movingAverage(history, index, 20),
    sma50: movingAverage(history, index, 50),
  }));
  if (!forecast.length || !history.length) return historical;

  const latest = history.at(-1);
  if (latest) {
    historical[historical.length - 1] = {
      ...historical[historical.length - 1],
      forecast: latest.adjusted_close,
      interval: [latest.adjusted_close, latest.adjusted_close],
    };
  }
  return [
    ...historical,
    ...forecast.map((point) => ({
      date: point.date,
      forecast: point.p50,
      interval: [point.p10, point.p90] as [number, number],
    })),
  ];
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

export function PriceChart({
  history,
  forecast = [],
  currency,
  showMovingAverages,
}: PriceChartProps) {
  const data = buildChartData(history, forecast);
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
  const dividerDate = forecast.length ? history.at(-1)?.date : undefined;

  return (
    <div
      className="chart-shell"
      role="img"
      aria-label={
        forecast.length
          ? "Historical adjusted closing prices and TimesFM forecast with uncertainty range"
          : "Historical adjusted closing prices"
      }
    >
      <ResponsiveContainer width="100%" height={430}>
        <ComposedChart
          data={data}
          margin={{ top: 16, right: 16, bottom: 12, left: 4 }}
        >
          <defs>
            <linearGradient id="uncertainty" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6f8cff" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#6f8cff" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#26324c" strokeDasharray="3 6" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={dateLabel}
            minTickGap={34}
            stroke="#8490a8"
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={["auto", "auto"]}
            tickFormatter={(value: number) => formatter.format(value)}
            width={80}
            stroke="#8490a8"
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            labelFormatter={(label) => dateLabel(String(label))}
            formatter={(value, name) => {
              if (Array.isArray(value)) {
                return `${formatter.format(Number(value[0]))} - ${formatter.format(Number(value[1]))}`;
              }
              return [formatter.format(Number(value)), name];
            }}
            contentStyle={{
              background: "#111a2d",
              border: "1px solid #33415f",
              borderRadius: "12px",
            }}
          />
          <Legend />
          {forecast.length > 0 && (
            <Area
              dataKey="interval"
              name="p10-p90 range"
              stroke="none"
              fill="url(#uncertainty)"
              connectNulls
            />
          )}
          <Line
            type="monotone"
            dataKey="historical"
            name="Adjusted close"
            stroke="#f0f3f9"
            strokeWidth={2.2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          {showMovingAverages && (
            <>
              <Line
                type="monotone"
                dataKey="sma20"
                name="20-session average"
                stroke="#f7b267"
                strokeWidth={1.5}
                strokeDasharray="5 5"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="sma50"
                name="50-session average"
                stroke="#54d2b0"
                strokeWidth={1.5}
                strokeDasharray="2 5"
                dot={false}
              />
            </>
          )}
          {forecast.length > 0 && (
            <Line
              type="monotone"
              dataKey="forecast"
              name="TimesFM median"
              stroke="#6f8cff"
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
            />
          )}
          {dividerDate && (
            <ReferenceLine
              x={dividerDate}
              stroke="#7f8ba4"
              strokeDasharray="4 4"
              label={{ value: "Forecast", fill: "#aeb8cc", position: "insideTopRight" }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
