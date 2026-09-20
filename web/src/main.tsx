import { ThemeProvider } from "next-themes";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { filterSdkConsoleNoise } from "./lib/sdkLogFilter";
import "./styles/globals.css";

// The SDK logs quality diagnostics to console.warn as well as emitting
// `telnyx.warning` (surfaced on the active call); drop the duplicate lines.
filterSdkConsoleNoise();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
