## MODIFIED Requirements

### Requirement: Workflow resume MUST occur only after submission commit

The submit application handler MUST enqueue workflow resume only after the authorized submission transaction commits, using an idempotent resume identity. The same `SubmissionTransaction` that loads authorization facts and commits the submission MUST reconstruct trusted resume correlation from the persisted form owner, owning workflow node execution, active workflow pause and matching form-backed pause reason. The transaction MUST retain the validated immutable identity for post-commit enqueue. The form MUST NOT persist a `workflow_pause_id`, and a caller-supplied pause identifier MUST NOT establish resume authority.

#### Scenario: Commit succeeds

- **WHEN** `commit_authorized_submission_once` returns success
- **THEN** the handler MUST enqueue resume after commit with the persisted form and workflow owner identity

#### Scenario: Runtime resume correlation is resolved

- **WHEN** a runtime form is prepared for authorized submission commit
- **THEN** the active `SubmissionTransaction` MUST verify that its `workflow_node_execution_id` belongs to its `workflow_run_id`
- **AND** the active pause for that run MUST contain a pause reason whose `form_id` matches the submitted form
- **AND** the transaction MUST retain the resulting immutable resume identity until commit succeeds

#### Scenario: Runtime resume correlation does not match

- **WHEN** the node execution belongs to another run, no active pause exists for the run, or the active pause has no reason for the submitted form
- **THEN** the active `SubmissionTransaction` MUST reject resume correlation before authorized submission persistence commits
- **AND** it MUST NOT enqueue a workflow resume

#### Scenario: Resume enqueue fails

- **WHEN** enqueue fails after commit
- **THEN** the form MUST remain submitted, the failure MUST NOT roll back persistence, and logs MUST include tenant, form and workflow identifiers

#### Scenario: Resume is dispatched repeatedly

- **WHEN** the same persisted form and workflow owner identity is requested more than once
- **THEN** the resume port contract MUST make duplicate dispatch safe
