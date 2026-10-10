import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { LatencyEngine } from './latency.js';

/**
 * Rule matcher and definition loader
 */
export class RuleRegistry {
  constructor(rulesFilePath = null, defaultGlobalProfile = {}) {
    this.rules = [];
    this.defaultEngine = new LatencyEngine(defaultGlobalProfile);
    if (rulesFilePath) {
      this.loadFromFile(rulesFilePath);
    }
  }

  loadFromFile(filePath) {
    const resolved = resolve(process.cwd(), filePath);
    if (!existsSync(resolved)) {
      throw new Error(`Rules file does not exist: ${resolved}`);
    }
    const raw = readFileSync(resolved, 'utf-8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.rules || [];
    this.rules = list.map((r, index) => this._normalizeRule(r, index));
  }

  setRules(rawRules) {
    this.rules = (rawRules || []).map((r, index) => this._normalizeRule(r, index));
  }

  _normalizeRule(rule, index) {
    let pathRegex = null;
    if (rule.path) {
      if (rule.path.startsWith('^') || rule.path.endsWith('$')) {
        pathRegex = new RegExp(rule.path);
      } else if (rule.path.includes('*')) {
        const escaped = rule.path
          .replace(/[-/\\^$*+?.()|\[\]{}]/g, '\\$&')
          .replace(/\\\*/g, '.*');
        pathRegex = new RegExp(`^${escaped}$`);
      } else {
        pathRegex = new RegExp(`^${rule.path.replace(/[-/\\^$*+?.()|\[\]{}]/g, '\\$&')}(/.*)?$`);
      }
    }

    return {
      id: rule.id || `rule_${index + 1}`,
      method: rule.method ? rule.method.toUpperCase() : null,
      path: rule.path || '*',
      pathRegex,
      status: Number(rule.status || 200),
      headers: rule.headers || { 'Content-Type': 'application/json' },
      body: typeof rule.body === 'object' && rule.body !== null ? JSON.stringify(rule.body, null, 2) : (rule.body ?? '{"status":"ok"}'),
      proxyPass: rule.proxyPass || null,
      latencyEngine: new LatencyEngine(rule.latency || {})
    };
  }

  match(reqMethod, reqUrl) {
    const urlPath = reqUrl.split('?')[0];
    const method = reqMethod.toUpperCase();

    for (const rule of this.rules) {
      if (rule.method && rule.method !== method && rule.method !== 'ALL') {
        continue;
      }
      if (rule.pathRegex && !rule.pathRegex.test(urlPath)) {
        continue;
      }
      return rule;
    }

    return null;
  }
}
