# Human Input Channel Management API

The Community and Cloud Workspace Console exposes one canonical owner/admin
resource for channel configuration:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/console/api/workspaces/current/human-input/channels` | List every supported channel in product order |
| `GET` | `/console/api/workspaces/current/human-input/channels/{kind}/{provider}` | Read persisted state |
| `PUT` | `/console/api/workspaces/current/human-input/channels/{kind}/{provider}` | Validate and dispatch a reserved save request |
| `DELETE` | `/console/api/workspaces/current/human-input/channels/{kind}/{provider}` | Delete persisted configuration |
| `POST` | `/console/api/workspaces/current/human-input/channels/{kind}/{provider}/test` | Validate and dispatch a reserved test request |

Supported complete references are `email/resend`, `im/slack`, `im/feishu`, and
`im/ding_talk`. This change implements the control-plane API only.
Provider-dependent operations remain unimplemented, and Delivery Runtime
behavior is intentionally unspecified.

Resend read and delete use the existing Email control-plane repository. Resend
save and test return `unsupported_operation` with code
`resend_provider_connectivity_not_implemented` before repository, credential,
or provider work. The three IM references return `unsupported_operation` with
code `im_channel_management_not_implemented`.

Enterprise does not enter these channel-management routes. Every canonical
Channels collection, item, and test path returns HTTP `501` from a shared
pre-dispatch edition gate before authentication, DTO mapping, composition,
repository, or provider work.

## Requests

The route and `candidate.provider` discriminator must match. Unknown fields,
ownership selectors, masked secrets, and preserve-existing markers for IM
providers are rejected.

Resend save:

```json
{
  "candidate": {
    "provider": "resend",
    "sender_email": "approvals@example.com",
    "sender_name": "Approvals",
    "api_key": "re_new_key"
  }
}
```

The DTO maps a non-blank `api_key` to a new-secret candidate and an omitted or
blank value to an explicit retain-existing directive. Production save remains
unimplemented until provider connectivity is delivered.

The canonical DTOs reserve provider-discriminated IM request shapes, but IM
read, save, delete, and test operations are not implemented by this change.
They perform no IM persistence, credential protection, or provider I/O.

## Safe responses

Persisted views contain only status, scope, capabilities, safe metadata, and
credential-free summaries:

```json
{
  "kind": "email",
  "provider": "resend",
  "scope": {
    "kind": "workspace",
    "id": "workspace-id"
  },
  "configured": true,
  "status": "configured",
  "capabilities": ["configure", "delete", "secret_retention", "test"],
  "summary": {
    "provider": "resend",
    "sender_email": "approvals@example.com",
    "sender_name": "Approvals",
    "api_key_configured": true
  },
  "safe_status_reason": null,
  "last_checked_at": null
}
```

Candidate-test DTOs remain distinct from persisted views for the later
connectivity change. This API change does not send a Resend test Email.

No response includes plaintext, encrypted, or masked credential material,
provider request bodies, headers, or raw exception text.

## Errors

Community and Cloud channel-operation errors have one stable shape:

```json
{
  "error": {
    "category": "validation_failure",
    "code": "invalid_request"
  }
}
```

| HTTP status | Category |
| --- | --- |
| `400` | `validation_failure` |
| `404` | `unsupported_channel` |
| `405` | `unsupported_operation` |
| `409` | `not_configured`, `conflict`, or `stale_configuration` |
| `502` | `provider_failure` |
| `500` | `channel_failure` |

The Enterprise edition gate uses the existing Console HTTP error shape with
`code: "not_implemented"` and `status: 501`.

Provider-dependent operations are explicit stubs in this change; therefore no
provider body, exception, header, or credential can cross the API boundary.
