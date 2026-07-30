# Agent identity branch development diary

## Scope

This diary preserves the pre-rewrite history of `demo/agent-identity`, rewritten from 52 commits after `cae2e1b059`. The branch contains two deliverables:

1. unified tracing for Agent v2 execution, including Agent Apps, workflow Agent nodes, human waits, Workflow-as-Tool parentage, and Agent Monitor controls;
2. a Docker Compose SPIFFE/SPIRE mTLS demo for Swagger API Tools, while retaining Dify's Squid SSRF boundary.

## Design references

- [Local Agent development setup](../specs/2026-07-29-agent-local-dev-setup-design.md)
- [Agent unified tracing design](../specs/2026-07-29-agent-unified-tracing-design.md)
- [Agent unified tracing plan](../plans/2026-07-29-agent-unified-tracing.md)
- [Workflow-as-Tool parent fix design](../specs/2026-07-29-agent-workflow-tool-trace-parenting-fix-design.md)
- [Workflow-as-Tool parent fix plan](../plans/2026-07-29-agent-workflow-tool-trace-parenting-fix.md)
- [Agent run-context fix design](../specs/2026-07-29-agent-run-id-context-injection-fix-design.md)
- [SPIFFE Swagger Tool demo design](../specs/2026-07-29-spiffe-swagger-tool-demo-design.md)
- [SPIFFE Swagger Tool demo plan](../plans/2026-07-29-spiffe-swagger-tool-demo.md)

## Decisions and reversals

- Agent trace capture is provider-neutral and fail-open: normalized fragments are private trace state, with fixed redaction and bounding before persistence.
- Human waits are a unified trace semantic. Workflow waits survive pause/resume in private state; Agent App waits correlate two message traces rather than creating an invalid cross-trace parent.
- Workflow-as-Tool uses the normalized Agent tool-call span as an opaque parent-context key, preserving the existing retry and linked-root fallback behavior.
- The Agent Monitor reuses App tracing configuration; it adds no Agent-specific provider storage or API.
- The local Agent development wiring is retained with tracing because it provides the source-based Agent backend and sandbox path used by the integration.
- The SPIFFE demo uses one shared egress workload identity. It deliberately does not claim per-logical-Agent identity, does not change Dify business code, and keeps Squid in the request path.
- The demo was adjusted after runtime verification to use branch-built API, Web, and Agent Backend images; share the generated API secret with `api_websocket`; avoid the Plugin Daemon host debug-port collision; and expose only the protected ingress test port for host-side rejection checks.

## Final organization

- `docs(trace)`: the tracing, local-development, and history documentation.
- `feat(trace)`: source development wiring plus unified Agent tracing implementation and tests.
- `docs(spiffe)`: SPIFFE demo design, plan, and operator guide.
- `feat(spiffe)`: Compose overlay, SPIRE/Envoy infrastructure, Tool fixture, and verification.

## Original commit ledger

| Commit | Subject |
| --- | --- |
| `370ca7740a` | docs(dev): design local agent setup workflow |
| `a320a74e09` | test(dev): define local agent setup contract |
| `7750e4d8a7` | feat(dev): add local agent sandbox middleware |
| `3fb1bf4048` | fix(dev): bridge internal agent sandbox through proxy |
| `d29a5e45b4` | feat(dev): prepare source agent backend |
| `d20d9d82d5` | fix(dev): authenticate agent Redis connection |
| `473e28facd` | fix(dev): keep agent proxy on IPv4 upstreams |
| `fe795548d1` | fix(dev): forward agent stub authorization |
| `2711cf6afb` | docs(trace): define agent unified tracing semantics |
| `343eaf2c99` | docs: plan agent unified tracing |
| `2f9ef59310` | docs: correct tracing plan test path |
| `2de1a25a13` | docs(trace): define agent workflow tool parenting |
| `6c53f8ba31` | docs: plan agent workflow tool trace parenting |
| `641b2631a1` | feat(trace): define agent semantic event contracts |
| `b3ee16e672` | feat(trace): collect agent run fragments |
| `a574749c13` | feat(trace): normalize human wait records |
| `3375ad9fcc` | feat(trace): add canonical human wait spans |
| `d407afd8b6` | feat(trace): build agent run spans |
| `de35b38fec` | feat(trace): normalize agent tool calls |
| `590424e77d` | feat(trace): normalize agent tool results |
| `84cc3df0c5` | feat(trace): build human wait spans |
| `ea78741dc4` | feat(trace): collect workflow agent fragments |
| `d964f1e8d9` | docs(trace): record implementation progress |
| `b8162071a2` | feat(trace): gate workflow agent collection |
| `76570bae61` | feat(trace): propagate agent tool span context |
| `6f4f90719a` | docs(trace): record workflow tool progress |
| `b382295188` | feat(trace): retain private workflow trace state |
| `b0c1999875` | feat(trace): merge agent fragments into message traces |
| `d373d1fca1` | feat(trace): dispatch agent app fragments |
| `4bad48508e` | feat(trace): retain workflow agent waits across pauses |
| `e9685cc323` | feat(trace): correlate agent app human waits |
| `60b6489d31` | feat(trace): publish workflow global timeouts |
| `8ab439186a` | feat(web): expose tracing controls in agent monitor |
| `01a469b1bc` | docs(trace): finalize unified tracing boundaries |
| `91262b14a4` | fix(trace): merge agent deltas and pair tool results |
| `661d85b30e` | docs(trace): design workflow tool parent fix |
| `26fe5ad50f` | docs(trace): plan workflow tool parent fix |
| `36324cf7d8` | fix(trace): preserve workflow tool parent context |
| `120b79158f` | docs(trace): design agent run context fix |
| `0dccfb2707` | fix(trace): inject agent run context by layer name |
| `e94171f8ed` | fix(trace): normalize execution context after HTTP parsing |
| `8704a6bea0` | docs: add SPIFFE Swagger tool demo design |
| `3ba7b005d2` | docs: plan SPIFFE Swagger tool demo |
| `6f3b17ef80` | feat: add SPIFFE demo test tool |
| `d3e0ab72d8` | feat: add SPIFFE protected tool demo |
| `28c1456aa0` | docs: use local Dify demo images |
| `88f9ee242e` | fix: avoid demo plugin debug port conflict |
| `f052fefde9` | fix: use local API image for websocket service |
| `f8edc65962` | fix: share generated secret with websocket service |
| `50fdc24c86` | fix: align demo agent backend with local API |
| `de25fa3587` | feat: expose protected tool ingress for host checks |
| `12c4d85a2f` | feat: enable unified tracing in SPIFFE demo |
