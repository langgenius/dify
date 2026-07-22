# Command Registry Output Validation

## Summary

- Completed R4 from the code-review remediation plan by making command output validation explicit.
- Preserved existing command behavior when no output schema is configured.

## Changes

- Added optional `outputSchema` to `RegisteredCommandDefinition`.
- Validated handler output with the configured schema before returning it from `CommandRegistry.execute()`.
- Failed invalid outputs with a command-scoped error so callers do not receive malformed tool data.
- Added regression coverage for valid output parsing, invalid output rejection, and legacy unschematized output behavior.

## Verification

- `pnpm --filter @knowledge/core test -- src/command-registry.test.ts`

## Notes

- Existing API/sourcefs command registrations continue to work without output schemas; future command definitions can opt in incrementally.
