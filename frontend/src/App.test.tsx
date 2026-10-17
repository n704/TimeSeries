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

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("introduces the forecast workflow and stock search", () => {
    render(<App />);

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
    const security = {
      symbol: "RELIANCE.NS",
      name: "Reliance Industries Limited",
      exchange: "NSE",
      region: "India",
      currency: "INR",
      instrument_type: "common_stock" as const,
      timezone: "Asia/Kolkata",
    };
    apiMocks.searchSecurities.mockResolvedValue([security]);
    apiMocks.getHistory.mockResolvedValue({
      security,
      prices: [{ date: "2026-10-16", adjusted_close: 1211.2 }],
      metadata: {
        provider: "Fixture",
        retrieved_at: "2026-10-17T00:00:00Z",
        last_market_date: "2026-10-16",
        is_stale: false,
      },
    });
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
