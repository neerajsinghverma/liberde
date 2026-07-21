export async function register() {
  // Vercel serverless has no long-lived process; the in-process scheduler
  // only makes sense when self-hosting.
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.VERCEL) {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
