# delaywire

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen.svg)](https://nodejs.org)
[![Zero-Dependencies](https://img.shields.io/badge/Dependencies-0-orange.svg)](#)

> **Zero-dependency microservice mock server with deterministic and heavy-tail latency injection**

---

## 🎯 The Problem
Modern microservices fail catastrophically during long-tail latency spikes, upstream socket hangs, and partial network partitions. Developers typically test against local stubs with zero latency or uniform delays that fail to simulate realistic distributed systems phenomena like Pareto-distributed p99 latency regressions, connection resets, and burst degradations. Delaywire gives engineering teams an instant, zero-dependency programmable mock server and chaos-injecting reverse proxy to validate service resilience, circuit breakers, and client timeouts locally and in CI/CD pipelines.

## ✨ Key Features
- **Zero External Dependencies**: Pure Node.js runtime primitives.
- **Production Grade**: Linted, exception-guarded, and CI/CD-friendly.
- **Fast Execution**: Minimal footprint with microsecond overhead.

# delaywire

> High-Precision Microservice Mock Server with Heavy-Tail & Chaos Latency Injection.

`delaywire` is a production-grade, zero-dependency Node.js CLI tool designed to test microservice resilience, client timeouts, retry policies, and circuit breakers. It simulates real-world distributed systems conditions like Pareto-distributed p99 latency spikes, socket hangups, connection resets, and burst degradations.

---

## Why Delaywire?

- **Zero External Dependencies:** Built entirely with Node.js standard runtime modules (`http`, `https`, `perf_hooks`, `util`). No npm baggage or CVE liabilities.
- **Statistically Realistic Latencies:** Uniform delays fail to reproduce long-tail microservice behavior. Delaywire supports **Pareto** (heavy-tail), **Gaussian/Normal** (jitter), and **Uniform** models.
- **Built-in Chaos Fault Injection:** Intermittently sever connections (`reset`), hang sockets (`hangup`), or return `500`, `502`, and `504` errors at a target percentage rate.
- **Dual Operating Modes:** Operates both as a **standalone mock stub** or as a **transparent reverse proxy** injecting latency and faults in front of real local/remote microservices.

---

## Installation

```bash
# Run directly with npx or install globally
npm install -g delaywire

# Or clone and run directly
node src/cli.js --help
```

---

## CLI Reference

```text
Usage: delaywire [options]

Options:
  -p, --port <number>          Port to bind server (default: 8080)
  -h, --host <string>          Host interface (default: 127.0.0.1)
  -c, --config <path>          Path to JSON rules file
  -d, --delay <ms>             Fixed delay in milliseconds (default: 0)
  -m, --mode <type>            Latency distribution: fixed, jitter, normal, pareto (default: fixed)
      --min <ms>               Minimum latency for jitter mode (default: 50)
      --max <ms>               Maximum latency for jitter/pareto mode (default: 500)
      --stddev <ms>            Standard deviation for normal mode (default: 30)
      --pareto-alpha <float>   Shape parameter for Pareto distribution (default: 1.5)
      --chaos-rate <float>     Chaos error rate between 0.0 and 1.0 (default: 0)
      --chaos-action <action>  Chaos type: error_500, error_502, error_504, hang, reset, empty
      --proxy <url>            Upstream proxy URL (transparent proxy with latency injection)
      --tls-key <path>         Path to TLS private key (.pem)
      --tls-cert <path>        Path to TLS certificate (.pem)
  -s, --silent                 Disable stdout request logging
      --help                   Show help message
```

---

## Examples & Usage

### 1. Simple Fixed-Delay Mock
```bash
delaywire --port 9000 --delay 200
```
Any incoming request receives a 200 JSON mock response delayed by exactly 200ms.

### 2. Heavy-Tail Pareto Latency Regression (Simulate p99/p99.9 spikes)
```bash
delaywire --port 8080 --mode pareto --delay 50 --max 5000 --pareto-alpha 1.3
```
Most requests resolve within 50–120ms, while long-tail requests occasionally spike up to 5,000ms.

### 3. Fault-Injecting Proxy in Front of a Real Backend
Inject a 150ms Gaussian delay and 5% probability of abrupt connection socket resets into an existing upstream service:
```bash
delaywire --port 3000 --proxy http://localhost:8000 --mode normal --delay 150 --stddev 30 --chaos-rate 0.05 --chaos-action reset
```

### 4. Route Configuration File (`routes.json`)
For declarative per-route mocks and latencies:

```json
{
  "rules": [
    {
      "id": "user_profile",
      "method": "GET",
      "path": "/api/users/*",
      "status": 200,
      "headers": { "Content-Type": "application/json" },
      "body": { "id": "usr_1", "name": "Alex Developer" },
      "latency": { "type": "fixed", "baseMs": 40 }
    },
    {
      "id": "payment_service",
      "method": "POST",
      "path": "/api/checkout",
      "latency": {
        "type": "jitter",
        "minMs": 300,
        "maxMs": 1200,
        "chaos": { "rate": 0.1, "action": "error_504" }
      }
    }
  ]
}
```

Start server with the ruleset:
```bash
delaywire --config ./routes.json --port 8080
```

---

## Verification & Testing

Run the built-in smoke tests:
```bash
node test/smoke.js
```

All tests validate latency accuracy using Node.js high-resolution monotonic clocks (`performance.now()`), route matching, chaos error injection, and reverse proxying.

---

## 📄 License
MIT License.
