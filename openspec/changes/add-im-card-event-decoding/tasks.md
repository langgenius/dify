## 1. Shared Card Event Contracts

- [x] 1.1 Add frozen `IMCardEvent`, `UnrecognizedIMEvent`, `IMCardEventDecodeResult`, safe `IMCardEventDecodingError` and `IMCardEventDecoder` to the shared IM Provider contracts, using `ProviderUserId`, `CorrelationToken` and a root-read-only `Mapping[str, JsonValue]` with mutable nested JSON containers, without introducing duplicate identity or token types.
- [x] 1.2 Add the class-level `card_event_decoder()` optional capability to `IMProviderAdapter`, update public exports and the Provider API stub, and document its credential-free, no-I/O, thread-safe and root-lifecycle-independent semantics.
- [x] 1.3 Add shared contract tests for non-empty action identity, JSON-only inputs, non-card `UnrecognizedIMEvent` results, recognized-card decoding failures and operator-safe exceptions that do not retain callback payload data.

## 2. Capability Pairing

- [ ] 2.1 Update Slack, Feishu/Lark and Microsoft Teams adapter classes to expose their stateless decoders through `card_event_decoder()` and update DingTalk and WeCom adapter classes to return `None`.
- [ ] 2.2 Add black-box conformance tests proving every concrete adapter exposes Dynamic Card Messaging if and only if it exposes card-event decoding, without constructing a credential-bound adapter or performing I/O during decoder discovery.
- [ ] 2.3 Add concurrency and lifecycle tests proving returned decoders can be called concurrently and remain independent from construction, credential rotation and `close()` of root adapter instances.
- [x] 2.4 Add explicit Feishu and Lark capability-matrix conformance coverage proving both concrete adapters expose Dynamic Card Messaging together with decoders producing `union_id`-based `ProviderUserId` values.

## 3. Slack Card Event Decoder

- [x] 3.1 Add complete sanitized Slack Block Actions fixtures for equivalent Webhook and Socket Mode submissions plus static_select and legacy/foreign radio_buttons change interactions, including callback user, invoked action shape, embedded correlation metadata where applicable and supported state values.
- [x] 3.2 Consolidate Slack card sending and decoding in `slack.py`; implement both authenticated payload envelopes with a shallow exact-`__dify.actions` recognition stage before strict Pydantic submission validation; use stable `__dify.input.<ordinal>` IDs, normalize the actor, action, inputs and correlation token, validate agreement between outer and embedded action identifiers, reconstruct the sender-owned input schema from `message.blocks`, and require exact Dify state agreement while preserving explicit JSON null values.
- [x] 3.3 Add Slack tests proving Webhook/Socket convergence, exact round trip of Unicode action/input/token values, and `UnrecognizedIMEvent` for authenticated non-card events, selection changes, missing/empty/non-object actions and non-Dify Block Actions.
- [x] 3.4 Add Slack failure tests for transport-discriminated invalid JSON/envelopes and prove that the exact inspectable `__dify.actions` marker enables strict validation for missing or incorrectly typed actor/action/token/input facts, wrong action type/value, reserved message-block ID ownership, sender-owned actions block/button membership, malformed or duplicate stable Dify block schema, missing/extra/mismatched input state, multiple actions, unsupported Dify callback schema and safe `IMCardEventDecodingError` diagnostics; prefix-like markers remain unrecognized.
- [x] 3.5 Add a targeted real Slack Web API sender/readback integration test that rebuilds a callback from Provider-returned blocks and proves sender/decoder agreement.
- [x] 3.6 Run focused Slack unit and integration coverage and one uniquely marked live callback probe, retaining only sanitized conclusions.

## 4. Microsoft Teams Card Event Decoder

- [x] 4.1 Define one collision-safe internal layout for Microsoft Teams `Action.Submit` metadata, update card assessment/rendering and the sanitized callback fixture, and keep the layout outside the shared contract.
- [x] 4.2 Implement the Microsoft Teams decoder to recognize applicable card invoke activities, normalize `from.id` as `ProviderUserId`, recover action/correlation metadata and remove only internal metadata from returned inputs.
- [x] 4.3 Add Microsoft Teams tests proving exact action/input/token round trip, metadata/input separation, reserved-name collision behavior and `UnrecognizedIMEvent` for authenticated non-card or non-applicable invoke events.
- [x] 4.4 Add Microsoft Teams failure tests for invalid JSON, missing or incorrectly typed callback actor/value/metadata, malformed input objects and safe `IMCardEventDecodingError` diagnostics.

## 5. Feishu/Lark Card Event Decoder

- [x] 5.1 Capture complete sanitized Feishu/Lark card-action fixtures for Webhook and STREAM, establishing the callback event discriminator, actor `union_id`, action/value metadata, submitted inputs and transport envelope differences.
- [x] 5.2 Implement the shared Feishu/Lark decoder protocol path with separate Provider discriminators, normalize callback actors as `union_id`-based `ProviderUserId` values, and recover action, inputs and correlation token without credentials or Provider I/O.
- [x] 5.3 Update Feishu/Lark Dynamic Card sending metadata as necessary so sender and decoder satisfy the same collision-safe action/input/token round trip for both Provider variants.
- [x] 5.4 Add Feishu/Lark tests for Webhook/STREAM convergence, Feishu/Lark protocol equivalence, exact round trip, authenticated non-card `UnrecognizedIMEvent` results and malformed-card `IMCardEventDecodingError` failures.

## 6. Provider Evidence and Boundary Verification

- [x] 6.1 Reject completion of the Feishu/Lark implementation if sanitized callback evidence cannot establish the Directory/Messaging `union_id`; do not introduce a callback-only identity substitute.
- [x] 6.2 Add dependency-boundary tests or import assertions proving card decoders do not load credentials, Provider clients, Contact/binding repositories, HITL form/grant models, submission services or workflow runtime code.
- [x] 6.3 Run the targeted IM Provider contract, Slack, Feishu/Lark and Microsoft Teams unit suites through `uv run --project api`, and resolve all regressions without adding inbox or HITL submission wiring.
- [ ] 6.4 Validate `add-im-card-event-decoding` with OpenSpec and confirm every scenario is represented by a contract, Provider-specific or boundary test.
