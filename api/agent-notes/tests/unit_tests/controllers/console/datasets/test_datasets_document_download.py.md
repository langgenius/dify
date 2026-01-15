## Purpose

Unit tests for the console dataset document download endpoint:

- `GET /datasets/<dataset_id>/documents/<document_id>/download`

## Testing approach

- Uses `Flask.test_request_context()` and calls the `Resource.get(...)` method directly.
- Monkeypatches console decorators (`login_required`, `setup_required`, rate limit) to no-ops to keep the test focused.
- Mocks:
  - `DatasetService.get_dataset` / `check_dataset_permission`
  - `DocumentService.get_document`
  - `db.session.query(...).where(...).first()` chain for `UploadFile`
  - `core.file.helpers.get_signed_file_url` to return a deterministic URL

## Covered cases

- Success returns `{ "url": "<signed>" }` for upload-file documents.
- 404 when document is not `upload_file`.
- 404 when `upload_file_id` is missing.
- 404 when referenced `UploadFile` row does not exist.
- 403 when document tenant does not match current tenant.

