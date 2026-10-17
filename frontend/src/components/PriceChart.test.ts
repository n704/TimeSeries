import { buildChartData } from "./PriceChart";

describe("buildChartData", () => {
  it("joins history to the forecast and preserves its uncertainty interval", () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      date: `2026-01-${String(index + 1).padStart(2, "0")}`,
      adjusted_close: 100 + index,
    }));

    const data = buildChartData(history, [
      { date: "2026-02-02", p10: 115, p50: 120, p90: 126 },
    ]);

    expect(data).toHaveLength(21);
    expect(data[19]).toMatchObject({
      historical: 119,
      forecast: 119,
      interval: [119, 119],
      sma20: 109.5,
    });
    expect(data[20]).toMatchObject({
      forecast: 120,
      interval: [115, 126],
    });
  });
});
