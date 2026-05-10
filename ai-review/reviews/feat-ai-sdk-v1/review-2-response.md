# Review Response: feat-ai-sdk-v1 — Round 2

> Response to `reviews/feat-ai-sdk-v1/review-2.md`.

## Summary

| 嚴重度 | 找到 | 已修 | 不修 |
|---|---|---|---|
| [P1] | 1 | 1 | 0 |
| [P2] | 1 | 1 | 0 |

Both findings are second-order bugs introduced by the round-1 fixes (cookie
auth + middleware error catching). Codex caught what tests would have only
caught in real-Dify integration runs.

## Findings 處理紀錄

---

### Finding 1: [P1] Preserve host-prefixed CSRF cookie names

- **Severity**: [P1]
- **Codex 描述**:
  > In HTTPS Dify deployments without `COOKIE_DOMAIN`, Dify sets and later
  > expects `__Host-csrf_token`; `console_login` accepts that cookie, but
  > subsequent console calls always send `csrf_token`, so `check_csrf_token`
  > sees a header/cookie mismatch and every app import/key/delete call
  > returns 401.
- **影響檔案**: `gateway/src/gateway/dify/client.py` (`_console_cookies`)
- **動作**: ✅ Fixed

#### 驗證

Confirmed by re-reading `api/libs/token.py`:
- `_real_cookie_name()` returns `__Host-<name>` when ``is_secure()`` and no
  custom ``COOKIE_DOMAIN``.
- `extract_csrf_token_from_cookie()` uses that resolved name.
- `check_csrf_token()` requires header value == cookie value, with the cookie
  read by the `_real_cookie_name`-aware extractor.

So on HTTPS deployments without `COOKIE_DOMAIN`, our R1 fix would:
- Read `__Host-csrf_token` from login response ✓
- Send X-CSRF-Token header value correctly ✓
- ❌ But send the cookie back as `csrf_token` (bare), which the server's
  cookie extractor doesn't find — it looks for `__Host-csrf_token` only.
- Result: cookie missing → mismatch → 401.

R1 happened to pass tests because tests used bare cookie names. The
host-prefixed fixture only verified login *parsed* the cookie, not that it
round-tripped on subsequent calls.

#### 修復內容

`ConsoleSession` now records the resolved cookie names in two new fields:

```python
@dataclass(frozen=True)
class ConsoleSession:
    access_token: str
    csrf_token: str
    access_token_cookie_name: str = "access_token"     # or "__Host-access_token"
    csrf_token_cookie_name: str = "csrf_token"         # or "__Host-csrf_token"
```

`console_login` now uses `_read_cookie_with_name()` (returns value + actual
name found). `_console_cookies()` echoes both names verbatim. The
`X-CSRF-Token` header name itself is fixed (per Dify's
`HEADER_NAME_CSRF_TOKEN = "X-CSRF-Token"` constant); only cookie names vary.

#### Tests

- Extended `test_console_login_supports_host_prefixed_cookies` to assert
  cookie names round-trip into the session.
- New regression `test_console_calls_echo_host_prefixed_cookie_names`
  asserts that `console_import_app` (and by extension api-key + delete,
  which share `_console_cookies`) sends `__Host-` prefixed cookie names on
  the wire when the session was built from a host-prefixed login.

#### Commit

- `11ee42a44` fix(gateway): preserve __Host- cookie name prefix in ConsoleSession (R2-P1)

---

### Finding 2: [P2] Handle streaming upstream failures before response start

- **Severity**: [P2]
- **Codex 描述**:
  > When `stream=true`, the Dify request is only opened inside `event_source()`
  > after `StreamingResponse` has already started sending a 200 SSE response.
  > If Dify returns a non-2xx response or times out before the first chunk,
  > the `GatewayError` handler can no longer turn it into the intended
  > 502/504 JSON envelope, leaving clients with a broken stream/ASGI
  > exception instead of the documented error mapping.
