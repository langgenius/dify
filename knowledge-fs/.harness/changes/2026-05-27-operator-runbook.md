# Operator Runbook

## Summary

- Added `.harness/docs/juicefs-inspired-operator-runbook.md`.
- Covered daily control-plane checks, manifest inspection, staged commits, active sessions and leases, FSCK, GC, status, stats, consistency classes, cache policy, and incident response.
- Documented dry-run-first GC handling and explicit candidate idempotency keys.
- Documented MCP snapshot fingerprint use for reproducible multi-step agent workflows.

## Verification

- `rg -n "manifest|staged commits|fsck|gc|status|stats|consistency|cache policy|idempotency|snapshotFingerprint" .harness/docs/juicefs-inspired-operator-runbook.md`
