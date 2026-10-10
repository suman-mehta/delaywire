import assert from 'node:assert';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { DelaywireServer } from '../src/server.js';
import { RuleRegistry } from '../src/rules.js';

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        const duration = performance.now() - start;
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          duration
        });
      });
    });
    req.on('error', (err) => {
      const duration = performance.now() - start;
      resolve({
        error: err,
        duration
      });
    });
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Delaywire Integration Smoke Tests ---');

  // Test 1: Fixed Delay & Default Mock Body
  {
    console.log('[Test 1] Testing fixed latency injection (120ms)...');
    const server = new DelaywireServer({
      port: 19851,
      host: '127.0.0.1',
      silent: true,
      globalLatency: { type: 'fixed', baseMs: 120 }
    });
    await server.start();

    const res = await makeRequest('http://127.0.0.1:19851/api/health');
    assert.strictEqual(res.status, 200, 'Expected status 200');
    assert(res.duration >= 110, `Duration should be >= 110ms, was ${res.duration.toFixed(2)}ms`);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.delaywire, 'ok');
    assert.strictEqual(parsed.injectedLatencyMs, 120);

    await server.stop();
    console.log('  -> PASS');
  }

  // Test 2: Custom Rules Matching
  {
    console.log('[Test 2] Testing custom path and method matching...');
    const registry = new RuleRegistry(null, { type: 'fixed', baseMs: 0 });
    registry.setRules([
      {
        id: 'user_checkout',
        method: 'POST',
        path: '/v1/orders',
        status: 201,
        body: { orderId: 'ord_9988', status: 'created' },
        latency: { type: 'fixed', baseMs: 50 }
      },
      {
        id: 'wildcard_get',
        method: 'GET',
        path: '/users/*',
        status: 200,
        body: { user: 'found' },
        latency: { type: 'fixed', baseMs: 10 }
      }
    ]);

    const server = new DelaywireServer({
      port: 19852,
      host: '127.0.0.1',
      silent: true,
      ruleRegistry: registry
    });
    await server.start();

    // Test POST /v1/orders
    const res1 = await makeRequest('http://127.0.0.1:19852/v1/orders', { method: 'POST' });
    assert.strictEqual(res1.status, 201);
    const body1 = JSON.parse(res1.body);
    assert.strictEqual(body1.orderId, 'ord_9988');
    assert(res1.duration >= 45, `Order request should take >= 45ms, was ${res1.duration.toFixed(2)}ms`);

    // Test Wildcard GET /users/42
    const res2 = await makeRequest('http://127.0.0.1:19852/users/42', { method: 'GET' });
    assert.strictEqual(res2.status, 200);
    const body2 = JSON.parse(res2.body);
    assert.strictEqual(body2.user, 'found');

    await server.stop();
    console.log('  -> PASS');
  }

  // Test 3: Chaos Fault Injection
  {
    console.log('[Test 3] Testing chaos injection (100% 504 Gateway Timeout)...');
    const server = new DelaywireServer({
      port: 19853,
      host: '127.0.0.1',
      silent: true,
      globalLatency: {
        type: 'fixed',
        baseMs: 10,
        chaos: { rate: 1.0, action: 'error_504' }
      }
    });
    await server.start();

    const res = await makeRequest('http://127.0.0.1:19853/payment');
    assert.strictEqual(res.status, 504);
    assert.strictEqual(res.headers['x-delaywire-fault'], 'gateway_timeout');
    assert(res.body.includes('504 Gateway Timeout'));

    await server.stop();
    console.log('  -> PASS');
  }

  // Test 4: Transparent Reverse Proxy Mode with Latency Injection
  {
    console.log('[Test 4] Testing reverse proxy forwarding with injected delay...');
    // 4a. Create mock upstream backend
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ upstreamAck: true, originalPath: req.url }));
    });
    await new Promise(r => upstream.listen(19854, '127.0.0.1', r));

    // 4b. Create Delaywire proxy targeting the upstream with 80ms added delay
    const proxy = new DelaywireServer({
      port: 19855,
      host: '127.0.0.1',
      silent: true,
      proxy: 'http://127.0.0.1:19854',
      globalLatency: { type: 'fixed', baseMs: 80 }
    });
    await proxy.start();

    const res = await makeRequest('http://127.0.0.1:19855/inventory/check?sku=123');
    assert.strictEqual(res.status, 200);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.upstreamAck, true);
    assert.strictEqual(parsed.originalPath, '/inventory/check?sku=123');
    assert(res.duration >= 75, `Proxied request duration should be >= 75ms, was ${res.duration.toFixed(2)}ms`);
    assert.strictEqual(res.headers['x-delaywire-latency'], '80ms');

    await proxy.stop();
    await new Promise(r => upstream.close(r));
    console.log('  -> PASS');
  }

  console.log('\n[SUCCESS] All smoke tests passed cleanly.');
}

runTests().catch((err) => {
  console.error('\n[FAIL] Smoke tests failed:', err);
  process.exit(1);
});
