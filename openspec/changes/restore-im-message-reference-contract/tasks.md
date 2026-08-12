## 1. Lock the public contract with failing tests

- [x] 1.1 Update Provider-neutral contract tests to require `MessageLocator.__supertype__ is str`, runtime `str` values, scalar equality and reconstruction through `MessageLocator(stored_value)` without a wrapper object; prove `MessageReference` is no longer exported and `MessageAccepted` exposes `.locator` without a `.reference` compatibility property.
- [x] 1.2 Add a shared black-box conformance helper that stores only `str(accepted.locator)` through a JSON/text boundary, discards the source adapter, reconstructs `MessageLocator`, and verifies applicable use with a newly created compatible adapter.
- [x] 1.3 Replace tests that instantiate or subclass `MessageReference`, inspect private locator fields, pickle it or deepcopy it with malformed/incompatible `MessageLocator` strings and scalar persistence round trips.
- [x] 1.4 Add Provider-focused private payload model conformance tests for all five Providers: `strict=True`, assignment mutation rejection, extra-field rejection, unsupported-version rejection, required no-default `v`/`p`, direct use of existing `IMProvider`, no sequence/mapping/container fields, and source-level verbatim retention of every field comment and authoritative Provider documentation URL fixed by the spec.
- [x] 1.5 Add shared codec conformance tests proving every private payload model exposes `encode() -> str` and `decode(value: str) -> Self`, every encoded locator is URL-safe Base64, and every decoder rejects invalid alphabet, malformed padding and invalid length without re-encoding decoded bytes.
- [x] 1.6 Add source-boundary tests proving adapters and helpers contain no duplicate model-to-JSON-to-URL-safe-Base64 or reverse conversion logic.
- [x] 1.7 Base64-decode one encoded locator per Provider in tests and assert the JSON object explicitly contains `v` and `p`, uses the exact required field set, and does not obtain either discriminator solely from a Pydantic default.

## 2. Restore the Provider-neutral boundary

- [x] 2.1 Replace the public marker class in `api/core/human_input_v2/im_provider/contracts.py` with the required verbatim comment block and `MessageLocator = NewType("MessageLocator", str)`; rename `MessageAccepted.reference` to `MessageAccepted.locator`, change `IMDynamicCardMessaging` signatures to `MessageLocator`, and retain neither a `MessageReference` alias nor a `reference` compatibility property.
- [x] 2.2 Update package exports, docstrings and import-boundary assertions so the shared package exposes no Provider locator model, codec, locator fields or concrete adapter dependencies.
- [x] 2.3 Align `define-im-provider-adapter-contracts` artifacts and its review stub with the implemented nominal-string reference and current `ResolvedForm` terminology, removing stale in-process/private-object wording without changing unrelated Provider contracts.

## 3. Implement Slack persistent references

- [x] 3.1 Add failing Slack property-based codec tests over `_LocatorPayload(v: Literal[1], p: Literal[IMProvider.SLACK], channel_id: str, message_ts: str)` with non-empty locator fields; verify `payload.decode(payload.encode()) == payload`, cover meaningful field boundaries, and do not compare outputs from separate `encode()` calls.
- [x] 3.2 Implement `encode()`/`decode()` on the private strict/frozen/extra-forbid Slack payload with required no-default `v`/`p`, direct `IMProvider.SLACK`, and the exact `channel_id`/`message_ts` comments and Slack `chat.update` URL fixed by the spec; remove `_SlackMessageLocator` inheritance, private dataclass dependence and external codec helpers.
- [x] 3.3 Return `MessageLocator(encoded_string)` only when the Slack send response contains both channel ID and message timestamp; do not perform an identity lookup or include team ID, client/app ID or message kind in the locator.
- [x] 3.4 Update Slack replacement to reject empty, malformed, unknown-version, wrong-Provider and incomplete locator references as `INVALID_REFERENCE` before Web API I/O, while preserving exact update, `STALE_REFERENCE`, `UNKNOWN` and no-replay semantics.
- [x] 3.5 Add Slack scalar round-trip tests across adapter recreation and remove all `in_process_reference`, private locator and bare `MessageReference()` expectations.

## 4. Complete Feishu and Lark persistent references

