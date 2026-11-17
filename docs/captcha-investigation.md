# CAPTCHA Investigation — ARRT Verify Credentials

**Status:** investigation complete for the public page; no solver integrated  
**Date:** 2026-11-17  
**Target page:** `https://www.arrt.org/pages/verify-credentials`  
**Scope:** identify the CAPTCHA, document the observed client flow, assess 2Captcha
as a possible vendor, and record what remains blocked

---

## 1. Method and evidence

No authenticated or bulk search was performed. Evidence comes from:

| Evidence | Location | Size |
| --- | --- | --- |
| Saved public page HTML | `arrt-verify-page.html` (repository root) | 77,138 bytes |
| Saved public widget script | `verify-widget.js` (repository root) | 2,744 bytes |
| One public-page GET | measured with `curl` on 2026-11-17 | HTTP 200 |
| 2Captcha public documentation | `2captcha.com/p/recaptcha_v2`, `2captcha.com/api-docs/recaptcha-v2` | public web pages |

The single measured GET returned:

```text
http_code=200 dns=0.178970s connect=0.351810s tls=1.078555s
ttfb=1.379615s total=2.293149s size=77138
```

That timing is a **single sample**, not a performance benchmark for the search
endpoint.

---

## 2. What the page actually uses

The saved page contains:

```html
<script src="https://www.google.com/recaptcha/api.js" async defer></script>
...
<div class="g-recaptcha" data-sitekey="6LfPLVUgAAAAAD3jDodwRg5dovg_foUGn3nren3Q"></div>
```

Observed facts:

| Property | Observed value |
| --- | --- |
| Provider | Google reCAPTCHA |
| Widget type | **reCAPTCHA v2 checkbox** (`.g-recaptcha`, no `data-size="invisible"`) |
| Site key | `6LfPLVUgAAAAAD3jDodwRg5dovg_foUGn3nren3Q` |
| Script | `https://www.google.com/recaptcha/api.js` |
| Response accessor | `grecaptcha.getResponse()` |
| Reset accessor | `grecaptcha.reset()` |
| Form | `#searchForm` |
| Name inputs | `#firstname`, `#lastname` |
| Results container | `#searchList` |

There is also an ASP.NET anti-forgery field on the page:

```html
<input name="__RequestVerificationToken" type="hidden" value="..." />
```

The value is a per-session token and is **not** reproduced in this repository.
The saved HTML contains an expired/example value from the public page and must
not be treated as a usable credential.

---

## 3. Observed client-side flow

The saved `verify-widget.js` shows the complete client sequence:

1. `#searchForm` submit is intercepted by `searchCredentials`.
2. The submit button is disabled.
3. Client-side length checks run:
   - last name must be at least **2** characters;
   - first name must be at least **1** character.
4. `grecaptcha.getResponse()` is read.
5. If the response is empty, the page shows `Captcha is required` and aborts.
6. Otherwise `makeGrid(captchaResponse)` runs.
7. `makeGrid` issues:

```text
POST /VerifyCredentials/SearchByName
Header: RequestVerificationToken: <__RequestVerificationToken value>
Body:   firstName, lastName, captchaSuccessCode
```

8. On success the returned HTML replaces `#searchList`, and
   `grecaptcha.reset()` clears the widget.
9. On error:
   - HTTP **424** → `Captcha Failure. Please try again.`
   - any other status → `Failed to load Verify Credential Widget`.

A separate details flow exists:

```text
POST /VerifyCredentials/GetDisplayDetails
Header: RequestVerificationToken
Body:   key
```

It is not required for the name/city/state/credential fields targeted by this
project, but it confirms that the anti-forgery header is used consistently.

---

## 4. Server-side verification: what is proven and what is inferred

**Proven from public files:**

- The CAPTCHA response is read on the client and sent to the server as
  `captchaSuccessCode`.
- The client treats HTTP 424 as a CAPTCHA failure.
- Requests carry an anti-forgery token in a custom header.

**Inferred, not directly observed:**

- The server validates `captchaSuccessCode` with Google before running the
  search.
- A missing, expired, reused or invalid token produces HTTP 424.

The server implementation is not public, so the inference is based on the
client contract and the 424 branch. It must not be stated as a directly
observed server behavior.

---

## 5. 2Captcha assessment

### 5.1 Documented capability

