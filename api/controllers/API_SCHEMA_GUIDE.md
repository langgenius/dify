# API Schema Guide

This guide describes the expected Flask-RESTX + Pydantic pattern for controller request payloads, query
parameters, response schemas, and Swagger documentation.

## Principles

- Use Pydantic `BaseModel` for request bodies and query parameters.
- Use `fields.base.ResponseModel` for response DTOs.
- Keep runtime validation and Swagger documentation wired to the same Pydantic model.
- Prefer explicit validation and serialization in controller methods over Flask-RESTX marshalling.
- Do not add new Flask-RESTX `fields.*` dictionaries, `Namespace.model(...)` exports, or `@marshal_with(...)` for migrated or new endpoints.
- Do not use `@ns.expect(...)` for GET query parameters. Flask-RESTX documents that as a request body.

## Public System Features Contract

The Console and Web `/system-features` endpoints share `SystemFeatureModel`. They are unauthenticated and may be
requested during root SSR, so treat this response as a minimal public bootstrap allowlist. It is not a general
configuration endpoint, a feature registry, or a mirror of environment and Enterprise settings. Existing fields are
legacy inventory and do not establish precedent for new fields.

A new field is eligible only when all of the following are true:

1. Both Console and Web have named production consumers for the field.
2. Both consumers need the value before authentication and tenant/workspace bootstrap to render initial state or
   choose an authentication flow.
3. The value varies at runtime or by deployment and cannot be safely derived from an existing public contract.
4. The value is non-sensitive, safe to disclose without authentication, and has stable public API semantics.
5. Sending the value on every root bootstrap is demonstrably clearer and cheaper than a consumer-owned query.

Do not add:

- Backend-only policy or enforcement inputs, including security decisions, upload limits, or integration toggles.
- Console-only or Web-only configuration.
- Tenant, workspace, account, permission, billing-detail, or other post-authentication state.
- Provider payloads, operational diagnostics, large nested objects, or values without active consumers.
- Speculative fields added for possible future use.

Route excluded values to their actual owner:

- Keep backend enforcement behind a narrow service method or domain policy.
- Serve post-authentication state from an authenticated domain endpoint.
- Serve surface-specific bootstrap state from a Console- or Web-specific endpoint and account for its SSR, caching,
  and failure cost explicitly.
- Load large, slow, or page-specific data lazily through a consumer-owned query.

Every pull request that adds a System Features field must:

- Name both production consumer paths and explain why they require the value before authentication.
- Document the root SSR request, payload, caching, and failure-mode impact.
- Update the Pydantic owner, regenerate OpenAPI Markdown and TypeScript/Zod contracts, and update shared fixtures.
- Add Console and Web schema regression coverage. Do not hand-edit generated contracts or add compatibility defaults.

Reviewers should reject a field when its owner, pre-authentication need, or consumers are unclear.

## Naming

- Request body models: use a `Payload` suffix.
  - Example: `WorkflowRunPayload`, `DatasourceVariablesPayload`.
- Query parameter models: use a `Query` suffix.
  - Example: `WorkflowRunListQuery`, `MessageListQuery`.
- Response models: use a `Response` suffix and inherit from `ResponseModel`.
  - Example: `WorkflowRunDetailResponse`, `WorkflowRunNodeExecutionListResponse`.
- Use `ListResponse` or `PaginationResponse` for wrapper responses.
  - Example: `WorkflowRunNodeExecutionListResponse`, `WorkflowRunPaginationResponse`.
- Keep these models near the controller when they are endpoint-specific. Move them to `fields/*_fields.py` only when shared by multiple controllers.

## Registering Models For Swagger

Use helpers from `controllers.common.schema`.

```python
from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from libs.helper import dump_response
```

Register request payload and query models with `register_schema_models(...)`:

```python
register_schema_models(
    console_ns,
    WorkflowRunPayload,
    WorkflowRunListQuery,
)
```

Register response models with `register_response_schema_models(...)`:

```python
register_response_schema_models(
    console_ns,
    WorkflowRunDetailResponse,
    WorkflowRunPaginationResponse,
)
```

Response models are registered in Pydantic serialization mode. This matters when a response model uses
`validation_alias` to read internal object attributes but emits public API field names. For example, a response model
can validate from `inputs_dict` while documenting and serializing `inputs`.

## Request Bodies

For non-GET request bodies:

1. Define a Pydantic `Payload` model.
2. Register it with `register_schema_models(...)`.
3. Use `@ns.expect(ns.models[Payload.__name__])` for Swagger documentation.
4. Validate from `ns.payload or {}` inside the controller.

```python
class DraftWorkflowNodeRunPayload(BaseModel):
    inputs: dict[str, Any]
    query: str = ""


register_schema_models(console_ns, DraftWorkflowNodeRunPayload)


@console_ns.expect(console_ns.models[DraftWorkflowNodeRunPayload.__name__])
def post(self, app_model: App, node_id: str):
    payload = DraftWorkflowNodeRunPayload.model_validate(console_ns.payload or {})
    result = service.run(..., inputs=payload.inputs, query=payload.query)
    return dump_response(WorkflowRunNodeExecutionResponse, result)
```

