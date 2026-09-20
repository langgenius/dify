# IM provider response fixtures

`feishu_lark/sanitized_directory_user.json` and
`slack/sanitized_directory_user.json` are redacted user objects extracted from
real directory HTTP responses. Object keys, nesting, scalar types, booleans,
empty strings, and field presence are preserved; nonempty strings are replaced.
These are not unmodified captures.

Local source captures (not committed):

- Feishu: `temp/fixtures/feishu-025-directory-read.json`, captured 2026-09-20.
  The response includes `avatar_72`, `avatar_240`, `avatar_640`, and `avatar_origin`.
- Slack: `temp/fixtures/slack-005-directory-read.json`.
  The response includes `profile.image_24` through `profile.image_512`.

Teams photo requests were also captured on 2026-09-20 under `temp/fixtures/`.
Initially all three users returned HTTP 404 `ImageNotFound` for both `/photo`
and `/photo/$value`. After the user set a photo, a follow-up capture succeeded:

- `ms_teams-028-avatar-metadata.json`: HTTP 200, 394 × 394 photo metadata.
- `ms_teams-029-avatar-read.json`: HTTP 200, `image/jpeg`, 33,448 bytes.
  The original response bytes are stored losslessly as base64 with
  `body_encoding=base64` and verified against the HTTP response body.

The Graph photo API requires bearer authentication and returns image bytes,
not a public image URL. The earlier 404 captures remain available as negative cases.

`ms_teams/sanitized_avatar_not_found.json` is the redacted JSON response body
from `temp/fixtures/ms_teams-022-avatar-read.json`. Error codes and structure
are retained; other nonempty strings are replaced. Batch directory tests use
this case to verify that one missing photo does not discard other users' avatars.

`ms_teams/sanitized_avatar_success.json` is derived from
`temp/fixtures/ms_teams-029-avatar-read.json`. It retains the HTTP 200 status,
`Content-Type: image/jpeg`, and the original 33,448 JPEG bytes encoded as base64.
The request and all other response headers are omitted to exclude credentials,
user identifiers, and request identifiers. The image has no EXIF metadata; its
bytes are unchanged (SHA-256:
`101888393d81d5b2dc6dacd4ff10cc1e6f4dd42011849ff30584dd00c55ed636`).
The Teams directory test replays this response through the avatar downloader
and checks that the directory entry contains the JPEG MIME type and exact bytes.

Unmodified HTTP envelopes contain credentials and personal data and remain local.
