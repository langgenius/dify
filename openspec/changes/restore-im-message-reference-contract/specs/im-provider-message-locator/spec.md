## ADDED Requirements

### Requirement: MessageLocator MUST be a nominal string contract
The Provider-neutral IM package MUST define `MessageLocator` as a static nominal type over `str` and MUST NOT define it as a runtime base class, dataclass, Pydantic model or Provider-discriminated object hierarchy. `MessageAccepted` MUST expose the accepted message only through a `locator: MessageLocator` field whose runtime value is a non-empty string that callers can store and compare using scalar text boundaries. The previous `reference` field and `MessageReference` type name MUST NOT remain as properties, definitions, aliases or package exports. Provider-specific locator fields and locator classes MUST NOT be exposed through the shared package.

#### Scenario: Any initial Provider confirms message acceptance
- **WHEN** Slack, Feishu/Lark, DingTalk, WeCom or Microsoft Teams returns `MessageAccepted`
- **THEN** `locator` MUST be a non-empty runtime `str` typed as `MessageLocator`
- **AND** it MUST NOT require access to a Provider-private Python class or field

#### Scenario: MessageAccepted shape is inspected
- **WHEN** a caller or contract test inspects a `MessageAccepted` result
- **THEN** it MUST expose a `locator` field
- **AND** it MUST NOT expose a `reference` field or compatibility property

#### Scenario: Shared contract shape is inspected
- **WHEN** a caller or contract test inspects `MessageLocator`
- **THEN** its static supertype MUST be `str`
- **AND** constructing `MessageLocator` from a stored string MUST NOT allocate a runtime wrapper object

### Requirement: MessageLocator MUST retain its defining comment
The Provider-neutral `contracts.py` module MUST contain the following comment and definition verbatim, with the comment immediately preceding the definition:

```python
# Opaque, persistable locator for one exact Provider message.
#
# Callers may store, compare, and return this value to a compatible adapter,
# but must not parse, alter, or synthesize it.
#
# The value is a plain, versioned serialization of Provider-private locator
# facts. It may cross process boundaries and survive adapter recreation.
# "Opaque" constrains caller behavior; it does not imply encryption, signing,
# cryptographic authenticity, or authorization.
MessageLocator = NewType("MessageLocator", str)
```

#### Scenario: The public locator definition is added or modified
- **WHEN** the Provider-neutral `MessageLocator` definition is added or modified
- **THEN** the required comment block MUST remain verbatim and immediately precede `MessageLocator = NewType("MessageLocator", str)`

### Requirement: Each Provider MUST own a versioned opaque locator codec
Each concrete Provider adapter MUST use a Provider-private Pydantic locator payload model and MUST privately encode that payload as a non-empty `MessageLocator` that its corresponding decoder can recover losslessly. Each concrete adapter module MUST define its own model, except that the shared Feishu/Lark module MUST define one model used by both adapters. Every private payload model MUST use `ConfigDict(frozen=True, extra="forbid", strict=True)` or behaviorally equivalent Pydantic configuration, MUST declare required `v` and `p` fields without defaults, and MUST contain only scalar or enum-like fields. It MUST NOT contain sequence, mapping or other container-valued members. The `v` field MUST be constrained to the supported wire version or versions, such as `Literal[1]`. The `p` field MUST use the existing `IMProvider` enum directly and MUST be constrained to the Provider or Providers implemented by that concrete adapter module. Encoding MUST serialize the private Pydantic model to JSON and then encode the JSON bytes using URL-safe Base64. Decoding MUST strictly decode URL-safe Base64 and validate the resulting JSON through the same private Pydantic model. It MUST reject characters outside the URL-safe Base64 alphabet, malformed padding and invalid length. It MUST NOT re-encode the decoded bytes as part of validation. The private payload MUST include only the upstream locator fields required by a later Provider operation to address the same message. It MUST NOT copy adapter credentials, tenant/application identity or local message classification into the locator when those values are not part of the upstream mutation locator. The encoded locator MUST NOT contain credentials, tokens, secrets or encryption material. The shared package MUST NOT expose a common payload model, locator schema or decoding API. The contract MUST NOT require two encodings of the same payload to produce equal locator strings because JSON representation stability is not used by the contract.

