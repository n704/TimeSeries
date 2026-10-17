import { render, screen } from "@testing-library/react";

import App from "./App";

describe("App", () => {
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
    expect(screen.getByText(/not financial advice/i)).toBeInTheDocument();
  });
});
