Summary:
- Defines AssetPath facade + typed asset path classes for app-asset storage access.
- Maps asset paths to storage keys and generates presigned or signed-proxy URLs.
- Signs proxy URLs using tenant private keys and enforces expiration.
- Exposes app_asset_storage singleton for reuse.

Invariants:
- AssetPathBase fields (tenant_id/app_id/resource_id/node_id) must be UUIDs.
- AssetPath.from_components enforces valid types and resolved node_id presence.
- Storage keys are derived internally via AssetPathBase.get_storage_key; callers never supply raw paths.
- AppAssetStorage.storage returns the cached presign wrapper (not the raw storage).

Edge Cases:
- Storage backends without presign support must fall back to signed proxy URLs.
- Signed proxy verification enforces expiration and tenant-scoped signing keys.
- load_or_none treats SilentStorage "File Not Found" bytes as missing.

Tests:
- Unit tests for ref validation, storage key mapping, and signed URL verification.