## Query Parameters

For GET query parameters:

1. Define a Pydantic `Query` model.
2. Register it with `register_schema_models(...)` if it is referenced elsewhere in docs, or only use
   `query_params_from_model(...)` if a body schema is not needed.
3. Use `@ns.doc(params=query_params_from_model(QueryModel))`.
4. Validate from `request.args.to_dict(flat=True)` or an explicit dict when type coercion is needed.

```python
class WorkflowRunListQuery(BaseModel):
    last_id: str | None = Field(default=None, description="Last run ID for pagination")
    limit: int = Field(default=20, ge=1, le=100, description="Number of items per page (1-100)")


@console_ns.doc(params=query_params_from_model(WorkflowRunListQuery))
def get(self, app_model: App):
    query = WorkflowRunListQuery.model_validate(request.args.to_dict(flat=True))
    result = service.list(..., limit=query.limit, last_id=query.last_id)
    return dump_response(WorkflowRunPaginationResponse, result)
```

Do not do this for GET query parameters:

```python
@console_ns.expect(console_ns.models[WorkflowRunListQuery.__name__])
def get(...):
    ...
```

That documents a GET request body and is not the expected contract.

## Responses

`204 No Content` responses must not serialize a response body. Return the status using the established controller pattern;
do not return a dictionary, response model, or other payload.

Response models should inherit from `ResponseModel`:

```python
class WorkflowRunNodeExecutionResponse(ResponseModel):
    id: str
    inputs: Any = Field(default=None, validation_alias="inputs_dict")
    process_data: Any = Field(default=None, validation_alias="process_data_dict")
    outputs: Any = Field(default=None, validation_alias="outputs_dict")
```

Document response models with `@ns.response(...)`:

```python
@console_ns.response(
    200,
    "Node run started successfully",
    console_ns.models[WorkflowRunNodeExecutionResponse.__name__],
)
def post(...):
    ...
```

Serialize explicitly:

```python
return dump_response(WorkflowRunNodeExecutionResponse, workflow_node_execution)
```

`dump_response(...)` is the preferred response serialization helper for a single Pydantic response DTO. It validates
with `from_attributes=True` and returns `model_dump(mode="json")`, so SQLAlchemy models, plain objects, dictionaries,
Pydantic aliases, computed fields, and `datetime` values are serialized consistently.

For wrapper responses, pass a dictionary with the public wrapper fields:

```python
return dump_response(
    WorkflowRunPaginationResponse,
    {
        "data": workflow_runs,
        "page": page,
        "limit": limit,
        "has_more": has_more,
    },
)
```

If the service can return `None`, translate that into the expected HTTP error before validation:

```python
workflow_run = service.get_workflow_run(...)
if workflow_run is None:
    raise NotFound("Workflow run not found")

return dump_response(WorkflowRunDetailResponse, workflow_run)
```

Use manual `model_validate(...).model_dump(...)` only when the endpoint needs behavior that `dump_response(...)` does
not provide, such as returning a non-dict payload, intentionally excluding fields, or composing a `(body, status)` tuple.

## Public access-error contracts

IP-policy denials must be indistinguishable from each surface's native
authentication/not-found errors. The Gateway terminates denied requests before
execution; Core owns the corresponding native error baselines. Keep their JSON
bytes (sorted keys, compact separators, no trailing newline), status and
application-owned headers aligned. Do not add policy names, internal reasons,
`ip_access_denied`, or a policy-specific response header.

| Surface | Error contract |
| --- | --- |
| Service API | 401 `unauthorized`, `Access token is invalid`; missing/malformed Bearer uses `Authorization header must be provided and start with 'Bearer'` |
| OAuth OpenAPI | Its own 401 `unauthorized` / `invalid_token`, not the Service API's token message |
| MCP | 404 JSON-RPC `-32600` / `Server Not Found`, echoing a string/number request ID or null |
| Workflow Webhook | 404 standard Werkzeug `NotFound()` HTML without capability ID/private detail; not JSON |
| Plugin callback | 404 JSON `{"error":"Endpoint not found"}`; not the Workflow Webhook HTML |
| WebApp | Canonical 404 `app_not_found` / `App not found.`, with optional trusted `client_ip` |
| HITL form / upload | Native form 404 / invalid-upload-token 403, not a WebApp error page |

These errors use `Cache-Control: no-store`. JSON uses `Content-Type:
application/json`; Workflow Webhook uses `text/html; charset=utf-8`. Service API
401 also includes `WWW-Authenticate: Bearer realm="api"`; OpenAPI preserves its
native challenge/extra fields. For callers: if an API key is confirmed correct,
contact the App administrator to check whether the source IP is allowed.

