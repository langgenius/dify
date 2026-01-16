## Purpose

`api/services/dataset_service.py` hosts dataset/document service logic used by console and API controllers.

## Batch document operations

- Batch document workflows should avoid N+1 database queries by using set-based lookups.
- Tenant checks must be enforced consistently across dataset/document operations.
- `DocumentService.get_documents_by_ids(...)` fetches documents for a dataset using `id.in_(...)`.
- `FileService.get_upload_files_by_ids(...)` performs tenant-scoped batch lookup for `UploadFile` (dedupes ids with `set(...)`).

## Verification plan

- Exercise document list and download endpoints that use the service helpers.
- Confirm batch download uses constant query count for documents + upload files.
- Request a ZIP with a missing document id and confirm a 404 is returned.
