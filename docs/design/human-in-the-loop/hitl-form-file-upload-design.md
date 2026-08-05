# HITL Standalone Form File Upload Design

## Context

HITL standalone forms can be opened directly through a form link and do not require the 
submitter to sign in through the Web App. After `file` and `file-list` inputs were introduced, 
this standalone entry point also needed file upload support.

This entry point has a different identity model from the existing upload paths:

- Web App upload is backed by Web App authentication and an `EndUser` context.
- Service API upload is backed by API key authentication and the `user` parameter.
- HITL standalone form submission is link-based and anonymous from the product perspective. 
  The standalone submitter is not necessarily the workflow or chatflow initiator.

The goal is therefore not to add another general-purpose upload channel. The goal is to 
provide a constrained, short-lived upload capability that is scoped to one HITL form submission.

## Goals

- Support local file upload and remote URL upload from the HITL standalone page.
- Keep the standalone page independent from the Web App login flow.
- Avoid creating a technical HITL `EndUser`.
- Avoid changing the authentication model of existing Web App, Service API, or Console upload endpoints.
- Keep upload request parameters aligned with the equivalent Web App upload endpoints where possible.
- Invalidate upload capability once the form is submitted, expired, or timed out.
- Store uploaded files in a way that remains compatible with the existing workflow resume and file access model.

## Decision

HITL standalone upload uses a dedicated upload token that is bound to a form 
recipient. The token authorizes file upload only while the related form is still valid.

Files uploaded through the HITL standalone page are recorded under the workflow or 
chatflow initiator, not under the anonymous standalone submitter and not under a technical HITL `EndUser`.

This keeps workflow resume aligned with the existing execution model: one initiator owns the 
workflow run context, and file restoration continues to resolve files through that initiator's 
access scope. HITL-specific form/token/file relationships remain available for audit and tracing, 
but they do not become the source of truth for file access control.

## API Shape

HITL standalone upload has three endpoint categories:

| Purpose | HITL endpoint | Aligned Web App endpoint |
| --- | --- | --- |
| Issue upload token | `POST /api/form/human_input/{form_token}/upload-token` | No direct equivalent |
| Upload local file | `POST /api/form/human_input/files/upload` | `POST /api/files/upload` |
| Upload remote file | `POST /api/form/human_input/files/remote-upload` | `POST /api/remote-files/upload` |

Local upload follows the Web App `POST /api/files/upload` parameter shape:

- `multipart/form-data`
- Required `file`

Remote upload follows the Web App `POST /api/remote-files/upload` parameter shape:

- `application/json`
- Required `url`

HITL upload endpoints do not accept the Service API `user` parameter. That parameter 
belongs to the Service API `EndUser` mapping model and does not represent the anonymous 
standalone form submitter.

## Upload Token

The upload token is issued through the form token:

```http
POST /api/form/human_input/{form_token}/upload-token
```

Upload requests carry the token through the `Authorization` header:

```http
Authorization: bearer hitl_upload_{random_value}
```

The `hitl_upload_` prefix only distinguishes this credential from other bearer token types. 
Security comes from the high-entropy random value, server-side hash storage, and server-side state validation.

The token is bound to at least:

- The HITL form.
- The form recipient.
- The tenant.
- The app.

The token must satisfy these rules:

- It cannot outlive the form expiration.
- It cannot be used after the form is submitted, expired, or timed out.
- It is validated through the HITL upload path, not through the existing app token validation chain.

## Why Authorization Header

Putting `upload_token` in the request body would avoid additional CORS header configuration, but it has a bad failure mode for file upload. The server often needs to parse the multipart body before it can read a body token, so invalid requests can still consume upload parsing, temporary file, memory, or disk resources.

Using `Authorization: bearer hitl_upload_{random_value}` keeps authentication before expensive business processing:

- Invalid local upload requests can be rejected before reading the multipart body.
- Invalid remote upload requests can be rejected before any outbound network access.
- Bearer credential semantics are explicit and do not mix authentication with business fields.
- The token is not exposed through query strings, access logs, referrers, or browser history.

