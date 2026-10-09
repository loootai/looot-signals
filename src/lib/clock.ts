/** true when the app runs on sample data with no looot token. */
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

/** The demo has a fixed clock, so every number on screen is the same on every machine. */
export const DEMO_NOW = "2026-10-10T09:00:00.000Z";

/** The current time. Fixed in demo mode. */
export function now(): Date {
  return IS_DEMO ? new Date(DEMO_NOW) : new Date();
}