#### Scenario: A Provider defines its private payload model
- **WHEN** Slack, Feishu/Lark, DingTalk, WeCom or Microsoft Teams defines its locator payload
- **THEN** the Pydantic model MUST be frozen, strict and MUST forbid extra fields
- **AND** it MUST declare required `v` and `p` fields without defaults
- **AND** `v` MUST be constrained to the supported wire version or versions
- **AND** `p` MUST use the existing `IMProvider` enum directly and be constrained to the Provider or Providers implemented by the module
- **AND** every remaining field MUST be scalar or enum-like rather than a sequence, mapping or other container

#### Scenario: Version and Provider are serialized
- **WHEN** any Provider serializes a valid private locator payload to JSON
- **THEN** the JSON object MUST contain explicit `v` and `p` members
- **AND** neither member MAY be supplied only by a Pydantic default or omitted from serialized JSON

#### Scenario: A payload is mutated after validation
- **WHEN** code attempts to assign a different value to a field of a validated private locator payload
- **THEN** Pydantic MUST reject the mutation

#### Scenario: A payload has an undeclared field or unsupported version
- **WHEN** decoded JSON contains an extra field or a version not accepted by the private payload model
- **THEN** Pydantic validation MUST fail

#### Scenario: A Provider constructs a MessageLocator
- **WHEN** Slack, Feishu/Lark, DingTalk, WeCom or Microsoft Teams constructs a `MessageLocator`
- **THEN** it MUST first instantiate and validate its own private Pydantic payload model
- **AND** it MUST serialize that model to JSON before encoding the JSON bytes as URL-safe Base64

#### Scenario: A Provider decodes a MessageLocator
- **WHEN** a Provider decodes one of its locator strings
- **THEN** it MUST strictly decode URL-safe Base64 and validate the decoded JSON through its private Pydantic payload model
- **AND** invalid alphabet, malformed padding, invalid length, malformed JSON or Pydantic validation failure MUST fail decoding
- **AND** the decoder MUST NOT re-encode the decoded bytes as part of validation

#### Scenario: Malformed Base64 is supplied
- **WHEN** a locator contains an invalid URL-safe Base64 character, malformed padding or invalid length
- **THEN** decoding MUST fail before any Provider I/O

#### Scenario: Provider uses a composite message locator
- **WHEN** a Provider requires multiple facts to identify one accepted message
- **THEN** its private codec MUST preserve every required fact inside the opaque string
- **AND** callers MUST NOT need to understand or store those facts separately

#### Scenario: Adapter-local metadata is available
- **WHEN** tenant identity, application identity or message classification is available to an adapter but is not required by the upstream API to address the message
- **THEN** the codec MUST NOT copy that metadata into the `MessageLocator`

#### Scenario: A private Pydantic payload is round tripped
- **WHEN** one Provider codec encodes a valid private Pydantic payload model and decodes the resulting `MessageLocator`
- **THEN** the decoded private Pydantic model MUST equal the original model
- **AND** conformance MUST NOT depend on locator equality across separate encoding operations

#### Scenario: Credential material is bound to an adapter
- **WHEN** a Provider codec creates a locator
- **THEN** the encoded string MUST NOT contain any bot token, access token, app secret, client secret, signing secret, encryption key or other credential material

### Requirement: Initial Provider locators MUST use exact private payload fields
Every initial Provider private payload model MUST preserve only the following required fields. All string locator fields MUST be non-empty after validation. Microsoft Teams `service_url` MUST additionally be a trusted non-empty HTTPS URL accepted by the existing Teams service URL policy.

| Provider | Required private payload fields |
| --- | --- |
| Slack | `v: Literal[1]`; `p: Literal[IMProvider.SLACK]`; non-empty `channel_id: str`; non-empty `message_ts: str` |
| Feishu/Lark | `v: Literal[1]`; `p: Literal[IMProvider.FEISHU, IMProvider.LARK]`; non-empty `message_id: str` |
| DingTalk | `v: Literal[1]`; `p: Literal[IMProvider.DING_TALK]`; non-empty `process_query_key: str` |
| WeCom | `v: Literal[1]`; `p: Literal[IMProvider.WE_COM]`; non-empty `message_id: str` |
| Microsoft Teams | `v: Literal[1]`; `p: Literal[IMProvider.MS_TEAMS]`; trusted non-empty HTTPS `service_url: str`; non-empty `conversation_id: str`; non-empty `activity_id: str` |

