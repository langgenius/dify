## Purpose

Unit tests for `api/services/file_service.py` helper methods that are not covered by higher-level controller tests.

## What’s covered

- `FileService.build_upload_files_zip_tempfile(...)`
  - ZIP entry name sanitization (no directory components / traversal)
  - name deduplication while preserving extensions
  - writing streamed bytes from `storage.load(...)` into ZIP entries
  - yields a tempfile path so callers can open/stream the ZIP without holding a live file handle
- `FileService.get_upload_files_by_ids(...)`
  - returns `{}` for empty id lists
  - returns an id-keyed mapping for non-empty lists

## Notes

- These tests intentionally stub `storage.load` and `db.session.scalars(...).all()` to avoid needing a real DB/storage.