- [x] 4.1 Define exactly one shared private `_FeishuLarkLocatorPayload` with `ConfigDict(frozen=True, extra="forbid", strict=True)`, required no-default `v: Literal[1]`, required no-default `p: Literal[IMProvider.FEISHU, IMProvider.LARK]`, non-empty `message_id`, the exact Feishu and Lark official URLs fixed by the spec, no other fields, and the model-owned `encode()`/`decode()` methods; return and accept `MessageLocator`, and remove `_FeishuLarkMessageReference` and external codec helpers.
- [x] 4.2 Add Feishu/Lark property-based tests over the shared payload model verifying `payload.decode(payload.encode()) == payload`; retain examples for missing `v`/`p`, wrong/unknown Provider, unknown version, malformed Base64, malformed JSON, strict/extra validation, secret absence and scalar round trip across adapter recreation.
- [x] 4.3 Require the Feishu/Lark adapter to call `_FeishuLarkLocatorPayload.decode()`, verify `payload.p == self._provider`, and return `INVALID_REFERENCE` without Provider I/O for cross-Feishu/Lark locators; preserve exact-message replacement without private wrapper identity or a process-local registry.
## 5. Complete Microsoft Teams persistent references

- [x] 5.1 Implement the private strict/frozen/extra-forbid Microsoft Teams payload with required no-default `v: Literal[1]`, `p: Literal[IMProvider.MS_TEAMS]`, trusted non-empty HTTPS `service_url`, non-empty `conversation_id` and `activity_id`, the exact Bot Framework field comments and official Connector API URL fixed by the spec, no other fields, and the model-owned `encode()`/`decode()` methods; return and accept `MessageLocator`, and remove `_MSTeamsMessageLocator` and external codec helpers.
- [x] 5.2 Add Microsoft Teams property-based tests over valid private Pydantic payload models verifying `payload.decode(payload.encode()) == payload`, with meaningful boundaries for every encoded field and no comparison between separate `encode()` outputs; retain example tests for untrusted service URL, unknown version, malformed Base64, malformed JSON, strict/extra validation, secret absence, exact payload shape and scalar round trip across adapter recreation.
- [x] 5.3 Preserve the exact conversation/activity update boundary and `INVALID_REFERENCE`/`STALE_REFERENCE`/`UNKNOWN` mapping without pickle, private object construction or Provider I/O for invalid references.

## 6. Add DingTalk and WeCom persistent reference codecs

- [x] 6.1 Replace `_DingTalkMessageLocator` with a private strict/frozen/extra-forbid Pydantic payload containing required no-default `v: Literal[1]`, `p: Literal[IMProvider.DING_TALK]`, non-empty `process_query_key`, the exact DingTalk field comment and official batch-send URL fixed by the spec, no other fields, and the model-owned `encode()`/`decode()` methods; return `MessageLocator` only after complete acceptance.
- [x] 6.2 Replace `_WeComMessageReference` with a private strict/frozen/extra-forbid Pydantic payload containing required no-default `v: Literal[1]`, `p: Literal[IMProvider.WE_COM]`, non-empty `message_id`, the exact WeCom field comment and official send-message URL fixed by the spec, no other fields, and the model-owned `encode()`/`decode()` methods; return `MessageLocator` only after complete acceptance.
- [x] 6.3 Add separate DingTalk and WeCom property-based tests over their valid private Pydantic payload models verifying `payload.decode(payload.encode()) == payload`, with meaningful boundaries for every encoded field and no comparison between separate `encode()` outputs; retain example tests for scalar JSON/text round trip, malformed Base64, malformed JSON, strict/extra validation, exact payload shape, secret absence and incomplete accepted responses, and remove pickle/deepcopy/private-class assertions.

## 7. Validate and audit the migration

- [x] 7.1 Run the focused Provider-neutral and five-Provider IM unit suites through `uv run --project api pytest ...`, including SDK boundary and replacement tests.
- [ ] 7.2 Run Ruff and BasedPyright for the changed Provider-neutral contracts, concrete adapter modules and focused tests, resolving every error without `cast`, type-ignore comments or private test-only public APIs.
- [x] 7.3 Search production code and tests to prove there is no remaining public `MessageReference` definition/export/import, subclass declaration, private reference wrapper, pickle/deepcopy persistence evidence, or `MessageReference()` construction.
- [ ] 7.4 Run `openspec validate restore-im-message-reference-contract --type change --strict` and `openspec validate define-im-provider-adapter-contracts --type change --strict`, resolving every validation error.
