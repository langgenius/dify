# E2B Sandbox Provider Notes

## Purpose
- Implements the E2B-backed `VirtualEnvironment` provider and bootstraps sandbox metadata, file I/O, and command execution.

## Key Decisions
- Sandbox metadata is gathered during `_construct_environment` using the E2B SDK before returning `Metadata`.
- Architecture/OS detection uses a single `uname -m -s` call split by whitespace to reduce round-trips.
- Command execution streams stdout/stderr through `QueueTransportReadCloser`; stdin is unsupported.

## Edge Cases
- `release_environment` raises when sandbox termination fails.
- `execute_command` runs in a background thread; consumers must read stdout/stderr until EOF.

## Tests/Verification
- None yet. Add targeted service tests when behavior changes.
