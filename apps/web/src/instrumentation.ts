export async function register() {
  if (process.env.NODE_ENV === "production" && process.env.DEV_NO_AUTH === "1") {
    throw new Error("DEV_NO_AUTH must not be enabled in production.");
  }
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWatchdog } = await import("./watchdog-lifecycle");
    startWatchdog();
  }
}