MCP resolves unavailable identity before validating an invocation. Its error-only
ID parser accepts at most 64 KiB of strict UTF-8 JSON, nesting depth 64; absent,
invalid or oversized IDs become null. Numeric lexemes retain precision. Allowed
requests retain their existing body and protocol-validation path. Do not create
EndUsers or execute tools just to construct a not-found response.

Real dependency failures stay fail-closed errors, not a missing-policy allow.
The Gateway can present an unresolved canonical WebApp reference as opaque404
while still terminating the request; it must never forward it because the
read-side miss could be replication lag. Internal audit/metrics retain the true
policy-denied or resolution-failure reason even though the public response does
not disclose it.

### WebApp and Console 404 metadata

The Web and Console blueprints add optional request-local `client_ip` metadata
to their JSON app-not-found responses. This is transport error metadata,
not an App property, a new endpoint, or a field in successful response DTOs.

- Public WebApp errors use only `code: app_not_found`, `message: App not found.`,
  `status: 404` and optional `client_ip`. Strip exception-specific details that
  would reveal whether an App exists. Authenticated Console management errors
  preserve their original code/message/extra fields.
- A typed `app_not_found` 404 is eligible. Generic 404s are eligible only for
  matched GET app-identity routes: Web bootstrap (`site`, `parameters`, `meta`,
  `passport`, `login/status`, `webapp/access-mode`) and Console App/Agent,
  installed-App detail/parameters/meta, and trial-App detail/parameters.
- The field is a single normalized IP resolved using the configured trusted
  proxy boundary. Do not accept a caller's query/body IP or use unverified
  forwarding headers. If trust configuration or resolution is unavailable,
  omit `client_ip` instead of guessing a proxy address or changing the 404 to 503.
- These eligible errors use `Cache-Control: no-store`, because their IP metadata
  must not be shared between callers through URL-based error caching.
- Known unavailable/unpublished WebApp identity errors use this same404; arbitrary
  400s, auth errors and dependency503s do not. Public login/status and access-mode
  must validate a supplied App reference even when user authentication is disabled.
- HITL keeps its own canonical form/token error; no App IP is attached. Ordinary
  resource404s, unmatched routes, streams and Inner API contracts are unchanged.
  In particular, an authenticated Console trial403 is not converted to404.

For example, either an unavailable Web passport or a Gateway WebApp denial is:

```json
{
  "code": "app_not_found",
  "message": "App not found.",
  "status": 404,
  "client_ip": "203.0.113.42"
}
```

The existing frontend error transport already accepts optional `client_ip`;
success OpenAPI/TypeScript/Zod/oRPC contracts do not change for this enrichment.
Add coverage at the final serialized-response boundary, including exceptions
with their own `data`, so Flask-RESTX cannot silently discard the metadata.

## Legacy Flask-RESTX Patterns

Avoid adding these patterns to new or migrated endpoints:

- `ns.model(...)` for new request/response DTOs.
- Module-level exported RESTX model objects such as `workflow_run_detail_model`.
- `fields.Nested({...})` with raw inline dict field maps.
- `@marshal_with(...)` for response serialization.
- `@ns.expect(...)` for GET query params.

Existing legacy field dictionaries may remain where an endpoint has not yet been migrated. Keep that compatibility local
to the legacy area and avoid importing RESTX model objects from controllers.

## Verifying Swagger

For schema and documentation changes, run focused tests and generate Swagger JSON from the repository root:

```bash
uv run --project api pytest api/tests/unit_tests/controllers/common/test_schema.py
uv run --project api pytest api/tests/unit_tests/commands/test_generate_swagger_specs.py api/tests/unit_tests/controllers/test_swagger.py
uv run --project api python api/dev/generate_swagger_specs.py --output-dir /tmp/dify-openapi-check
```

Inspect affected endpoints with `jq`. Check that:

- GET parameters are `in: query`.
- Request bodies appear only where the endpoint has a body.
- Responses reference the expected `*Response` schema.
- Response schemas use public serialized names, not internal validation aliases like `inputs_dict`.

## Service API Documentation Handoff

The `dify-docs` repository imports `service-openapi.json` for the `/v1` API. It keeps a pinned export and adds
descriptions, examples, translations, and existing page URLs through documentation annotations. Fields, constraints,
references, response statuses, and security come from this repository's export.

Verify the public schema against request validation and response serialization, including intentional schema overrides
and excluded fields. Fix an inaccurate contract here and regenerate it before updating the documentation snapshot.
Record the full source commit SHA when handing off the export. For coordinated changes that are not committed yet,
also provide the source patch used to produce it; replace that patch with a clean committed export after merging.

The manual import, annotation review, build, and validation commands live in `tools/api-pipeline/README.md` in
`dify-docs`. Regenerate this repository's OpenAPI Markdown and TypeScript/Zod contracts whenever their inputs change.
