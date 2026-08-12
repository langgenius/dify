# im-provider-message-locator Specification

## Purpose
TBD - created by archiving change restore-im-message-reference-contract. Update Purpose after archive.
## Requirements
### Requirement: MessageLocator MUST be the Provider-neutral locator contract
The Provider-neutral `contracts.py` module MUST contain the following comment and definition verbatim, with the comment immediately preceding the definition:

```python
# Opaque, persistable locator for one exact Provider message.
#
# Callers may store, compare, and return this value to a compatible adapter,
# but must not parse, alter, or synthesize it.
#
# The value is a plain, versioned serialization of Provider-private locator
# facts. It may cross process boundaries and survive adapter recreation.
# Keep this value within a trusted application boundary; it must not cross
# a security boundary.
# "Opaque" constrains caller behavior; it does not imply encryption, signing,
# cryptographic authenticity, or authorization.
MessageLocator = NewType("MessageLocator", str)
```

`MessageAccepted` MUST expose `locator: MessageLocator` and MUST NOT expose a `reference` field or compatibility property. `MessageReference` MUST NOT remain as a definition, alias, or package export. The shared package MUST NOT expose Provider-specific locator fields, models, classes, or decoding APIs.

#### Scenario: A Provider confirms message acceptance
- **WHEN** an initial Provider returns `MessageAccepted`
- **THEN** `locator` MUST be a non-empty runtime `str`
- **AND** no Provider-private object MUST cross the Provider-neutral boundary

#### Scenario: The public locator definition is modified
- **WHEN** the Provider-neutral `MessageLocator` definition is modified
- **THEN** the canonical public definition MUST be preserved

### Requirement: Initial Providers MUST use the canonical private payload schemas
Each concrete adapter module MUST own a private Pydantic payload model, except that Feishu and Lark MUST share exactly one `_FeishuLarkLocatorPayload` model and wire shape. Every model MUST use `ConfigDict(frozen=True, extra="forbid", strict=True)` and contain only scalar or enum-like fields.

The table is the canonical field definition for the initial Provider payloads:

| Provider | Exact private payload fields |
| --- | --- |
| Slack | `v: Literal[1]`; `p: Literal[IMProvider.SLACK]`; non-empty `channel_id: str`; non-empty `message_ts: str` |
| Feishu/Lark | `v: Literal[1]`; `p: Literal[IMProvider.FEISHU, IMProvider.LARK]`; non-empty `message_id: str` |
| DingTalk | `v: Literal[1]`; `p: Literal[IMProvider.DING_TALK]`; non-empty `process_query_key: str` |
| WeCom | `v: Literal[1]`; `p: Literal[IMProvider.WE_COM]`; non-empty `message_id: str` |
| Microsoft Teams | `v: Literal[1]`; `p: Literal[IMProvider.MS_TEAMS]`; trusted non-empty HTTPS `service_url: str`; non-empty `conversation_id: str`; non-empty `activity_id: str` |

For Microsoft Teams, trusted means accepted by the existing Teams service URL policy. `v` and `p` MUST be required without defaults and MUST appear explicitly in serialized JSON. Locator-specific duplicate enums and raw string discriminators are forbidden.

#### Scenario: Version or Provider is omitted
- **WHEN** decoded JSON omits `v` or `p`
- **THEN** canonical schema validation MUST fail

#### Scenario: Feishu or Lark decodes a shared payload
- **WHEN** a Feishu or Lark adapter decodes a structurally valid `_FeishuLarkLocatorPayload`
- **THEN** it MUST verify `payload.p == self._provider`
- **AND** a mismatch MUST fail before Provider I/O

### Requirement: Private payload fields MUST retain canonical source comments
Every payload field MUST have its canonical English comment immediately before its declaration. The comments for the common fields are:

`v`:

```python
# version of the locator
```

`p`:

```python
# provider of the locator
```

The canonical Provider-specific comments are:

Slack `channel_id`:

```python
# Slack channel containing the message to update:
# https://docs.slack.dev/reference/methods/chat.update/
```

Slack `message_ts`:

```python
# Slack timestamp of the message to update:
# https://docs.slack.dev/reference/methods/chat.update/
```

Feishu/Lark `message_id`:

```python
# Feishu/Lark message identifier used to update the card:
# Feishu: https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/patch
# Lark: https://open.larksuite.com/document/server-docs/im-v1/message-card/patch
```

DingTalk `process_query_key`:

```python
# DingTalk process query key returned for the sent message:
# https://open.dingtalk.com/document/orgapp/chatbots-send-one-on-one-chat-messages-in-batches.md
```

WeCom `message_id`:

```python
# WeCom application message identifier returned by the send API:
# https://developer.work.weixin.qq.com/document/path/90236
```

Microsoft Teams `service_url`:

```python
# Bot Framework service endpoint used for subsequent message operations:
# https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference?view=azure-bot-service-4.0
```

Microsoft Teams `conversation_id`:

```python
# Bot Framework conversation containing the activity:
# https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference?view=azure-bot-service-4.0
```

Microsoft Teams `activity_id`:

```python
# Bot Framework activity identifier of the exact message:
# https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference?view=azure-bot-service-4.0
```