Apart from these exact fields, each model MUST reject all other fields through `extra="forbid"`.

#### Scenario: A Provider uses its discriminator
- **WHEN** Slack, DingTalk, WeCom or Microsoft Teams constructs its private locator payload
- **THEN** `p` MUST be the corresponding existing `IMProvider` member listed in the table
- **AND** the implementation MUST NOT introduce a Provider-specific duplicate enum or raw string discriminator

#### Scenario: Feishu or Lark defines the shared payload model
- **WHEN** the shared Feishu/Lark adapter module defines its private locator payload
- **THEN** it MUST use one shared model equivalent in shape to the following definition

```python
class _FeishuLarkLocatorPayload(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", strict=True)

    # version of the locator
    v: Literal[1]
    # provider of the locator
    p: Literal[IMProvider.FEISHU, IMProvider.LARK]
    # Feishu/Lark message identifier used to update the card:
    # Feishu: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/patch
    # Lark: https://open.larksuite.com/document/server-docs/im-v1/message-card/patch
    message_id: str
```

- **AND** Feishu and Lark MUST NOT define separate payload model classes or wire shapes

#### Scenario: Feishu or Lark decodes a locator
- **WHEN** a Feishu or Lark adapter decodes a structurally valid shared `_FeishuLarkLocatorPayload`
- **THEN** the adapter MUST verify `payload.p == self._provider`
- **AND** a Feishu adapter MUST reject a locator with `p=IMProvider.LARK`, while a Lark adapter MUST reject a locator with `p=IMProvider.FEISHU`, before Provider I/O

### Requirement: Private payload fields MUST use concise names and retain authoritative field comments
Every Provider-private locator payload MUST name the version field `v` and the Provider discriminator field `p`. Other locator fields MUST use the concise upstream-oriented names listed in the required-fields table. Each declared field MUST have an immediately preceding English comment that states the field's locator meaning. At minimum, every private payload model MUST retain the exact comments `# version of the locator` immediately before `v` and `# provider of the locator` immediately before `p`.

Every Provider-specific locator field MUST additionally have an immediately preceding comment containing the authoritative Provider documentation URL for that field. The implementation MUST use the exact field comments and URLs specified below rather than selecting documentation during implementation.

Slack MUST retain:

```python
# Slack channel containing the message to update:
# https://docs.slack.dev/reference/methods/chat.update/
channel_id: str
# Slack timestamp of the message to update:
# https://docs.slack.dev/reference/methods/chat.update/
message_ts: str
```

The shared Feishu/Lark payload MUST retain both Provider documentation URLs:

```python
# Feishu/Lark message identifier used to update the card:
# Feishu: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/patch
# Lark: https://open.larksuite.com/document/server-docs/im-v1/message-card/patch
message_id: str
```

DingTalk MUST retain:

```python
# DingTalk process query key returned for the sent message:
# https://open.dingtalk.com/document/orgapp/chatbots-send-one-on-one-chat-messages-in-batches.md
process_query_key: str
```

WeCom MUST retain:

```python
# WeCom application message identifier returned by the send API:
# https://developer.work.weixin.qq.com/document/path/90236
message_id: str
```

Microsoft Teams MUST retain:

```python
# Bot Framework service endpoint used for subsequent message operations:
# https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference?view=azure-bot-service-4.0
service_url: str
# Bot Framework conversation containing the activity:
# https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference?view=azure-bot-service-4.0
conversation_id: str
# Bot Framework activity identifier of the exact message:
# https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference?view=azure-bot-service-4.0
activity_id: str
```

#### Scenario: A private payload model is inspected
- **WHEN** a source-level test inspects any of the five Provider-private payload models
- **THEN** it MUST find `# version of the locator` immediately before `v`
- **AND** it MUST find `# provider of the locator` immediately before `p`
- **AND** every Provider-specific locator field MUST retain its exact English meaning comment and authoritative URL specified by this requirement

#### Scenario: A Provider-specific field is added or renamed
- **WHEN** an implementation changes the Provider-specific fields of a private locator payload
- **THEN** the governing spec MUST first define the field's exact English meaning comment and authoritative Provider documentation URL
- **AND** the implementation MUST NOT introduce a field whose authoritative URL is selected only during implementation