- **影響檔案**: `gateway/src/gateway/routers/chat.py`,
  `gateway/src/gateway/dify/client.py`
- **動作**: ✅ Fixed

#### 驗證

Walked through ASGI lifecycle:
1. Router constructs `StreamingResponse(event_source(), ...)`.
2. Starlette flushes status 200 + `text/event-stream` headers immediately
   (lazy body iteration).
3. Iterator runs only when client reads the body. `dify_client.chat_messages_streaming(...)` enters its `httpx.stream()` context **inside** the iterator,
   so HTTP errors happen mid-iteration.
4. Exception inside `event_source()` propagates up but cannot be retroactively
   converted to a different status code; the connection just terminates.

This violates R7 (error mapping) — clients see "200 OK + EOF" instead of the
502/504 JSON envelope they should get.

#### 修復內容

Refactored upstream API to support pre-flight failure detection:

- `DifyClient.chat_messages_streaming(...)` (async generator) →
  `DifyClient.open_chat_stream(...)` (`@asynccontextmanager`).
  - Entering the context performs the HTTP request *and* the status check.
  - Non-2xx triggers `DifyUpstreamError` at context-entry, before yielding.
  - Yield value is an inner async iterator over SSE lines.
  - Iteration-time `httpx` errors still raise `DifyTimeoutError` /
    `DifyUpstreamError`, but those are best-effort because the response is
    already in flight by then.

- `routers/chat.py` (streaming branch):
  - Acquire the cm via `dify_client.open_chat_stream(...)`.
  - `await cm.__aenter__()` synchronously — failures here propagate to the
    global `GatewayError` handler → proper 502/504 JSON envelope.
  - On success, wrap iteration in `StreamingResponse` with a `finally:` that
    closes the cm.

#### Tests

- New `test_streaming_dify_5xx_returns_502_json_not_broken_sse` —
  fixture sets `streaming_pre_flight_error = DifyUpstreamError(...)`, asserts
  HTTP status is 502, content-type is JSON (not SSE), and body matches the
  OpenAI envelope.
- New `test_streaming_dify_timeout_returns_504_json` — same with
  `DifyTimeoutError`.
- New unit test `test_open_chat_stream_raises_before_yielding_on_5xx` /
  `test_open_chat_stream_raises_on_connect_timeout` confirm the cm raises at
  entry, not iteration.
- Existing `test_streaming_yields_openai_chunks` /
  `test_streaming_passes_conversation_id_to_dify` updated for the new
  fake API surface.

#### Commit

- `35ba9eea7` fix(gateway): streaming pre-flight catches upstream errors
  before SSE starts (R2-P2)

---

## 整體決策

- 走完 Round 2 後狀態：**進 polish stage**（review-3 可選）
- Round 2 引入 [P1] = 1 → Round 1 引入 [P1] = 1，**收斂中**：每輪剩餘問題
  都源於前一輪的修法，且具體針對性下降（R1 找架構性錯誤，R2 找前一輪實作細
  節）。
- 是否再跑一輪 review-3？
  - **建議跑**：兩個 R2 修法都引入了新公開 API（`ConsoleSession.*_cookie_name`
    欄位、`open_chat_stream` cm），值得 codex 看一次有沒有遺漏的整合點
    （e.g. `app_manager.py` 是否還有用 jwt 字串的舊路徑、router 沒被改到的
    部分）。
  - 如果 review-3 沒新 [P1]，進 polish + open PR。

## 預備 Round 3 的觀察點

預期 codex review-3 可能提出：
1. `event_source` 的 `__aexit__(None, None, None)` 在 finally 是否會吞掉
   iteration 的真正例外？
2. 新的 `_read_cookie_with_name` 在多重 `Set-Cookie` header 順序下行為？
3. `ConsoleSession.access_token_cookie_name` 預設值用 bare name；如果首次
   login 失敗且後續測試只構造空 session，會送錯名嗎？（測試覆蓋足夠）
