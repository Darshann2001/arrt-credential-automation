# IP Blocking and Rate Limiting Investigation — ARRT

**Status:** limited observation; blocking behavior under load **not measured**  
**Date:** 2026-11-17  
**Target:** `https://www.arrt.org/pages/verify-credentials` and its AJAX endpoints  
**Scope:** document what was actually observed, what the monitoring code does,
and why no proxy rotation or IP switching is implemented

---

## 1. What was actually observed

Only public, low-volume page access was performed. Two successful public GETs
were made in total; one was instrumented:

```text
http_code=200 dns=0.178970s connect=0.351810s tls=1.078555s
ttfb=1.379615s total=2.293149s size=77138
```

Observed on that request:

| Signal | Result |
| --- | --- |
| HTTP status | `200` |
| DNS / TCP / TLS | all completed |
| TTFB | 1.380 s |
| Total | 2.293 s |
| Body size | 77,138 bytes |
| `403` | not observed |
| `429` | not observed |
| `Retry-After` | not observed |
| CAPTCHA challenge after page load | the page contains a reCAPTCHA widget, as expected |
| Rate-limit headers | none observed |

This is **not** evidence that ARRT never blocks, throttles or rate-limits
clients. It only establishes that these two page loads succeeded from this
network at that time.

`robots.txt` currently reads:

```text
User-agent: *
Allow: /
Disallow: /Search
```

The search AJAX path used by the page is `/VerifyCredentials/SearchByName`,
which is not the disallowed `/Search` path. That distinction does **not**
constitute permission to automate searches; it is recorded only as an observed
fact about the published robots policy.

---

## 2. What is not known

The following were **not** measured and must not be presented as findings:

- the request rate at which ARRT returns `403` or `429`;
- whether ARRT uses per-IP, per-session or global limits;
- whether blocked responses include `Retry-After`;
- whether CAPTCHA difficulty increases under load;
- whether the egress IP is shared, NATed or otherwise ambiguous;
- whether ARRT publishes or expects a declared crawler identity;
- whether the production search endpoint adds latency or throttling not present
  on the static page.

No request was sent to `/VerifyCredentials/SearchByName`, because that would
require a valid CAPTCHA token and an authorized search. No attempt was made to
provoke a block.

---

## 3. Why no proxy rotation or IP switching

The project brief prohibits proxy rotation and IP switching. There are also
practical and ethical reasons:

- Rotating IPs to avoid a block is evasion, not resilience.
- It can violate the site’s terms and any future authorization.
- It would make incident evidence unreliable: a success after rotation would
  not show that the original identity was acceptable.
- The correct response to a denial is to stop and contact the site owner.

The implementation therefore:

- never discovers the host’s public IP;
- never launches a proxy;
- never changes user agent, headers or network identity to avoid a block;
- only accepts an optional **caller-supplied IP label** for grouping
  observations, defaulting to `unattributed`.

---

## 4. Monitoring implemented

### 4.1 Request monitor

`backend/src/automation/monitoring/request-monitor.js` records per request:

- timestamp;
- method and URL;
- HTTP status;
- duration;
- attempt and retry count;
- outcome (`success`, `access_denied`, `rate_limited`, `captcha`, `timeout`,
  `connection_error`, `http_error`, `unknown`);
- CAPTCHA presence and type;
- error code;
- optional IP label.

It summarizes `403`, `429`, all `4xx`, all `5xx`, CAPTCHA count, timeout count,
connection-failure count, retry totals, status counts and duration
min/max/average/p50/p95. It does not store cookies, tokens, CAPTCHA responses
or form values.

### 4.2 Error monitor

`backend/src/automation/monitoring/error-monitor.js` classifies:

`timeout`, `connection_failure`, `dns_failure`, `tls_failure`, `access_denied`,
`rate_limited`, `captcha`, `authorization`, `extraction_failure`,
`browser_unavailable`, `provider_failure`, `circuit_open`, `unknown`.

Node error codes such as `ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`,
`ECONNRESET`, `ETIMEDOUT`, `CERT_HAS_EXPIRED` are mapped to those categories.
Stacks are omitted by default.

### 4.3 IP monitor

`backend/src/automation/monitoring/ip-monitor.js` aggregates a supplied label:

