## Purpose

`api/controllers/console/datasets/datasets_document.py` contains the console (authenticated) APIs for managing dataset documents (list/create/update/delete, processing controls, estimates, etc.).

## Storage model (uploaded files)

- For local file uploads into a knowledge base, the binary is stored via `extensions.ext_storage.storage` under the key:
  - `upload_files/<tenant_id>/<uuid>.<ext>`
- File metadata is stored in the `upload_files` table (`UploadFile` model), keyed by `UploadFile.id`.
- Dataset `Document` records reference the uploaded file via:
  - `Document.data_source_info.upload_file_id`

## Download endpoint

- `GET /datasets/<dataset_id>/documents/<document_id>/download`

  - Only supported when `Document.data_source_type == "upload_file"`.
  - Performs dataset permission + tenant checks via `DocumentResource.get_document(...)`.
  - Delegates `Document -> UploadFile` validation and signed URL generation to `DocumentService.get_document_download_url(...)`.
  - Applies `cloud_edition_billing_rate_limit_check("knowledge")` to match other KB operations.
  - Response body is **only**: `{ "url": "<signed-url>" }`.

- `POST /datasets/<dataset_id>/documents/download-zip`

  - Accepts `{ "document_ids": ["..."] }` (upload-file only).
  - Returns `application/zip` as a single attachment download.
  - Rationale: browsers often block multiple automatic downloads; a ZIP avoids that limitation.
  - Applies `cloud_edition_billing_rate_limit_check("knowledge")`.
  - Delegates dataset permission checks, document/upload-file validation, and download-name generation to
    `DocumentService.prepare_document_batch_download_zip(...)` before streaming the ZIP.

## Verification plan

- Upload a document from a local file into a dataset.
- Call the download endpoint and confirm it returns a signed URL.
- Open the URL and confirm:
  - Response headers force download (`Content-Disposition`), and
  - Downloaded bytes match the uploaded file.
- Select multiple uploaded-file documents and download as ZIP; confirm all selected files exist in the archive.

## Shared helper

- `DocumentService.get_document_download_url(document)` resolves the `UploadFile` and signs a download URL.
- `DocumentService.prepare_document_batch_download_zip(...)` performs dataset permission checks, batches
  document + upload file lookups, preserves request order, and generates the client-visible ZIP filename.
- Internal helpers now live in `DocumentService` (`_get_upload_file_id_for_upload_file_document(...)`,
  `_get_upload_file_for_upload_file_document(...)`, `_get_upload_files_by_document_id_for_zip_download(...)`).
- ZIP packing is handled by `FileService.build_upload_files_zip_tempfile(...)`, which also:
  - sanitizes entry names to avoid path traversal, and
  - deduplicates names while preserving extensions (e.g., `doc.txt` → `doc (1).txt`).
    Streaming the response and deferring cleanup is handled by the route via `send_file(path, ...)` + `ExitStack` +
    `response.call_on_close(...)` (the file is deleted when the response is closed).
