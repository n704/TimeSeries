import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import App from "./App";
import { ApiError } from "./api/client";

const apiMocks = vi.hoisted(() => ({
  createBacktest: vi.fn(),
  createForecast: vi.fn(),
  getHistory: vi.fn(),
  searchSecurities: vi.fn(),
}));

vi.mock("./api/client", () => ({
  ApiError: class ApiError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    readonly requestId: string;
    readonly details?: Record<string, unknown>;

    constructor(payload: {
      code: string;
      message: string;
      retryable: boolean;
      request_id: string;
      details?: Record<string, unknown>;
    }) {
      super(payload.message);
      this.code = payload.code;
      this.retryable = payload.retryable;
      this.requestId = payload.request_id;
      this.details = payload.details;
    }
  },
  ...apiMocks,
}));

vi.mock("./components/PriceChart", () => ({
  PriceChart: () => <div>Price chart</div>,
}));

const security = {
  symbol: "RELIANCE.NS",
  name: "Reliance Industries Limited",
  exchange: "NSE",
  region: "India",
  currency: "INR",
  instrument_type: "common_stock" as const,
  timezone: "Asia/Kolkata",
};

const historyResponse = {
  security,
  prices: [{ date: "2026-10-16", adjusted_close: 1211.2 }],
  metadata: {
    provider: "Fixture",
    retrieved_at: "2026-10-17T00:00:00Z",
    last_market_date: "2026-10-16",
    is_stale: false,
  },
};

