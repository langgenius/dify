## 1. Implement OTP Proof-Session Domain

- [ ] 1.1 Add red-first tests for ten-minute expiry, sixty-second cooldown, five-send limit, five-attempt limit, successful verification, invalidation, and terminal states.
- [ ] 1.2 Implement `OTPChallenge` as a separate aggregate with typed state and transport-neutral rejection reasons.
- [ ] 1.3 Add red-first tests for injected clock/hash ports, plaintext exclusion, proof serialization boundaries, and raw-code rejection at submission authorization.
- [ ] 1.4 Implement narrow clock/hash ports and immutable verified Email OTP proof output.
- [ ] 1.5 Add failing stale-proof tests for changed Contact Email, deleted External Contact, and same-Email Contact recreation.

## 2. Implement Grant-Scoped Persistence

- [ ] 2.1 Review the OTP challenge ORM record and align docstrings, constraints, indexes, hash fields, and logical references with the separate aggregate.
- [ ] 2.2 Add red-first mapper tests for OTP state, counters, timestamps, hash metadata, and proof-safe domain output.
- [ ] 2.3 Implement explicit OTP mappers under `api/repositories/human_input_v2/approval/`.
- [ ] 2.4 Add repository contract tests for grant-scoped replacement, counters, verification, invalidation, stale Email handling, rollback on hash/audit/write failure, and eager loading.
- [ ] 2.5 Implement the SQLAlchemy OTP adapter using the approver grant row as the stable lock scope.
- [ ] 2.6 Add the OTP Alembic revision plus metadata, upgrade, and scoped downgrade tests.
- [ ] 2.7 Add CI-only PostgreSQL coverage proving concurrent resend leaves exactly one usable challenge.

## 3. Validate And Handoff

- [ ] 3.1 Run targeted OTP domain, mapper, repository, migration, and Form Core regression tests; document CI-only coverage not runnable locally.
- [ ] 3.2 Run targeted coverage for OTP modules and record the measured report.
- [ ] 3.3 Run backend formatting, linting, and type checking for affected files.
- [ ] 3.4 Re-read affected docstrings and validate `implement-human-input-v2-otp-proof-session` with OpenSpec.
