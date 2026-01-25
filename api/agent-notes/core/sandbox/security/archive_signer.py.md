Summary:
- Generates and verifies signed URLs for sandbox archive upload/download.

Invariants:
- tenant_id and sandbox_id must be UUIDs.
- Signatures are tenant-scoped and include operation, expiry, and nonce.

Edge Cases:
- Missing tenant private key raises ValueError.
- Expired or tampered signatures are rejected.

Tests:
- Add unit tests if sandbox archive signature behavior expands.