#### Scenario: A private payload field is declared
- **WHEN** an implementation declares a field from the canonical payload table
- **THEN** the canonical source-comment contract MUST hold

#### Scenario: A Provider-specific field is added or renamed
- **WHEN** a future change adds or renames a Provider-specific payload field
- **THEN** its governing spec MUST first define the exact English meaning comment and authoritative Provider documentation URL

### Requirement: Provider codecs MUST implement the canonical round-trip law
Every canonical private payload model MUST expose these methods:

```python
class _ProviderPrivateModel(BaseModel):
    def encode(self) -> str:
        ...

    @classmethod
    def decode(cls, value: str) -> Self:
        ...
```

`encode()` MUST perform the model-to-JSON-to-URL-safe-Base64 conversion and return its ASCII text. `decode()` MUST reverse that conversion and validate the decoded JSON through `cls`. Invalid alphabet, malformed padding, invalid Base64 length, malformed JSON, or payload validation failure MUST fail `decode()`. It MUST NOT re-encode decoded bytes as part of validation. Adapters and other helpers MUST call these methods and MUST NOT implement or duplicate either conversion.

The codec law is:

```text
private_payload.decode(private_payload.encode()) == private_payload
```

The law does not require separate encodings of an equal payload to produce equal `MessageLocator` strings.

#### Scenario: A valid private payload is round tripped
- **WHEN** its private model encodes and then decodes a valid payload through these methods
- **THEN** the canonical codec law MUST hold

#### Scenario: An adapter needs a locator conversion
- **WHEN** an adapter sends or consumes a `MessageLocator`
- **THEN** it MUST delegate the JSON and URL-safe Base64 conversion to its private model

### Requirement: Message acceptance MUST include the complete upstream locator
An adapter MUST return `MessageAccepted` only after the Provider confirms acceptance and the send flow has produced every field in that Provider's canonical payload schema. Field values MUST be the exact upstream locator facts. The adapter MUST NOT perform a Provider identity lookup solely to construct a locator.

#### Scenario: An accepted response lacks a required locator fact
- **WHEN** a Provider response confirms or may have confirmed creation but omits a required payload field
- **THEN** the adapter MUST return the existing `MessageSendingError`
- **AND** it MUST NOT replay message creation

### Requirement: MessageLocator MUST survive scalar persistence boundaries
A caller MUST be able to persist only the exact `str` value, discard the originating adapter and Python objects, reconstruct `MessageLocator(stored_value)`, and use it with a newly created compatible adapter. This boundary MUST NOT depend on pickle metadata, module paths, private constructors, process-local registries, or originating adapter memory.

#### Scenario: Private implementation identity changes
- **WHEN** private models or codec helpers change without changing the encoded version
- **THEN** stored locators of that version MUST remain consumable

### Requirement: Dynamic card replacement MUST validate locators before Provider I/O
Slack, Feishu/Lark, and Microsoft Teams MUST call the corresponding private model's `decode()` before `replace_with_static` Provider I/O and follow this canonical outcome mapping:

| Condition | Result | Provider mutation I/O |
| --- | --- | --- |
| Empty, malformed, unknown-version, wrong-Provider, or incomplete locator | `ReplacementErrorKind.INVALID_REFERENCE` | Forbidden |
| Valid locator | Attempt replacement only for the decoded exact message | Required |
| Provider-confirmed absence or non-replaceability | `STALE_REFERENCE` | Already attempted |
| Unconfirmed mutation outcome | `UNKNOWN` | Already attempted |

#### Scenario: Replacement handles a locator
- **WHEN** `replace_with_static` receives a locator or a Provider mutation result
- **THEN** it MUST apply the canonical outcome mapping
- **AND** it MUST NOT select or synthesize another locator

### Requirement: MessageLocator MUST remain within its supported trust boundary
Use of `MessageLocator` across a security boundary is not supported. MessageLocator construction SHOULD NOT contain encryption or signing process. The initial codecs MUST NOT add a MAC, nonce, initialization vector, random padding, credential, secret, encryption material, or other randomized security envelope.

#### Scenario: A MessageLocator would cross a security boundary
- **WHEN** an application would pass a `MessageLocator` across a security boundary
- **THEN** this usage is not supported

### Requirement: Every Provider codec MUST have property-based coverage
Slack, Feishu/Lark, DingTalk, WeCom, and Microsoft Teams MUST each use property-based testing for the canonical codec law. Generators MUST produce semantically valid payloads across meaningful boundaries of every field in the canonical schema. The property MUST observe decoded-model equality, not equality between separately encoded locator strings. Malformed and invalid locators MUST remain example-based tests.

#### Scenario: The property finds a counterexample
- **WHEN** the property-based testing framework finds a failure
- **THEN** it MUST report a reproducible shrunk private payload that still violates the canonical codec law

### Requirement: Persistence tests MUST depend only on the public scalar contract
Public persistence conformance tests MUST retain only the locator string before reconstruction. Pickle, deepcopy, Provider-private classes or fields, and `isinstance` checks against private locator classes MUST NOT serve as persistence evidence.

#### Scenario: Scalar persistence is tested
- **WHEN** a test retains Python object serialization metadata across the boundary
- **THEN** the canonical public-scalar test contract MUST treat it as non-conforming

