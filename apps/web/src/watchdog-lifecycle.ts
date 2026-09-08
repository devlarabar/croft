import { keyFingerprint } from "./key-fingerprint";
import { reapDeadRuns } from "./watchdog";

declare global {
  var croftWatchdog: ReturnType<typeof setInterval> | undefined;
}

export function startWatchdog(): void {
  if (globalThis.croftWatchdog) return;
  console.log("TOKEN_ENC_KEY fp", keyFingerprint());
  globalThis.croftWatchdog = setInterval(() => {
    reapDeadRuns().catch((error) => console.error("watchdog", error));
  }, 60_000);
  globalThis.croftWatchdog.unref();
  process.once("exit", () => clearInterval(globalThis.croftWatchdog));
}
