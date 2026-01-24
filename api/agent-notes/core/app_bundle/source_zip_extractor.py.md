Summary:
Summary:
- Extracts asset files from a zip and persists them into app asset storage.

Invariants:
- Rejects path traversal/absolute/backslash paths.
- Saves extracted files via AppAssetStorage draft refs.

Tests:
- Zip security edge cases and tree construction tests.
