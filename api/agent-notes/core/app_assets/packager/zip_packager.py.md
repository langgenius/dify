# Zip Packager Notes

## Purpose
- Builds a ZIP archive of asset contents stored via the configured storage backend.

## Key Decisions
- Packaging writes assets into an in-memory zip buffer returned as bytes.
- Asset fetch + zip writing are executed via a thread pool with a lock guarding `ZipFile` writes.

## Edge Cases
- ZIP writes are serialized by the lock; storage reads still run in parallel.

## Tests/Verification
- None yet.
