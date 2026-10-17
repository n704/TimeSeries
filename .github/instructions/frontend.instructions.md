---
description: React, API state, chart, responsiveness, and accessibility rules
applyTo: "frontend/**/*.{ts,tsx,css}"
---

# Frontend instructions

- Keep network access in `src/api/client.ts`; components consume typed domain
  data from `src/types.ts`.
- Preserve the public backend field names at the API boundary. Convert data only
  when preparing a view model such as chart data.
- Abort pending search, history, and forecast requests when their owning input
  changes or the component unmounts.
- Never let a response for a previous symbol overwrite the current security.
- Clear old history and forecast state before loading a new security.
- Keep historical range and forecast horizon as independent controls.
- Charts must show historical adjusted close before forecasting and add the
  median plus p10-p90 band after forecasting.
- Preserve accessible names, focus movement after a successful forecast,
  `aria-live` status, keyboard controls, and the forecast table alternative.
- Do not rely on color alone for trend or chart meaning.
- Verify layouts at desktop and 390 px width without horizontal page overflow.
- Do not add provider keys, Hugging Face credentials, model code, or checkpoint
  paths to the browser bundle.

Validation:

```bash
cd frontend
npm test
npm run build
```