#### Scenario: Slack accepts a card
- **WHEN** Slack returns `MessageAccepted` for a dynamic card
- **THEN** the locator MUST preserve the exact channel ID and message timestamp returned by Slack
- **AND** it MUST NOT preserve team ID, client/app ID or message kind

#### Scenario: Feishu or Lark accepts a message
- **WHEN** Feishu or Lark returns `MessageAccepted`
- **THEN** the locator MUST preserve the exact Provider variant and Provider message ID
- **AND** it MUST NOT preserve tenant ID, app ID or message kind

#### Scenario: DingTalk or WeCom accepts text
- **WHEN** DingTalk or WeCom returns `MessageAccepted` for text
- **THEN** the locator MUST preserve only its complete Provider-returned acceptance locator
- **AND** it MUST NOT preserve corporation ID, client/robot ID, agent ID or message kind

#### Scenario: Microsoft Teams accepts a message
- **WHEN** Microsoft Teams returns `MessageAccepted`
- **THEN** the locator MUST preserve the service URL, conversation ID and activity ID required by `update_activity`
- **AND** it MUST NOT preserve tenant ID, bot/client ID or message kind

### Requirement: Message acceptance MUST include a persistable exact locator
An adapter MUST return `MessageAccepted` only after the Provider confirms acceptance and the upstream send flow has produced every locator fact required to create a complete, decodable `MessageLocator`. Missing, malformed or unavailable locator facts MUST produce the existing `MessageSendingError` semantics and MUST NOT cause an automatic replay of the message mutation. An adapter MUST NOT perform an additional Provider identity lookup solely to enrich a `MessageLocator` with tenant, team or application metadata.

#### Scenario: Accepted response lacks an exact locator
- **WHEN** a Provider response confirms or may have confirmed message creation but omits a required exact locator fact
- **THEN** the adapter MUST return `MessageSendingError`
- **AND** it MUST NOT replay the message creation

#### Scenario: Adapter could enrich a locator with identity metadata
- **WHEN** an adapter could perform an additional lookup to add team, tenant or application identity that the upstream mutation API does not require
- **THEN** it MUST NOT perform that lookup for `MessageLocator` construction

### Requirement: MessageLocator MUST round trip through scalar persistence boundaries
A caller MUST be able to persist the exact `str` value of a `MessageLocator`, discard every originating adapter and Python object, reconstruct only `MessageLocator(stored_value)`, and pass it to a newly created compatible adapter. Applicable operations MUST consume that reconstructed value without pickle metadata, module paths, private class constructors, process-local registries or originating adapter memory.

#### Scenario: Locator crosses a process boundary
- **WHEN** a caller serializes only the locator string, starts with no originating objects, and reconstructs `MessageLocator` from the stored text
- **THEN** a newly created compatible adapter MUST consume the reconstructed locator as the same exact-message locator

#### Scenario: Locator crosses a JSON boundary
- **WHEN** a caller round trips `MessageLocator` as a JSON string without Provider-specific fields
- **THEN** the resulting text MUST be sufficient to reconstruct the same `MessageLocator`

#### Scenario: Python implementation identity changes
- **WHEN** private codec helpers or module-internal structured models are refactored without changing the encoded version
- **THEN** previously stored locators of that version MUST remain consumable

### Requirement: Dynamic card replacement MUST validate locators before Provider I/O
Slack, Feishu/Lark and Microsoft Teams MUST strictly decode and validate a supplied `MessageLocator` before attempting `replace_with_static`. Malformed, empty, unknown-version, wrong-Provider or incomplete locators MUST return `ReplacementErrorKind.INVALID_REFERENCE` without Provider I/O. A valid decoded locator MUST target only its encoded exact Provider message. Provider-confirmed absence or non-replaceability MUST continue to return `STALE_REFERENCE`; an unconfirmed mutation outcome MUST continue to return `UNKNOWN`.

#### Scenario: Stored locator is malformed or has an unknown version
- **WHEN** replacement receives an empty, malformed or unknown-version locator
- **THEN** it MUST return `INVALID_REFERENCE`
- **AND** it MUST NOT invoke a Provider API

