// ─────────────────────────────────────────────────────────────────────────────
// Freno de intentos de login por llave (email|IP), en memoria de proceso.
// ponytail: suficiente para un puñado de clientes en una instancia; si algún
// día hay réplicas, mover el contador a Postgres.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

export class LoginThrottle {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private now: () => number = Date.now) {}

  /** true si este intento está permitido (y lo cuenta). */
  allowed(key: string): boolean {
    const t = this.now();
    const e = this.hits.get(key);
    if (!e || t >= e.resetAt) {
      this.hits.set(key, { count: 1, resetAt: t + WINDOW_MS });
      return true;
    }
    e.count++;
    if (this.hits.size > 10_000) this.prune(t); // techo de memoria
    return e.count <= MAX_ATTEMPTS;
  }

  /** Un login correcto limpia el contador de esa llave. */
  clear(key: string): void {
    this.hits.delete(key);
  }

  private prune(t: number): void {
    for (const [k, e] of this.hits) if (t >= e.resetAt) this.hits.delete(k);
  }
}

export const loginThrottle = new LoginThrottle();