const forecastResponse = {
  forecast_id: "fc_test",
  security,
  history: historyResponse.prices,
  forecast: Array.from({ length: 20 }, (_, index) => ({
    date: `2026-11-${String(index + 1).padStart(2, "0")}`,
    p10: 1190 + index,
    p50: 1220 + index * 2,
    p90: 1260 + index * 3,
  })),
  analysis: {
    latest_close: 1211.2,
    forecast_end: 1258,
    forecast_change_percent: 3.86,
    historical_change_5d_percent: 1.2,
    historical_change_20d_percent: 2.4,
    sma_20: 1200,
    sma_50: 1180,
    trend: "upward" as const,
    final_interval_width_percent: 8.5,
    summary: "The median forecast ends above the latest adjusted close.",
  },
  metadata: {
    horizon_trading_days: 20,
    context_observations: 1240,
    context_start_date: "2021-10-18",
    context_end_date: "2026-10-16",
    provider: "Fixture",
    backend: "fixture",
    model: "fixture-timesfm",
    model_version: "test",
    preprocessing_version: "1",
    generated_at: "2026-10-17T00:00:00Z",
    is_data_stale: false,
  },
  disclaimer: "Not financial advice.",
};

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getHistory.mockResolvedValue(historyResponse);
    apiMocks.createForecast.mockResolvedValue(forecastResponse);
  });

  it("defaults to NIFTY 50 research and automatically forecasts Reliance", async () => {
    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: /start with a market leader.*see the modeled range/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /nifty 50 research/i }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("button", { name: /Reliance Industries.*RELIANCE/i }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(apiMocks.getHistory).toHaveBeenCalledWith(
        "RELIANCE.NS",
        "1y",
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() =>
      expect(apiMocks.createForecast).toHaveBeenCalledWith(
        "RELIANCE.NS",
        20,
        expect.any(AbortSignal),
      ),
    );
    expect(
      await screen.findByRole("heading", {
        name: /positive median, overlapping downside/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/not a buy recommendation/i)).toBeInTheDocument();
  });

  it("keeps stock search available in the explorer tab", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /stock explorer/i }));

    expect(
      screen.getByRole("heading", {
        name: /see the trend.*understand the uncertainty/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /search by company or ticker/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/daily indian stock forecasts/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/reliance, infosys, or tcs/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/not financial advice/i)).toBeInTheDocument();
  });

  it("refreshes and forecasts when the active research preset is selected again", async () => {
    render(<App />);
    await waitFor(() => expect(apiMocks.createForecast).toHaveBeenCalledTimes(1));

    fireEvent.click(
      screen.getByRole("button", { name: /Reliance Industries.*RELIANCE/i }),
    );

    await waitFor(() => expect(apiMocks.getHistory).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(apiMocks.createForecast).toHaveBeenCalledTimes(2));
  });

  it("shows available and required trading days when forecast history is insufficient", async () => {
    const security = {
      symbol: "TRIVENIPT.NS",
      name: "Triveni Turbine Limited",
      exchange: "NSE",
      region: "India",
      currency: "INR",
      instrument_type: "common_stock" as const,
      timezone: "Asia/Kolkata",
    };
    apiMocks.searchSecurities.mockResolvedValue([security]);
    apiMocks.getHistory.mockResolvedValue({
      security,
      prices: [{ date: "2026-10-16", adjusted_close: 810 }],
      metadata: {
        provider: "Fixture",
        retrieved_at: "2026-10-17T00:00:00Z",
        last_market_date: "2026-10-16",
        is_stale: false,
      },
    });
    apiMocks.createForecast.mockRejectedValue(
      new ApiError({
        code: "INSUFFICIENT_HISTORY",
        message: "TRIVENIPT.NS does not have enough valid daily history.",
        retryable: false,
        request_id: "req_insufficient",
        details: {
          available_observations: 74,
          required_observations: 120,
        },
      }),
    );

    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /stock explorer/i }));
    fireEvent.change(
      screen.getByRole("combobox", { name: /search by company or ticker/i }),
      { target: { value: "Triveni" } },
    );
    await waitFor(() => expect(apiMocks.searchSecurities).toHaveBeenCalled());
    fireEvent.click(
      await screen.findByRole("button", { name: /Triveni Turbine Limited/i }),
    );
    await waitFor(() => expect(apiMocks.getHistory).toHaveBeenCalled());

    fireEvent.click(
      await screen.findByRole("button", { name: /generate forecast/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Available history: 74 trading days. Minimum required for prediction: 120 trading days.",
    );
  });

  it("back-checks the latest seven sessions against known prices", async () => {
    apiMocks.searchSecurities.mockResolvedValue([security]);
    apiMocks.createBacktest.mockResolvedValue({
      backtest_id: "bt_test",
      security,
      points: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(index + 8).padStart(2, "0")}`,
        actual: 1200 + index,
        p10: 1180 + index,
        p50: 1195 + index,
        p90: 1220 + index,
      })),
      metrics: {
        mean_absolute_error: 5,
        mean_absolute_percentage_error: 1.25,
        interval_coverage_percent: 85.71,
      },
      metadata: {
        holdout_sessions: 7,
        context_observations: 1240,
        context_start_date: "2021-10-18",
        context_end_date: "2026-10-07",
        provider: "Fixture",
        backend: "fixture",
        model: "fixture-timesfm",
        model_version: "test",
        preprocessing_version: "1",
        generated_at: "2026-10-17T00:00:00Z",
        is_data_stale: false,
      },
      disclaimer: "Historical holdout only.",
    });

    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: /stock explorer/i }));
    fireEvent.change(
      screen.getByRole("combobox", { name: /search by company or ticker/i }),
      { target: { value: "Reliance" } },
    );
    await waitFor(() => expect(apiMocks.searchSecurities).toHaveBeenCalled());
    fireEvent.click(
      await screen.findByRole("button", { name: /Reliance Industries Limited/i }),
    );
    await waitFor(() => expect(apiMocks.getHistory).toHaveBeenCalled());

    fireEvent.click(
      await screen.findByRole("button", {
        name: /back-check last 7 sessions/i,
      }),
    );

    const heading = await screen.findByRole("heading", {
      name: /historical back-check/i,
    });
    expect(apiMocks.createBacktest).toHaveBeenCalledWith(
      "RELIANCE.NS",
      expect.any(AbortSignal),
    );
    expect(screen.getByText("1.25%")).toBeInTheDocument();
    expect(screen.getByText("85.71%")).toBeInTheDocument();
    expect(
      screen.getByRole("table", {
        name: /predicted and actual prices for the holdout sessions/i,
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(heading).toHaveFocus());
  });
});
