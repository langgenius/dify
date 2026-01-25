Summary:
- Manages sandbox archive uploads/downloads for workspace persistence.

Invariants:
- Archive storage key is sandbox/<tenant_id>/<sandbox_id>.tar.gz.
- Signed URLs are tenant-scoped and use external files URL.

Edge Cases:
- Missing archive skips mount.

Tests:
- Covered indirectly via sandbox integration tests.
