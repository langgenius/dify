Summary:
- Sandbox lifecycle wrapper (ready/cancel/fail signals, mount/unmount, release).

Invariants:
- wait_ready raises with the original initialization error as the cause.
- release always attempts unmount and environment release, logging failures.

Tests:
- Covered by sandbox lifecycle/unit tests and workflow execution error handling.
