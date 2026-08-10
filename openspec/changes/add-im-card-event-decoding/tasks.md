## 1. Shared Card Event Contracts

- [ ] 1.1 Add immutable `IMCardEvent`, `UnrecognizedIMEvent`, `IMCardEventDecodeResult`, safe `IMCardEventDecodingError` and `IMCardEventDecoder` to the shared IM Provider contracts, using `ProviderUserId`, `CorrelationToken` and `Mapping[str, JsonValue]` without introducing duplicate identity or token types.
- [ ] 1.2 Add the class-level `card_event_decoder()` optional capability to `IMProviderAdapter`, update public exports and the Provider API stub, and document its credential-free, no-I/O, thread-safe and root-lifecycle-independent semantics.
- [ ] 1.3 Add shared contract tests for non-empty action identity, JSON-only inputs, non-card `UnrecognizedIMEvent` results, recognized-card decoding failures and operator-safe exceptions that do not retain callback payload data.

## 2. Capability Pairing

- [ ] 2.1 Update Slack, Feishu/Lark and Microsoft Teams adapter classes to expose their stateless decoders through `card_event_decoder()` and update DingTalk and WeCom adapter classes to return `None`.
- [ ] 2.2 Add black-box conformance tests proving every concrete adapter exposes Dynamic Card Messaging if and only if it exposes card-event decoding, without constructing a credential-bound adapter or performing I/O during decoder discovery.
- [ ] 2.3 Add concurrency and lifecycle tests proving returned decoders can be called concurrently and remain independent from construction, credential rotation and `close()` of root adapter instances.
- [ ] 2.4 Add explicit Feishu and Lark capability-matrix conformance coverage proving both concrete adapters expose Dynamic Card Messaging together with decoders producing `union_id`-based `ProviderUserId` values.

## 3. Slack Card Event Decoder

- [ ] 3.1 Add complete sanitized Slack Block Actions fixtures for equivalent Webhook and Socket Mode callbacks, including callback user, exactly one invoked action, embedded correlation metadata and supported text/radio state values.
- [ ] 3.2 Implement the Slack decoder for both authenticated payload envelopes, normalize the actor, action, inputs and correlation token, and validate agreement between outer and embedded action identifiers.
- [ ] 3.3 Add Slack tests proving Webhook/Socket convergence, exact round trip of Unicode action/input/token values, and `UnrecognizedIMEvent` for authenticated non-card Slack events.
- [ ] 3.4 Add Slack failure tests for invalid JSON, missing or incorrectly typed actor/action/token/input facts, ambiguous invoked actions, unsupported Dify callback schema and safe `IMCardEventDecodingError` diagnostics.

## 4. Microsoft Teams Card Event Decoder

- [ ] 4.1 Define one collision-safe internal layout for Microsoft Teams `Action.Submit` metadata, update card assessment/rendering and the sanitized callback fixture, and keep the layout outside the shared contract.
- [ ] 4.2 Implement the Microsoft Teams decoder to recognize applicable card invoke activities, normalize `from.id` as `ProviderUserId`, recover action/correlation metadata and remove only internal metadata from returned inputs.
- [ ] 4.3 Add Microsoft Teams tests proving exact action/input/token round trip, metadata/input separation, reserved-name collision behavior and `UnrecognizedIMEvent` for authenticated non-card or non-applicable invoke events.
- [ ] 4.4 Add Microsoft Teams failure tests for invalid JSON, missing or incorrectly typed callback actor/value/metadata, malformed input objects and safe `IMCardEventDecodingError` diagnostics.

## 5. Feishu/Lark Card Event Decoder

- [ ] 5.1 Capture complete sanitized Feishu/Lark card-action fixtures for Webhook and STREAM, establishing the callback event discriminator, actor `union_id`, action/value metadata, submitted inputs and transport envelope differences.
- [ ] 5.2 Implement the shared Feishu/Lark decoder protocol path with separate Provider discriminators, normalize callback actors as `union_id`-based `ProviderUserId` values, and recover action, inputs and correlation token without credentials or Provider I/O.
- [ ] 5.3 Update Feishu/Lark Dynamic Card sending metadata as necessary so sender and decoder satisfy the same collision-safe action/input/token round trip for both Provider variants.
- [ ] 5.4 Add Feishu/Lark tests for Webhook/STREAM convergence, Feishu/Lark protocol equivalence, exact round trip, authenticated non-card `UnrecognizedIMEvent` results and malformed-card `IMCardEventDecodingError` failures.

## 6. Provider Evidence and Boundary Verification

- [ ] 6.1 Reject completion of the Feishu/Lark implementation if sanitized callback evidence cannot establish the Directory/Messaging `union_id`; do not introduce a callback-only identity substitute.
- [ ] 6.2 Add dependency-boundary tests or import assertions proving card decoders do not load credentials, Provider clients, Contact/binding repositories, HITL form/grant models, submission services or workflow runtime code.
- [ ] 6.3 Run the targeted IM Provider contract, Slack, Feishu/Lark and Microsoft Teams unit suites through `uv run --project api`, and resolve all regressions without adding inbox or HITL submission wiring.
- [ ] 6.4 Validate `add-im-card-event-decoding` with OpenSpec and confirm every scenario is represented by a contract, Provider-specific or boundary test.
