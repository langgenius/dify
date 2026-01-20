## Purpose

Unit tests for the console dataset document download endpoint:

- `GET /datasets/<dataset_id>/documents/<document_id>/download`

## Testing approach

- Uses `Flask.test_request_context()` and calls the `Resource.get(...)` method directly.
- Monkeypatches console decorators (`login_required`, `setup_required`, rate limit) to no-ops to keep the test focused.
- Mocks:
  - `DatasetService.get_dataset` / `check_dataset_permission`
  - `DocumentService.get_document` for single-file download tests
  - `DocumentService.get_documents_by_ids` + `FileService.get_upload_files_by_ids` for ZIP download tests
  - `FileService.get_upload_files_by_ids` for `UploadFile` lookups in single-file tests
  - `services.dataset_service.file_helpers.get_signed_file_url` to return a deterministic URL
- Document mocks include `id` fields so batch lookups can map documents by id.

## Covered cases

- Success returns `{ "url": "<signed>" }` for upload-file documents.
- 404 when document is not `upload_file`.
- 404 when `upload_file_id` is missing.
- 404 when referenced `UploadFile` row does not exist.
- 403 when document tenant does not match current tenant.
- Batch ZIP download returns `application/zip` for upload-file documents.
- Batch ZIP download rejects non-upload-file documents.
- Batch ZIP download uses a random `.zip` attachment name (`download_name`), so tests only assert the suffix.