#### Scenario: Locator belongs to another Provider
- **WHEN** replacement receives a locator for another Provider
- **THEN** it MUST return `INVALID_REFERENCE`
- **AND** it MUST NOT invoke a Provider API

#### Scenario: Compatible card locator is accepted for replacement
- **WHEN** replacement receives a structurally valid locator for its Provider
- **THEN** it MUST attempt replacement only for the exact decoded Provider message

#### Scenario: Exact Provider message is stale
- **WHEN** the Provider conclusively reports that the decoded exact message no longer exists or cannot be replaced
- **THEN** replacement MUST return `STALE_REFERENCE`
- **AND** it MUST NOT select or synthesize another message locator

### Requirement: MessageLocator MUST remain an internal locator rather than an authorization credential
`MessageLocator` opacity MUST constrain caller behavior and the shared API surface, but MUST NOT by itself grant authority to mutate a message. Callers MUST preserve locators in a trusted application boundary and MUST NOT parse, alter, synthesize or accept them from an untrusted principal as proof of authorization. The initial codecs implemented by this change MUST use plain versioned serialization and MUST NOT add encryption, signing, MACs, nonces, initialization vectors, random padding or other randomized/security envelopes. Any future security requirement MUST be designed separately from this persistence-contract repair.

#### Scenario: Caller retains an internal locator
- **WHEN** an authorized application workflow stores and returns the exact send result
- **THEN** the adapter MAY rely on the caller contract after structural and compatibility validation

#### Scenario: Untrusted input contains a locator-like string
- **WHEN** an external principal supplies an arbitrary locator-like value
- **THEN** the application MUST establish authorization independently of `MessageLocator`
- **AND** the locator alone MUST NOT authorize Provider mutation

#### Scenario: An initial Provider codec serializes a locator
- **WHEN** Slack, Feishu/Lark, DingTalk, WeCom or Microsoft Teams encodes its private Pydantic payload
- **THEN** it MUST use the required JSON-then-URL-safe-Base64 serialization without encryption, signing, a MAC, nonce, initialization vector, random padding or another randomized/security envelope
- **AND** it MUST reject malformed and incompatible locators without claiming detection of a structurally valid value synthesized in violation of the caller contract

### Requirement: Every Provider codec MUST have round-trip property-based tests
Slack, Feishu/Lark, DingTalk, WeCom and Microsoft Teams MUST each have property-based tests for the private `MessageLocator` codec. Over the valid domain of each Provider-private Pydantic payload model, the tests MUST verify `decode(encode(payload)) == payload`. The property MUST compare the decoded Pydantic model with the original model and MUST NOT compare locators produced by separate encoding operations. Example-based tests MUST remain for named business cases, invalid locators and regressions.

#### Scenario: A valid private payload is generated
- **WHEN** a property-based test generates a valid Provider-private Pydantic payload model across that Provider's declared locator fields
- **THEN** decoding its encoded `MessageLocator` MUST produce a Pydantic model equal to the generated model

#### Scenario: The generated domain is defined
- **WHEN** a Provider defines the generator for its round-trip property
- **THEN** the generator MUST produce only semantically valid composite locators, including meaningful boundary values for every encoded field
- **AND** malformed locator strings MUST be tested separately from the round-trip property

#### Scenario: A property fails
- **WHEN** the property-based testing framework finds a counterexample
- **THEN** the test MUST report a reproducible shrunk private payload that still violates the round-trip law

### Requirement: Contract tests MUST verify public behavior rather than private locator objects
Locator conformance tests MUST exercise runtime string shape, scalar persistence round trip, adapter recreation, private locator encode/decode round trip, minimum-locator shape, wrong-Provider rejection, secret absence and exact replacement behavior. Tests MUST NOT use pickle, deepcopy, private locator subclasses, private locator fields or `isinstance` against Provider-private locator classes as evidence of public persistence conformance.

#### Scenario: Persistence conformance is tested
- **WHEN** a test verifies locator persistence
- **THEN** it MUST retain only the scalar string representation before reconstructing `MessageLocator`
- **AND** it MUST not depend on Python object serialization metadata

#### Scenario: Provider codec rejection is tested
- **WHEN** tests supply malformed, unknown-version or incompatible locator strings
- **THEN** they MUST verify the applicable safe result and absence of Provider I/O
