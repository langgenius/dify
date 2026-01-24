Summary:
- App assets download proxy endpoint (signed URL verification, stream from storage).

Invariants:
- Validates AssetPath fields (UUIDs, asset_type allowlist).
- Verifies tenant-scoped signature and expiration before reading storage.
- URL uses expires_at/nonce/sign query params.

Edge Cases:
- Missing files return NotFound.
- Invalid signature or expired link returns Forbidden.

Tests:
- Verify signature validation and invalid/expired cases.
