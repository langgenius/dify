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
    return WorkflowRunNodeExecutionResponse.model_validate(result, from_attributes=True).model_dump(mode="json")
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
    return WorkflowRunPaginationResponse.model_validate(result, from_attributes=True).model_dump(mode="json")
```

Do not do this for GET query parameters:

```python
@console_ns.expect(console_ns.models[WorkflowRunListQuery.__name__])
def get(...):
    ...
```

That documents a GET request body and is not the expected contract.

## Responses

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
return WorkflowRunNodeExecutionResponse.model_validate(
    workflow_node_execution,
    from_attributes=True,
).model_dump(mode="json")
```

If the service can return `None`, translate that into the expected HTTP error before validation:

```python
workflow_run = service.get_workflow_run(...)
if workflow_run is None:
    raise NotFound("Workflow run not found")

return WorkflowRunDetailResponse.model_validate(workflow_run, from_attributes=True).model_dump(mode="json")
```

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

For schema and documentation changes, run focused tests and generate Swagger JSON:

```bash
uv run --project . pytest tests/unit_tests/controllers/common/test_schema.py
uv run --project . pytest tests/unit_tests/commands/test_generate_swagger_specs.py tests/unit_tests/controllers/test_swagger.py
uv run --project . dev/generate_swagger_specs.py --output-dir /tmp/dify-openapi-check
```

Inspect affected endpoints with `jq`. Check that:

- GET parameters are `in: query`.
- Request bodies appear only where the endpoint has a body.
- Responses reference the expected `*Response` schema.
- Response schemas use public serialized names, not internal validation aliases like `inputs_dict`.

