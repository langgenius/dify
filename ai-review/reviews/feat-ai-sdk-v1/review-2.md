# Codex Review #2 — feat-ai-sdk-v1

> Codex CLI v0.130.0, `model_reasoning_effort=high`.
> Captured from terminal output (full reasoning trace omitted; only the
> findings block is preserved here).

## Summary

The gateway will fail to manage Dify apps in common secure deployments because
CSRF cookies are resent under the wrong name, and streaming upstream failures
bypass the intended error mapping. These are functional issues in newly added
code.

## Full review comments

- [P1] Preserve host-prefixed CSRF cookie names — `gateway/src/gateway/dify/client.py:298-299`
  In HTTPS Dify deployments without `COOKIE_DOMAIN`, Dify sets and later expects
  `__Host-csrf_token`; `console_login` accepts that cookie, but subsequent
  console calls always send `csrf_token`, so `check_csrf_token` sees a
  header/cookie mismatch and every app import/key/delete call returns 401.
  Store the cookie names from login or send the matching `__Host-` names when
  those were received.

- [P2] Handle streaming upstream failures before response start —
  `gateway/src/gateway/routers/chat.py:161-162`
  When `stream=true`, the Dify request is only opened inside `event_source()`
  after `StreamingResponse` has already started sending a 200 SSE response.
  If Dify returns a non-2xx response or times out before the first chunk, the
  `GatewayError` handler can no longer turn it into the intended 502/504 JSON
  envelope, leaving clients with a broken stream/ASGI exception instead of the
  documented error mapping.
