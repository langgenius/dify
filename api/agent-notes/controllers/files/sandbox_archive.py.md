Summary:
- Sandbox archive upload/download proxy endpoints (signed URL verification, stream to storage).

Invariants:
- Validates tenant_id and sandbox_id UUIDs.
- Verifies tenant-scoped signature and expiration before storage access.
- URL uses expires_at/nonce/sign query params.

Edge Cases:
- Missing archive returns NotFound.
- Invalid signature or expired link returns Forbidden.

Tests:
- Add unit tests for signature validation if needed.
