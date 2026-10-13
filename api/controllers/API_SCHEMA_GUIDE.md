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

## Error Responses

Every 4xx/5xx response is documented with the surface's error body: `ErrorResponse` (`code`, `message`, `status`,
optional `params`/`details`) on Console, Web and Service API, and `ErrorBody` on `/openapi/v1`. Every operation also
documents a `default` error response with that open body: generic errors (authentication, validation, rate limits,
unexpected failures) can answer any operation and clients handle them centrally, so no operation lists them.
Responses that declare their own error schema keep it.

Document business errors so clients can branch on `code`:

- A handler lists what it and its callees raise with `@error_responses(SomeError, ...)` from `libs.external_api`.
- A view decorator documents its own errors on the wrapper it returns: `return document_errors(decorated, SomeError)`.
  Guards in a Resource's `method_decorators` are documented on the class with `document_errors(ResourceClass, ...)`.
- List only business errors: `HTTPException` subclasses that declare an `error_code`. Werkzeug exceptions and
  exceptions with a dedicated handler (`ValueError`, `NoPermissionError`, and others registered through
  `ExternalApi.document_error_handler`) are generic and covered by `default`; listing them is an error, and so is
  listing a `BaseHTTPException` subclass that keeps the placeholder `error_code`.
- Record an error raised only from an unreachable branch, such as an `except` for a service error the call never
  raises, as `@error_responses(..., unreachable=(SomeError,))`. It stays undocumented.
- View decorators must keep `__apidoc__` from the view they wrap (`functools.wraps` does, unless `updated=()`; then
  add `"__apidoc__"` to `assigned`), or the errors documented below them are lost.

`make api-error-lint` (`api/dev/lint_error_responses.py`) checks these declarations against what each Console, Web and
Service API operation statically raises, and CI runs it. `--fix` adds what handlers are missing to their
`@error_responses`; `make lint` runs it with `--fix`. Undocumented errors raised by a decorator are reported against the
decorator and fixed there. Stale entries are warnings; `--fix --prune` removes them. Inference cannot see instance
calls, signals or other dynamic dispatch, so add errors raised that way by hand.

Controller unit tests also check every 4xx/5xx JSON response an `ExternalApi` serves against that API's generated
document (`tests/unit_tests/controllers/error_contract.py`): the body must be the standard error body, unless the
status declares its own model, and its `code` must be one the operation documents for that status or one of the
surface's generic codes. This covers the dynamic paths static inference cannot follow, on every path a test exercises.

Each documented code is one shared component, `{Code}Error` (`draft_workflow_not_sync` documents as
`DraftWorkflowNotSyncError`): the error body with `code` and `status` fixed, plus the class's `details_model` (a
Pydantic model) when it declares one. The response of its status references it; several codes on one status are an
`anyOf`, and a status that also declares its own model keeps it beside them. Within a surface a code maps to one
status, and classes that share a code must agree on its status and details; the document fails to build otherwise.
Statuses that no handler or decorator documents keep the open error body.

Signal errors by raising, not by returning `(body, status)`:

- Raise a `BaseHTTPException` subclass so the body carries `code`, `message` and `status` and the code can be
  documented. Do not call `flask_restx.abort` with a message or extra fields; it replaces the standard body.
- Raise `libs.exception.RelayedHTTPError` for a code and status relayed from a downstream service at runtime. It emits
  the standard body; the operation's open `default` error already documents it, since its codes are not known per
  class, so listing it in `error_responses` adds nothing to the document.
- An endpoint that must keep a legacy error body (for example `{"error": message}`) declares it with
  `@ns.response(status, ..., Model)` so the contract describes what the client receives.

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

## Catalog metadata on /openapi/v1

Every `@endpoint` on `/openapi/v1` declares `op` (dotted lowercase id), `kind`
(`object|list|sse|text|file`) and a one-line `summary`; they live on the route's
`EndpointSpec`. `controllers/openapi/_catalog.py` derives the rest (input schema, bind,
tags) from the route and its Pydantic models. Files are declared in the body model with
`UploadPart`; never add a separate files decorator or parse `request.files` in a handler.
Run ops are per app mode (`console_app.<mode>.run`), each a self-contained route with the exact
body that mode takes.
Next steps for the caller go in a `hints` field (see `_hints.py`); `hints` is reserved.
Frozen after release: kind names, bind values, the pagination envelope, and any field the
CLI's fold table reads from an SSE event. Breaking input changes get a new op id; the old
one stays and is marked `deprecated=True`.
