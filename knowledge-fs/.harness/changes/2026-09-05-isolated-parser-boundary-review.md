# Independent isolated parser lifecycle review

Security, resource accounting and failure handling were reviewed separately from the initial process-isolation implementation.

## Fixes

- Shared executor validates supplied byte counts as finite, non-negative safe integers before reserving input memory; `NaN` or negative counts cannot corrupt admission accounting.
- A worker message followed by nonzero exit or signal termination is rejected. Receiving a result is not proof that the isolated operation completed cleanly.
- Cancellation preserves all legal abort reasons, including falsy `null`, `false` and `0`, instead of confusing them with absence of failure.
- Native IPC responses validate the success artifact against the existing core contract and validate error packet shape/bounds, producing a typed terminal response failure on malformed output.
- The internal native-isolation wrapper accepts only serializable options; function-valued callback options fail up front rather than throwing during IPC. Standalone native parser factories retain their original callback API.

## Verification

- Fourteen new regression tests were written and failed before these fixes (one existing Infinity-over-limit path already rejected correctly).
- New boundary tests plus existing real-child and lifecycle tests: 28 passed.
- API app TypeScript check passed. Biome check/format passed for the four touched implementation/test files.

## Reviewed trade-offs

- Response contract validation happens after the child has enforced its 32 MiB serialized output limit; this costs a bounded parent-side validation/copy, accepted for boundary correctness.
- A 256 MiB V8 heap limit is not an OS RSS sandbox. Child process termination, input/output byte caps, and image pixel limits are distinct protections and must be described as such. No claim of a hard per-child native-memory ceiling is made.
- Worker queue slots are still held until actual child close. No early abort release or remote retry behavior was introduced.
