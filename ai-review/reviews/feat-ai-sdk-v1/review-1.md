# Codex Review #1 — feat-ai-sdk-v1

> Codex CLI v0.130.0, `model_reasoning_effort=high`.
> Findings excerpt; full reasoning trace + diff dump preserved locally as
> `review-1.raw.md` (gitignored due to size — 510KB).

## Summary

The gateway cannot provision Dify Apps against the current Dify console
authentication flow, so normal first-use chat requests fail. Authentication
failures are also raised from middleware in a way that bypasses the
configured error handler.

## Full review comments

- [P1] Use Dify's cookie/CSRF session for console calls —
  `gateway/src/gateway/dify/client.py:177-181`
  With the current Dify console API, `POST /console/api/login` returns
  `{"result":"success"}` and sets the access/CSRF tokens as cookies rather
  than returning `data.access_token`. This makes every lazy App build fail
  at login with `Dify console login returned unexpected payload`; the
  subsequent console POSTs also need the CSRF cookie/header instead of only
  a bearer header.

- [P2] Return auth failures from middleware instead of raising —
  `gateway/src/gateway/middleware/auth.py:75-80`
  For missing or unknown SDK keys, this raises `InvalidSdkKeyError` from
  user middleware, which runs outside FastAPI's `ExceptionMiddleware`; the
  `@app.exception_handler(GatewayError)` handler will not render the
  intended 401 envelope, so these requests become 500s or propagated ASGI
  exceptions. Return the 401 response directly here or move auth into a
  dependency/route layer that FastAPI exception handlers wrap.
