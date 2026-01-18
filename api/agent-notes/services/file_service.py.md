## Purpose

`api/services/file_service.py` owns business logic around `UploadFile` objects: upload validation, storage persistence,
previews/generators, and deletion.

## Key invariants

- All storage I/O goes through `extensions.ext_storage.storage`.
- Uploaded file keys follow: `upload_files/<tenant_id>/<uuid>.<ext>`.
- Upload validation is enforced in `FileService.upload_file(...)` (blocked extensions, size limits, dataset-only types).

## Batch lookup helpers

- `FileService.get_upload_files_by_ids(tenant_id, upload_file_ids)` is the canonical tenant-scoped batch loader for
  `UploadFile`.

## Dataset document download helpers

The dataset document download/ZIP endpoints now delegate “Document → UploadFile” validation and permission checks to
`DocumentService` (`api/services/dataset_service.py`). `FileService` stays focused on generic `UploadFile` operations
(uploading, previews, deletion), plus generic ZIP serving.

### ZIP serving

- `FileService.build_upload_files_zip_tempfile(...)` builds a ZIP from `UploadFile` objects and yields a seeked
  tempfile **path** so callers can stream it (e.g., `send_file(path, ...)`) without hitting "read of closed file"
  issues from file-handle lifecycle during streamed responses.
- Flask `send_file(...)` and the `ExitStack`/`call_on_close(...)` cleanup pattern are handled in the route layer.

## Verification plan

- Unit: `api/tests/unit_tests/controllers/console/datasets/test_datasets_document_download.py`
  - Verify signed URL generation for upload-file documents and ZIP download behavior for multiple documents.
- Unit: `api/tests/unit_tests/services/test_file_service_zip_and_lookup.py`
  - Verify ZIP packing produces a valid, openable archive and preserves file content.
