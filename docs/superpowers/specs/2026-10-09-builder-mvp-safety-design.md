# Builder first MVP safety foundations

The user approved starting the backend work identified in the complete PRD audit. This first independently reviewable slice addresses diagnostic secret handling, deterministic sensitive-change approval, and the first-phase node boundary. It preserves the native workflow runtime, existing immutable Run evidence, publication fencing and graph checkpoints. ENG-1178 tracks this slice. Frontend source changes are outside this slice.

## Intended behavior

1. Fix diagnosis receives a sanitized copy of failed-node input/output/error data. Original native and Builder Run records remain unchanged. Redaction occurs before prompt truncation and includes known credential values found in the graph, authorization/header/query containers, and explicit sensitive-key fields at arbitrary nesting depth. Error text must not repeat known graph credentials. Benign diagnostic values, including falsey values, remain available. Launch failures and node failures use the same boundary. This does not promise detection of every unknown secret embedded in arbitrary business prose.
2. A model-authored low-risk verdict cannot permit automatic replacement of models, credentials, API input/output contracts, resource references or data-access configuration. Compare actual intended before/after changes, so an unchanged model included in a whole-node config replacement is not treated as a switch. Existing structural and external-node guards remain. Sensitive changes require the existing explicit repair approval rather than introducing a second frontend-specific flow.
3. Builder candidates and final writes refuse new Knowledge Retrieval, old HITL and legacy Agent nodes. First-phase Knowledge Retrieval binding/configuration is prohibited. Historical legacy Agent/HITL nodes may remain and receive otherwise permitted fixes; merely containing such nodes must not invalidate every edit. New Agent node addition remains unavailable until the separate published-resource/binding integration is implemented; a fabricated v2 discriminator cannot authorize an Agent reference.
4. Rejected proposals are explained through the existing corrective/error path and never silently remove unrelated valid graph changes. Existing Start/End, Code, LLM, List Operator, branches and container-marker support remain valid.

## Architecture

Use focused policies in existing Builder owners. A diagnostic context adapter in `services/dify_builder` owns model-facing sanitization and is called by the real Fix cognition path. A deterministic mutation policy compares graph configuration before/after and feeds the existing risk gate. A Builder node-policy owner is invoked during candidate preflight and again at the draft-write boundary. Domain policy must not alter shared cmd+K generation semantics.

An alternative was to change only prompt instructions. That cannot guarantee that the model respects the boundary. A second alternative was to replace the runtime with a new executor; that unnecessarily duplicates native validation and evidence owners. Focused deterministic policies are the chosen approach.

## Constraints

- Base source: `3e0e486d35a4ac402facbef3b877e86adf9dbf35` on `feat/dify-builder`.
- Product changes are backend-only; frontend gaps remain recorded.
- Do not rewrite or delete original native Runs, failed Runs, published versions or unrelated graph configuration.
- Preserve tenant/app/actor ownership and execution-revision CAS checks.
- Do not change shared cmd+K behavior or graphon dependencies.
- No secret plaintext in diagnostic prompts or new logging.
- Run backend commands through `uv run --project api`; integration tests remain CI-owned.
- Reuse `/Users/chongbinyao/dify/dify/api/.venv` with `UV_PROJECT_ENVIRONMENT` and `--no-sync`; do not change dependency manifests/locks.
- Keep source changes in this isolated worktree; release only after independent review and meaningful checks.

## Testing and review

Regression tests must first fail against the real owner path. Tests should capture the production diagnosis prompt with a stubbed external LLM call, assert secret absence and useful diagnostic retention, and assert that input objects remain byte-for-byte unchanged. Mutation tests cover both sensitive changes and unchanged fields in whole-node replacements. Node-boundary tests cover both preflight proposals and the real draft-write entry, including historical forbidden nodes retained without changes and known supported native nodes.

Known limits are explicit: these policies do not complete default Mock/Dry Run execution, live-call account/target consent, cancellation, adaptive DSL recovery, Conversation/Task persistence, resource discovery or administrator configuration. Those are separate architectural slices from the audited backend roadmap, not silently claimed complete by ENG-1178.
