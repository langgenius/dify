## MODIFIED Requirements

### Requirement: Delivery facts MUST not control form lifecycle
Delivery attempts, endpoint-scoped upload capabilities and post-terminal card reconciliation outcomes MUST be append-oriented or independently transitionable operational facts whose failures do not directly mutate, roll back or compensate the form status.

#### Scenario: Delivery attempt fails
- **WHEN** an Email or IM delivery attempt fails
- **THEN** the attempt MUST record failure diagnostics and the form MUST remain in its current lifecycle state

#### Scenario: Upload capability is used
- **WHEN** a file is associated through an endpoint-scoped upload token
- **THEN** the association MUST remain scoped to that form and endpoint and MUST NOT grant submission authority

#### Scenario: Post-terminal card reconciliation fails
- **WHEN** the form has committed as submitted, timed out or expired and one or more card reconciliation targets fail, become stale, remain unsupported or have an unknown mutation outcome
- **THEN** those targets MUST retain their operational outcomes
- **AND** the committed form status and corresponding workflow branch decision MUST remain unchanged