2Captcha’s public documentation lists **reCAPTCHA v2** support. The documented
integration is:

- submit a task through `createTask` using a reCAPTCHA v2 task type
  (`RecaptchaV2TaskProxyless` or a proxy variant);
- supply the site key and page URL;
- poll `getTaskResult`;
- receive a token that the caller is expected to place into the page/form.

This is technically applicable to the observed widget shape (site key +
checkbox v2).

### 5.2 Pricing

The public pricing table displayed **$1 – $2.99 per 1,000** reCAPTCHA v2
solves. This is vendor marketing copy, not a quoted price for this project.

### 5.3 Latency

The public page displayed a solving-speed value of **“0s”**. That display is
**not a measured latency** and is not usable as a planning number. No paid
credits were purchased, so no task was submitted and no real solve time,
failure rate or retry rate was measured.

### 5.4 Prerequisites and integration work

A future integration would require, at minimum:

- a 2Captcha account and API key;
- purchased credits;
- outbound access to the 2Captcha API;
- the site key and page URL;
- code that injects the returned token into the reCAPTCHA widget or the
  application’s expected callback;
- handling of expiry/rejection, including the observed HTTP 424 path;
- a decision on whether the returned token is bound to the requesting
  browser/session/IP, which the vendor documentation does not settle for this
  site.

None of these steps has been performed.

### 5.5 Why no solver was integrated

- Written authorization from ARRT is not present.
- It is not established that automated CAPTCHA solving is within the scope of
  any future authorization.
- The project brief explicitly prohibits CAPTCHA bypass, token manipulation,
  stealth and anti-bot evasion until scope is confirmed.
- No credits were purchased.

The ARRT adapter therefore contains **no solver, no token injection and no
`grecaptcha` manipulation**. It stops when a CAPTCHA is detected.

---

## 6. Authorization question

Third-party solving is **not assumed to be authorized**. The open questions to
put to ARRT in writing are:

1. Does the authorized data-collection scope permit automated interaction with
   the public search form at all?
2. If so, is a human-in-the-loop or third-party CAPTCHA service acceptable?
3. Which request rate, concurrency and daily volume are permitted?
4. Which fields may be retained, and for how long?
5. Is the egress IP range expected to be declared in advance?

Until those are answered, the only supported behavior is: detect the CAPTCHA,
record it, stop.

---

## 7. Implemented behavior in this repository

| Behavior | Implementation |
| --- | --- |
| Detect reCAPTCHA v2 checkbox | `detectCaptchaInHtml()` in `backend/src/automation/page-handler.js` |
| Detect invisible variant separately | Same function; `requiresInteraction` flag |
| Detect hCaptcha / Turnstile | Same function, for future-proofing only |
| Record CAPTCHA occurrences | `request-monitor.js`, `error-monitor.js`, `ip-monitor.js` |
| Stop by default | `collectRecords()` → `STOP_REASONS.CAPTCHA_DETECTED` |
| Skip search when `stopOnCaptcha: false` | Search is skipped; it is never solved |
| Live ARRT fetch | Blocked by `authorization.confirmed`, reference, and CAPTCHA approval gates |
| The adapter always stops even when CAPTCHA is approved | `checkCaptchaApproval()` throws `CAPTCHA_REQUIRES_APPROVAL` with `implementedSolver: false` |

Relevant tests: 37 automation tests in
`backend/src/tests/automation.test.js`, including CAPTCHA detection, stop
behavior, monitor counts and adapter gating. Full suite: **101/101 passing**.

---

## 8. Findings summary

- The CAPTCHA is **reCAPTCHA v2 checkbox**, not v3 and not invisible.
- The response is a client-read token sent as `captchaSuccessCode` on an
  anti-forgery-protected AJAX POST.
- HTTP **424** is the observed CAPTCHA-failure signal in client code.
- 2Captcha supports this CAPTCHA family and prices it at **$1 – $2.99 per
  1,000**; real latency and failure rates were **not measured**.
- Automated solving is **not authorized** and is **not implemented**.
- The blocker is contractual/authorization, not just technical.

---

## 9. Not attempted

- Purchasing 2Captcha credits.
- Submitting a CAPTCHA task.
- Injecting or replaying a token.
- Calling `/VerifyCredentials/SearchByName` with a search payload.
- Measuring CAPTCHA solve latency or success rate.
- Testing whether tokens are bound to IP, user agent or session.
