export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e: any) {
      lastErr = e;
      const code = Number(e?.status || e?.code || 0);
      if ([429, 500, 502, 503, 504].includes(code) || i < tries - 1) {
        await new Promise(r => setTimeout(r, 400 * (i + 1) ** 2));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}
