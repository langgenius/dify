# API Schema Guide v2

## Naming

- Request body models: use a `Payload` suffix.
  - Example: `WorkflowRunPayload`, `DatasourceVariablesPayload`.
- Query parameter models: use a `Query` suffix.
  - Example: `WorkflowRunListQuery`, `MessageListQuery`.
- Response models: use a `Response` suffix and inherit from `ResponseModel`.
  - Example: `WorkflowRunDetailResponse`, `WorkflowRunNodeExecutionListResponse`.
- Keep these models near the controller when they are endpoint-specific. Move them to `schemas/*.py` only when shared by multiple controllers.

## Field definitions

- For fields with constraints or complicated documents, use `Field()`
- Differentiate optional + nullable, optional + non-nullable, required + nullable, required + non-nullable
  with approriate syntax. (TODO: check the frontend code for the actual situation??)

## Responses

- Return response models or plain data directly for successful responses; do not wrap them in success envelopes
  like `{"data": ...}` or `{"result": ...}`.
- TODO: (change this maybe for a better ad-hoc error handling) For errors, do not hand-build JSON error dicts in routes. Raise existing domain/API exceptions when they
  already express the case, or raise `ValueError` for invalid client input that should follow the legacy
  `invalid_param` behavior. Let the shared FastAPI exception handlers translate framework, validation, and
  legacy exceptions.
- Response tests should briefly validate JSON bodies with Pydantic contract models.

(TODO)
