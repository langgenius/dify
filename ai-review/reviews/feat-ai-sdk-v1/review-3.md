# Codex Review #3 — feat-ai-sdk-v1

> Codex CLI v0.130.0, `model_reasoning_effort=high`.

## Summary

The gateway misses the documented `extra_body.llm_model` selection path and
does not shape schema validation failures as OpenAI-compatible errors. These
are functional compatibility issues for the newly added API surface.

## Full review comments

- [P2] Honor `extra_body.llm_model` when selecting the Dify app —
  `gateway/src/gateway/routers/chat.py:135`
  When clients follow the spec/README and send `extra_body={"llm_model": "m2"}`,
  the OpenAI SDK places that as a top-level `llm_model` field, but this path
  always validates and builds the app from `body.model`. In that scenario
  model switching is ignored, or the request can 404 if `model` is just a
  placeholder while `llm_model` is enabled for the customer.

- [P2] Map request validation failures to the OpenAI error envelope —
  `gateway/src/gateway/main.py:115-117`
  Requests that fail FastAPI/Pydantic validation before entering the router,
  such as missing `messages` or an out-of-range `temperature`, bypass this
  `GatewayError` handler and return FastAPI's default 422 `detail` payload.
  That breaks the gateway's OpenAI-compatible/R7 error contract for common
  invalid client inputs; add a `RequestValidationError` handler that returns
  the expected 400-style OpenAI error envelope.

## Convergence note

Round 3 surfaced **0 [P1]** findings. Per the convergence rule
(`Round N+1 沒新 [P1]` → progress to polish), this round is the gating
round. Both [P2] findings are spec compliance gaps (R3 + R7) and were
addressed before declaring done.
