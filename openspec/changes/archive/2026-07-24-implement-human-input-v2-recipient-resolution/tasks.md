## 1. Define Recipient Inputs And Outputs

- [x] 1.1 Add approval package boundaries and import tests proving recipient resolution has no Flask, database, ORM, or provider dependencies.
- [x] 1.2 Add red-first tests for static Contact, one-time Email, dynamic Email, current initiator, unsupported dynamic types, and invalid Email specifications.
- [x] 1.3 Implement immutable recipient specification values and the explicit workflow node v2 configuration adapter.
- [x] 1.4 Add red-first tests for canonical subject keys, immutable approval plans, matched sources, endpoint plans, rejected facts, and serialization boundaries.
- [x] 1.5 Implement `ResolvedApprovalPlan` values and transport-neutral recipient rejection reasons.

## 2. Implement The Deep Resolver

- [x] 2.1 Add failing tests proving static Contact, matching dynamic Email, and current initiator collapse into one Contact approver with every matched source.
- [x] 2.2 Add failing tests for unmatched valid Email, normalized Email deduplication, invalid-value retention, and mixed valid/invalid inputs.
- [x] 2.3 Add failing endpoint-planning tests for Email plus effective IM, Email-only, multiple channels, and no usable endpoint.
- [x] 2.4 Add failing tests for request-scoped debug replacement, unavailable initiator, stable no-valid-recipients results, and immutable stored specifications.
- [x] 2.5 Implement `RecipientResolver.resolve(...)` as the only public validation, upgrade, canonicalization, deduplication, debug, and endpoint-planning entry point.
- [x] 2.6 Add deterministic-order tests covering approvers, matched sources, endpoints, and rejected facts across repeated resolutions.

## 3. Validate And Handoff

- [x] 3.1 Run targeted recipient resolution and existing workflow node configuration regression tests.
- [x] 3.2 Run targeted coverage for recipient resolution modules and record the measured report.
- [x] 3.3 Run backend formatting, linting, and type checking for affected files.
- [x] 3.4 Re-read affected docstrings and validate `implement-human-input-v2-recipient-resolution` with OpenSpec.
