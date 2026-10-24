type Fetcher = typeof fetch;
export interface ApiOptions {
  base?: string;
  userAgent?: string;
  intervalMs?: number;
  timeoutMs?: number;
  retries?: number;
  fetcher?: Fetcher;
  sleep?: (ms: number) => Promise<void>;
}
export class ShikimoriApi {
  private options: Required<ApiOptions>;
  private lastRequest = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(options: ApiOptions = {}) {
    this.options = {
      base: 'https://shikimori.io',
      userAgent: 'AniRezik/0.3.0 (noncommercial metadata catalog)',
      intervalMs: 1000,
      timeoutMs: 20000,
      retries: 2,
      fetcher: fetch,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...options,
    };
    const parsed = new URL(this.options.base);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/'
    )
      throw new Error('API base должен быть HTTPS origin');
  }
  query(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
    const result = this.queue.then(() => this.request(query, variables));
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async request(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      const pause = this.options.intervalMs - (Date.now() - this.lastRequest);
      if (pause > 0) await this.options.sleep(pause);
      this.lastRequest = Date.now();
      let response: Response;
      try {
        response = await this.options.fetcher(`${this.options.base}/api/graphql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': this.options.userAgent },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
      } catch (error) {
        if (attempt === this.options.retries) throw error;
        await this.options.sleep(1000 * 2 ** attempt);
        continue;
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new Error('API вернул не JSON');
        }
      }
      if (response.status !== 429 && response.status < 500)
        throw new Error(`Shikimori HTTP ${response.status}`);
      if (attempt === this.options.retries)
        throw new Error(`Shikimori HTTP ${response.status}; повторы исчерпаны`);
      const retry = response.headers.get('retry-after');
      const retryMs = retry
        ? Number.isFinite(Number(retry))
          ? Number(retry) * 1000
          : Date.parse(retry) - Date.now()
        : 1000 * 2 ** attempt;
      if (retryMs > 60000)
        throw new Error(
          `Shikimori просит подождать ${Math.ceil(retryMs / 1000)} с. Повторите обновление позже.`,
        );
      await this.options.sleep(Math.max(1000, retryMs || 1000));
    }
    throw new Error('API недоступен');
  }
}
