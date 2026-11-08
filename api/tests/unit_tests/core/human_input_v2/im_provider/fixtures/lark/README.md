# Lark unit test protocol fixtures

`sanitized_protocol.json` contains 23 redacted HTTP exchanges captured on
2026-10-14 and 2026-10-15 from `https://open.larksuite.com` using the local `temp/im.env` Lark
credentials. Successful messages and card updates were sent through the actual
`LarkIMProviderAdapter` and official SDK. Raw envelopes remain under
`temp/fixtures/` in both the original workspace and capture worktree and are excluded from Git.
The raw index is `temp/fixtures/README.md`; the directory capture list is
`temp/lark-directory-manifest.json`. Raw files and the list were copied byte
for byte. Tests load only the redacted JSON beside this README and require no
`temp` directory, capture scripts, credentials, or regeneration step:

| Fixture key | Local source capture |
| --- | --- |
| `token` | `lark-021-directory-tenant.json` |
| `tenant` | `lark-022-directory-tenant.json` |
| `scope` | `lark-023-directory-full-scope.json` |
| `users` | `lark-024-directory-full-users.json` |
| `departments` | `lark-025-directory-full-departments.json` |
| `scope_restricted` | `lark-007-scope-read.json` |
| `users_denied` | `lark-008-directory-users.json` |
| `departments_denied` | `lark-009-directory-departments.json` |
| `user_detail` | `lark-010-directory-user-detail.json` |
| `invalid_credentials` | `lark-012-invalid-credentials.json` |
| `text` | `lark-013-message-send-text.json` |
| `card` | `lark-014-message-send-card.json` |
| `replace` | `lark-015-message-update-card.json` |
| `invalid_recipient` | `lark-016-message-invalid-recipient.json` |
| `invalid_reference` | `lark-017-message-stale-reference.json` |
| `invalid_token` | `lark-018-tenant-invalid-token.json` |
| `stream_connect` | `lark-032-card-stream-prepare.json` |
| `bot_info` | `lark-stream-bot-info.json` |
| `stream_connect_invalid` | `lark-stream-invalid-credentials.json` |
| `stream_card` | `lark-037-card-send-stream.json` |
| `stream_replace` | `lark-040-card-update-stream.json` |
| `webhook_card` | `lark-047-card-send-webhook.json` |
| `webhook_replace` | `lark-050-card-update-webhook.json` |

| Callback fixture | Local source capture |
| --- | --- |
| `sanitized_card_action_stream.json` | `lark-038-card-action-stream.json` |
| `sanitized_stream_ack.json` | `lark-039-stream-ack.json` |
| `sanitized_url_challenge.json` | `lark-041-webhook-ingress.json` |
| `sanitized_card_action_webhook.json` | `lark-049-card-action-webhook.json` |

Methods, API domains and paths, query parameters, JSON keys, nesting, scalar
types, booleans, empty strings, and field presence are preserved. Credentials,
identifiers, email addresses, timestamps, provider diagnostics, and tenant
profile strings are replaced. Request headers and all response headers except
`Content-Type` are omitted. Controlled test message and card content is retained,
including nested JSON strings. Identifiers are replaced consistently across
requests and responses so message locators can be exercised through card updates.

The application initially authorized one user. Root user and department listing
returned HTTP 403, code `40004`; these captures remain as negative cases.
After its directory scope was expanded on 2026-10-15, both root endpoints
returned HTTP 200, code `0`, and the actual adapter credential test succeeded.
The new user page contains two users. The successful scope response still omits
`department_ids`, and the empty terminal department page omits `items`.
Credential and directory success tests now replay these complete captured
pages; no synthetic successful root page is used. The invalid reference
capture returns HTTP 400, code `99992354`, which is a generic reference rejection,
not one of the adapter's stale-message codes. The invalid tenant token returns
code `99991663` and is classified as an authentication rejection.

The captured `user_detail` object omits `name`, `enterprise_email`, and
`avatar`. The later root-list response likewise omits those fields for both
users. Its directory test checks their captured order, email projection, and
missing names and avatars. Another test combines the successful user page with
the earlier department rejection to verify that failure discards accumulated
users. Missing-message-ID cases remain explicit synthetic negative responses.

`test_lark_sdk_boundary.py` replays these fixtures at `requests.Session.send`
while retaining the real Lark adapter, generated SDK requests, token exchange,
and response parsing. Each test uses an isolated SDK token cache. Unexpected
requests fail locally, including when adapter error handling catches the
transport exception; the tests never make network requests or load credentials.

The stream discovery test also replays the real `/callback/ws/endpoint` response
and asynchronous bot identity lookup. It runs the official channel and SDK
startup/stop lifecycle, replacing only HTTP dispatch and the WebSocket
connection. The endpoint's host, ticket, device identifier, and query values are
redacted, while query field names and `ClientConfig` fields are preserved.
An invalid-secret endpoint capture retains provider code `1000040345`. Its
test verifies a safe startup failure, release of owned resources, and no socket
connection after the provider rejects discovery.

Shared Feishu/Lark adapter, Webhook, and STREAM behavior tests run against both
typed provider wrappers. This includes authentication failures, strict complete
directory reads, avatar downloads, ambiguous sends, persisted message references,
signature/encryption rejection, consumer acceptance, wire ACK draining, shutdown
failures, and independent resource lifecycles. Synthetic callback contract tests
also run for both provider discriminators and both ingress kinds, covering
private-marker recognition, required submitted facts, safe diagnostics, and
union-ID actor identity. The historical Feishu callback captures retain their
Feishu provenance; they are not presented as real Lark callback captures.

The two card-action captures came from separate real Lark Messenger form
submissions on 2026-10-15. Both submitted `comment=Ready to ship` and the
configured default `decision=hold`; STREAM selected `reject`, and Webhook
selected `approve`. Each original message was replaced through the real API
after its callback was accepted. The test application was restored and
published in long-connection mode, version `1.0.3`, after capture. Application
permissions and member visibility were unchanged.

Webhook fixtures retain the encrypted-envelope shape and signing-header family.
The redacted native callback is encrypted again with a deterministic test-only
key and IV, and its signature is recomputed. The encrypted URL challenge uses
the same test key and verification token and retains the observed absence of
business-event signing headers. Original ciphertext, headers, and response bytes
remain untouched in the local source captures.

STREAM fixtures retain the actual SDK callback class and callback-response
serialization. The ACK is a redacted protobuf frame whose original payload is
`{"code":200,"data":"e30="}`. Replay reconstructs an incoming frame using
the captured delivery-header shape and SDK event serialization; this
reconstructed incoming frame is not claimed to be original wire bytes. The
real dispatcher, channel, event stream, consumer, and response serializer run
before the captured ACK shape is compared. Consumer rejection must produce
an error response rather than a successful ACK. The tests also exercise
sender-to-decoder metadata agreement, exact native payload preservation,
signature/token/tenant rejection, and updating the original message reference.