| Signal | Default effect |
| --- | --- |
| Any `403` (`denialThreshold: 1`) | `suspectedBlock: true`, recommendation `stop` |
| Two `429`s (`rateLimitThreshold: 2`) | `suspectedBlock: true`, recommendation `stop` |
| Any CAPTCHA (`captchaThreshold: 1`) | `suspectedBlock: true`, recommendation `stop` |

Its summary explicitly reports:

```json
{
  "rotationImplemented": false,
  "ipDiscoveryImplemented": false,
  "recommendation": "stop"
}
```

### 4.4 Stop conditions

`collectRecords()` stops on the first of:

- `ACCESS_DENIED` — HTTP 403, by default `stopOnAccessDenial: true`;
- `RATE_LIMITED` — HTTP 429 after retries/`Retry-After` handling;
- `CAPTCHA_DETECTED` — by default `stopOnCaptcha: true`;
- `CIRCUIT_OPEN` — failure threshold reached;
- `REQUEST_TIMEOUT`;
- `PROVIDER_ERROR`;
- `EXTRACTION_FAILED`;
- `REQUEST_LIMIT_EXCEEDED`;
- `TARGET_REACHED`;
- `PLAN_EXHAUSTED`.

A 403 and a 424 are treated differently: 403 is access denial; 424 is the
observed CAPTCHA-failure status from the client script.

---

## 5. Pacing and retry behavior

Defaults in `backend/src/automation/config.js` are conservative **internal
safety values**, not ARRT limits:

| Setting | Default |
| --- | --- |
| Minimum interval between requests | 5,000 ms |
| Max requests per run | 100 |
| Max retries | 2 |
| Backoff base / factor / cap | 2,000 ms / 2 / 60,000 ms |
| Jitter | 0.2 |
| Circuit failure threshold | 3 |
| Circuit reset timeout | 60,000 ms |

`Retry-After` handling:

- accepts delta-seconds or an HTTP date;
- treats the header as authoritative;
- does **not** shorten it to the exponential cap;
- stops if it exceeds `maxRetryAfterMs` (default 300,000 ms) rather than retrying
  earlier than the server requested.

This behavior was verified with synthetic provider responses. It has **not**
been exercised against ARRT because no 403/429 response was observed.

---

## 6. Synthetic verification versus real observation

The automation test suite simulates `403`, `429`, timeouts and CAPTCHAs using
the mock provider. Those tests prove the control logic, not ARRT behavior.

| Scenario | Verified in tests | Observed from ARRT |
| --- | --- | --- |
| HTTP 200 page load | yes | yes (two GETs) |
| HTTP 403 stop | yes (synthetic) | no |
| HTTP 429 retry with `Retry-After` | yes (synthetic) | no |
| Timeout retry | yes (synthetic) | no |
| CAPTCHA stop | yes (synthetic) | widget observed on page; search not attempted |
| Circuit breaker open | yes (synthetic) | no |
| IP monitor stop recommendation | yes (synthetic) | no |

Full suite: **101/101 passing** (`npm test` in `backend/`).

---

## 7. Risks and open questions

| Risk | Why it matters | Current mitigation |
| --- | --- | --- |
| Unknown rate limit | Aggressive pacing could trigger a block | 5 s minimum interval, 100-request cap, stop on first denial |
| Shared egress IP | Other users could affect reputation | None; IP is not discovered or rotated |
| CAPTCHA escalation | Repeated failures may harden challenges | Stop on first CAPTCHA |
| Token/session coupling | Search may require the same browser session | Session manager exists; live flow not implemented |
| Terms of service | Automation may be restricted regardless of technical access | Written authorization required before live work |
| 424 ambiguity | CAPTCHA failure vs other server rejection | Client script shows 424 = CAPTCHA failure; server code not public |

Questions to resolve with ARRT before live collection:

1. Permitted request rate, concurrency and daily volume.
2. Expected identification (user agent, contact address, IP range).
3. Whether automated access to `/VerifyCredentials/SearchByName` is permitted.
4. Whether a CAPTCHA service is acceptable, and under what conditions.
5. Retention limits for name, city, state and credential string.

---

## 8. Conclusion

- No ARRT blocking incident was observed or claimed.
- The only measured network facts are two successful public page loads.
- Monitoring, pacing, retry and stop logic are implemented and tested offline.
- Proxy rotation and IP switching are intentionally absent.
- Live rate-limit behavior remains an **open dependency** pending written
  authorization and an approved load profile.
