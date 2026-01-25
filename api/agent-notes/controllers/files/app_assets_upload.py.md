Summary:
- App assets upload proxy endpoint (signed URL verification, upload to storage).

Invariants:
- Validates AssetPath fields (UUIDs, asset_type allowlist).
- Verifies tenant-scoped signature and expiration before writing storage.
- URL uses expires_at/nonce/sign query params.

Edge Cases:
- Invalid signature or expired link returns Forbidden.

Tests:
- Verify signature validation and invalid/expired cases.
