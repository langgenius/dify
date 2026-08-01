## ADDED Requirements

### Requirement: Supported IM Providers MUST update card status after card handling completes
当一个 IM Provider 明确支持卡片状态更新时，系统在对应卡片被处理完成后 MUST 回写该 IM 侧卡片状态。卡片状态回写是 provider-capability-gated 的后置处理行为，MUST NOT 作为授权、提交鉴权或 workflow resume 的前置条件。

#### Scenario: Provider supports card status update and card is handled successfully
- **WHEN** one IM-delivered Human Input card is handled successfully and its provider supports card-status update
- **THEN** the system MUST issue one provider-side card-status update that reflects the handled state

#### Scenario: Provider does not support card status update
- **WHEN** one IM-delivered Human Input card is handled successfully but its provider does not support card-status update
- **THEN** the system MUST complete task handling without requiring any provider-side card-status mutation

#### Scenario: Card status update is evaluated after handling decision
- **WHEN** the system determines the final handling outcome for one IM card interaction
- **THEN** authorization and submission success MUST already be decided before any provider-side card-status update is attempted

### Requirement: Card status update MUST be scoped to the delivered card instance
Provider-side card-status update MUST target the delivered IM card instance that corresponds to the handled task interaction. The system MUST NOT broadcast one generic status mutation to unrelated cards, historical cards, or cards delivered through another provider identity.

#### Scenario: One task has multiple delivery endpoints
- **WHEN** one task was delivered through multiple endpoints and only one specific IM card instance is being reconciled
- **THEN** the card-status update MUST target only that corresponding IM card instance

#### Scenario: Historical card token is stale
- **WHEN** the provider-side identifier for one historical IM card instance is no longer usable
- **THEN** the system MUST treat the card-status update as a best-effort follow-up and MUST NOT reinterpret the stale identifier as another card instance

#### Scenario: Different provider identity delivered another card
- **WHEN** another provider identity or workspace-scoped binding produced a different IM card delivery for the same task history
- **THEN** the update logic MUST NOT assume one shared global card instance across those deliveries

### Requirement: Card status update failure MUST NOT roll back completed task handling
If one provider-side card-status update fails after task handling has been accepted, the system MUST keep the accepted task outcome, MUST NOT roll back the submission result, and MUST surface the card-update failure as follow-up operational state.

#### Scenario: Task handling committed but card update fails
- **WHEN** one task submission or card-side handling outcome has already been accepted and the subsequent provider-side card-status update fails
- **THEN** the task outcome MUST remain accepted and the card-update failure MUST NOT reverse workflow progress

#### Scenario: Retry policy is provider-specific follow-up
- **WHEN** one supported provider exposes retryable card-status update errors
- **THEN** any retry behavior MUST be treated as follow-up delivery-state handling rather than a second submission attempt

#### Scenario: Audit needs to distinguish handling and card-update outcomes
- **WHEN** one card-status update succeeds or fails after handling
- **THEN** the system MUST preserve enough operational state to distinguish the accepted handling outcome from the later card-update outcome

### Requirement: Inbox event record MUST retain `raw_payload` in the same atomic write
When the system ingests one IM card event through the Inbox pattern, the event record MUST retain `raw_payload` for debugging. `raw_payload` MUST be persisted on the event record itself as part of the same atomic write as the rest of the event fields. `raw_payload` MUST NOT participate in dedupe, routing, authorization, or business decisions.

#### Scenario: IM card event is written to Inbox
- **WHEN** one inbound IM card event is accepted into the Inbox
- **THEN** the system MUST persist `raw_payload` together with the event record in the same atomic write

#### Scenario: Event processing reads business fields
- **WHEN** downstream processing performs dedupe, routing, authorization, or business handling for one Inbox event
- **THEN** it MUST rely on the existing event/business fields and MUST NOT treat `raw_payload` as decision input

#### Scenario: No separate raw-payload failure mode exists
- **WHEN** one IM card event record is persisted successfully
- **THEN** `raw_payload` MUST already be present on that event record, and the system MUST NOT model a separate “event succeeded but raw payload write failed” state
