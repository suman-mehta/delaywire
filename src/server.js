import http from 'node:http';
import https from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { RuleRegistry } from './rules.js';

/**
 * Delaywire Core Server
 */
export class DelaywireServer {
  constructor(options = {}) {
    this.port = Number(options.port || 8080);
    this.host = options.host || '127.0.0.1';
    this.tlsKeyPath = options.tlsKey || null;
    this.tlsCertPath = options.tlsCert || null;
    this.upstreamProxy = options.proxy || null;
    this.silent = Boolean(options.silent);
    this.ruleRegistry = options.ruleRegistry || new RuleRegistry(null, options.globalLatency);
    this.stats = {
      requests: 0,
      faults: 0,
      totalDelayMs: 0,
      activeConnections: 0
    };

    this._server = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      const requestHandler = (req, res) => this._handleRequest(req, res);

      if (this.tlsKeyPath && this.tlsCertPath) {
        if (!existsSync(this.tlsKeyPath) || !existsSync(this.tlsCertPath)) {
          return reject(new Error('Specified TLS key or certificate file does not exist'));
        }
        const tlsOptions = {
          key: readFileSync(this.tlsKeyPath),
          cert: readFileSync(this.tlsCertPath)
        };
        this._server = https.createServer(tlsOptions, requestHandler);
      } else {
        this._server = http.createServer(requestHandler);
      }

      this._server.on('connection', (socket) => {
        this.stats.activeConnections++;
        socket.on('close', () => {
          this.stats.activeConnections--;
        });
      });

      this._server.on('error', reject);
      this._server.listen(this.port, this.host, () => {
        resolve({
          port: this.port,
          host: this.host,
          isHttps: Boolean(this.tlsKeyPath && this.tlsCertPath)
        });
      });
    });
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (!this._server) return resolve();
      if (typeof this._server.closeIdleConnections === 'function') {
        this._server.closeIdleConnections();
      }
      this._server.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async _handleRequest(req, res) {
    const startTime = performance.now();
    this.stats.requests++;

    const rule = this.ruleRegistry.match(req.method, req.url);
    const engine = rule ? rule.latencyEngine : this.ruleRegistry.defaultEngine;

    // 1. Calculate Latency
    const delayMs = engine.computeDelay();
    this.stats.totalDelayMs += delayMs;

    // 2. Check Chaos Condition
    const injectChaos = engine.shouldInjectChaos();
    const chaosAction = injectChaos ? engine.getChaosAction() : null;

    if (injectChaos) {
      this.stats.faults++;
    }

    // 3. Apply Simulated Latency Wait
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    if (res.writableEnded || req.destroyed) {
      return;
    }

    // 4. Handle Chaos Trigger if applicable
    if (injectChaos) {
      this._log(req.method, req.url, `CHAOS:${chaosAction}`, delayMs);
      return this._executeChaos(chaosAction, req, res);
    }

    // 5. Route to Target (Mock Response OR Reverse Proxy Pass)
    const targetProxy = (rule && rule.proxyPass) || this.upstreamProxy;
    if (targetProxy) {
      return this._proxyRequest(req, res, targetProxy, startTime, delayMs);
    }

    // 6. Serve Mock Response
    const status = rule ? rule.status : 200;
    const headers = (rule && rule.headers) ? { ...rule.headers } : { 'Content-Type': 'application/json' };
    const body = rule ? rule.body : JSON.stringify({
      delaywire: 'ok',
      url: req.url,
      method: req.method,
      injectedLatencyMs: delayMs
    });

    headers['x-delaywire-latency'] = `${delayMs}ms`;
    res.writeHead(status, headers);
    res.end(body);

    this._log(req.method, req.url, status, delayMs);
  }

  _executeChaos(action, req, res) {
    switch (action) {
      case 'hang':
      case 'hangup':
        req.socket?.destroy();
        break;
      case 'reset':
        if (typeof req.socket?.resetAndDestroy === 'function') {
          req.socket.resetAndDestroy();
        } else {
          req.socket?.destroy();
        }
        break;
      case 'error_502':
        res.writeHead(502, { 'Content-Type': 'text/plain', 'x-delaywire-fault': 'bad_gateway' });
        res.end('Delaywire Fault Injection: 502 Bad Gateway');
        break;
      case 'error_504':
        res.writeHead(504, { 'Content-Type': 'text/plain', 'x-delaywire-fault': 'gateway_timeout' });
        res.end('Delaywire Fault Injection: 504 Gateway Timeout');
        break;
      case 'empty':
        res.writeHead(200, { 'Content-Length': '0' });
        res.end();
        break;
      case 'error_500':
      default:
        res.writeHead(500, { 'Content-Type': 'text/plain', 'x-delaywire-fault': 'internal_error' });
        res.end('Delaywire Fault Injection: 500 Internal Server Error');
        break;
    }
  }

  _proxyRequest(clientReq, clientRes, upstreamBase, startTime, injectedDelayMs) {
    let targetUrl;
    try {
      if (clientReq.url.startsWith('http://') || clientReq.url.startsWith('https://')) {
        targetUrl = new URL(clientReq.url);
      } else {
        const base = upstreamBase.endsWith('/') ? upstreamBase : `${upstreamBase}/`;
        const rel = clientReq.url.startsWith('/') ? clientReq.url.slice(1) : clientReq.url;
        targetUrl = new URL(rel, base);
      }
    } catch (err) {
      clientRes.writeHead(500, { 'Content-Type': 'text/plain' });
      return clientRes.end(`Invalid upstream URL configuration: ${err.message}`);
    }

    const isHttps = targetUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const proxyHeaders = { ...clientReq.headers, host: targetUrl.host };
    delete proxyHeaders['accept-encoding'];

    const proxyOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: clientReq.method,
      headers: proxyHeaders,
      timeout: 30000
    };

    const upstreamReq = transport.request(proxyOptions, (upstreamRes) => {
      const responseHeaders = { ...upstreamRes.headers };
      responseHeaders['x-delaywire-latency'] = `${injectedDelayMs}ms`;
      responseHeaders['x-delaywire-proxied-to'] = targetUrl.origin;

      clientRes.writeHead(upstreamRes.statusCode, responseHeaders);
      upstreamRes.pipe(clientRes);

      upstreamRes.on('end', () => {
        this._log(clientReq.method, clientReq.url, upstreamRes.statusCode, injectedDelayMs, `-> ${upstreamBase}`);
      });
    });

    upstreamReq.on('error', (err) => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'Content-Type': 'application/json' });
        clientRes.end(JSON.stringify({
          error: 'Delaywire Upstream Connection Failure',
          message: err.message,
          target: upstreamBase
        }));
      }
      this._log(clientReq.method, clientReq.url, 502, injectedDelayMs, `[FAILED: ${err.message}]`);
    });

    clientReq.on('close', () => {
      if (!upstreamReq.destroyed) {
        upstreamReq.destroy();
      }
    });

    clientReq.pipe(upstreamReq);
  }

  _log(method, url, status, delayMs, extra = '') {
    if (this.silent) return;
    const timestamp = new Date().toISOString().substring(11, 23);
    const statusTag = String(status).padEnd(10, ' ');
    process.stdout.write(`[${timestamp}] ${method.padEnd(7)} ${url.padEnd(25)} | ${statusTag} | +${delayMs}ms ${extra}\n`);
  }
}
