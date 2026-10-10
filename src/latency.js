/**
 * Latency and Chaos Math Engine
 * Supports: fixed, uniform jitter, Gaussian/normal, and Pareto (heavy-tail) distributions,
 * as well as fault injection actions (TCP abort, socket hangup, HTTP status injection).
 */

export class LatencyEngine {
  constructor(profile = {}) {
    this.type = profile.type || 'fixed';
    this.baseMs = Number(profile.baseMs ?? 0);
    this.minMs = Number(profile.minMs ?? this.baseMs);
    this.maxMs = Number(profile.maxMs ?? this.baseMs);
    this.stdDev = Number(profile.stdDev ?? 20);
    this.paretoAlpha = Number(profile.paretoAlpha ?? 1.5);
    this.chaos = {
      rate: Number(profile.chaos?.rate ?? 0),
      action: profile.chaos?.action || 'error_500'
    };
  }

  /**
   * Compute calculated latency in milliseconds based on the configured model
   */
  computeDelay() {
    switch (this.type) {
      case 'fixed':
        return Math.max(0, this.baseMs);

      case 'jitter': {
        const min = Math.min(this.minMs, this.maxMs);
        const max = Math.max(this.minMs, this.maxMs);
        return Math.floor(min + Math.random() * (max - min + 1));
      }

      case 'gaussian':
      case 'normal': {
        // Box-Muller transform for normal distribution
        const u1 = Math.max(Number.EPSILON, Math.random());
        const u2 = Math.random();
        const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        const calculated = this.baseMs + z0 * this.stdDev;
        return Math.max(0, Math.round(calculated));
      }

      case 'pareto': {
        // Heavy-tailed distribution: X = x_m / (U ^ (1 / alpha))
        const u = Math.max(Number.EPSILON, Math.random());
        const xm = Math.max(1, this.baseMs);
        const paretoVal = xm / Math.pow(u, 1.0 / Math.max(0.1, this.paretoAlpha));
        const bounded = Math.min(this.maxMs > 0 ? this.maxMs : 60000, paretoVal);
        return Math.max(0, Math.round(bounded));
      }

      default:
        return Math.max(0, this.baseMs);
    }
  }

  /**
   * Check if a chaos fault should be triggered on this request
   */
  shouldInjectChaos() {
    if (this.chaos.rate <= 0) return false;
    return Math.random() < this.chaos.rate;
  }

  getChaosAction() {
    return this.chaos.action;
  }
}