The tradeoff is that cross-origin deployments must allow the `Authorization` header and accept browser preflight requests. This is a reasonable configuration cost for an earlier and clearer authentication boundary.

## File Ownership

The standalone submitter is not a reliable product identity. Assigning files to a technical `EndUser` would also conflict with workflow resume: existing file restoration expects files to be readable through the workflow or chatflow initiator's scope.

The selected model is:

- If the original run was started by an `Account`, standalone HITL uploads are stored under that `Account`.
- If the original run was started by an `EndUser`, standalone HITL uploads are stored under that `EndUser`.

This means `UploadFile.created_by_role` and `UploadFile.created_by` continue to be the source of truth for file access control. HITL association records provide auditability but do not grant file access by themselves.

## Persistence And Audit

The HITL upload model has two responsibilities:

- Upload tokens authorize a form recipient to upload files while the form remains valid.
- Upload-file association records trace which files were uploaded through which HITL upload token.

These records are intentionally not tied to an `EndUser`. Their purpose is to preserve the HITL form/token/file relationship for audit and cleanup, not to define a separate file owner identity.

## Local Upload Boundary

Local upload should reuse the existing file upload semantics as much as possible:

- Request parameters stay aligned with Web App local upload.
- Existing file size checks, extension restrictions, and document-type handling remain applicable.
- Response shape stays aligned with the existing file upload response.
- Token validation happens before reading the upload body.

## Remote Upload Boundary

Remote upload should reuse the existing remote upload semantics as much as possible:

- Request parameters stay aligned with Web App remote upload.
- Token validation happens before outbound network access.
- Remote fetching continues to go through the existing SSRF-safe path.
- Remote filename, extension, MIME type, and file size inference stay aligned with existing behavior.
- Response shape stays aligned with the existing remote upload response.

## Alternatives Considered

### Unauthenticated Standalone Upload Endpoint

This is the simplest implementation option and does not require Web App login, `EndUser`, or a new token model. It was not selected because it exposes a public file upload surface that can be abused in SaaS or internet-facing deployments. Adding authentication later would also change the endpoint contract after clients have integrated with it.

### Reuse Web App Login And Upload

This would maximize reuse of existing Web App upload behavior, but it would bind HITL standalone forms to Web App login, app code, Web App enablement, and enterprise SSO semantics. That coupling is undesirable because HITL forms can be reached from independent channels such as email. It also makes product behavior unclear when the Web App is disabled or the app code is reset.

### Create `EndUser` From Form Token

This would satisfy existing upload paths that require an `EndUser` context and would allow form state to limit upload capability. It was not selected because the created identity would be technical rather than a real submitter identity. It would also mix HITL standalone form behavior into the broader `EndUser` model already used by Web App, Service API, triggers, MCP, and other entry points.

More importantly, files owned by this technical `EndUser` would not naturally be readable through the workflow initiator scope during workflow resume.

### Technical `EndUser` With File Access Exception

This would keep the technical `EndUser` as the file owner and add an access-control exception so the workflow initiator can read files uploaded through the same HITL form. It solves the immediate resume problem, but it pushes a HITL-specific rule into the general file access layer. Over time, that makes permission reasoning harder and increases the chance of accidental access expansion.

Assigning files directly to the workflow or chatflow initiator avoids that bypass and keeps file access governed by the existing owner model.

## Design Constraints

- HITL standalone upload does not reuse the Web App login flow.
- HITL standalone upload does not create a technical HITL `EndUser`.
- Upload token validity is controlled by form state.
- File access control continues to use the `UploadFile` owner as the source of truth.
- HITL association records provide audit and traceability only.
- Workflow resume continues to restore submitted file values through the existing file restoration path.

## Future Considerations

- If endpoint parameters change, compare them with the corresponding Web App upload endpoint to avoid unnecessary drift.
- If file ownership changes, verify the workflow resume path and the file access model together.
- If HITL forms support multiple submissions or reopening, token invalidation semantics must be redefined.
- If remote upload policy expands, prefer extending the existing remote upload and SSRF-safe behavior instead of creating a HITL-only network path.
