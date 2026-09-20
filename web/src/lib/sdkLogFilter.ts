// The Telnyx SDK logs call-quality diagnostics straight to console.warn in
// addition to emitting `telnyx.warning`, which the app surfaces on the active
// call. Drop the duplicate console lines so the console stays useful.

const SDK_NOISE = ["CallReportCollector:", "CallRecorder:", "CallReport:"];

let installed = false;

export function filterSdkConsoleNoise(): void {
  if (installed || typeof console === "undefined") return;
  installed = true;

  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string" && SDK_NOISE.some((prefix) => first.includes(prefix))) return;
    originalWarn(...args);
  };
}
