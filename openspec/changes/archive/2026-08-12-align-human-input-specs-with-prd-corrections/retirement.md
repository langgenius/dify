# Retirement

- Reason: This change served as a one-time correction migration and should not remain as a hidden normative overlay after the corrected rules are distributed.
- Normative specifications: distributed into `openspec/specs/` and the final `human-input-v2-api-contracts` delta
- Roadmap and delivery status: Linear project `HITL IM 支持`
- Implementation ownership: explicit successors listed below
- Archiving this change does not imply completion of transferred implementation work.

## Requirement / Task Mapping

| Correction slice | Status | Evidence or successor |
| --- | --- | --- |
| External Contact same-email coexistence domain rules | `normative-spec` | distributed to living `contact-directory-governance` and `human-input-v2-contact-directory-core` |
| Dynamic Email remains EmailAddress-backed | `normative-spec` | distributed to living `hitl-recipient-resolution`, `hitl-approval-access-control`, `human-input-v2-recipient-resolution-core`, `human-input-v2-submission-runtime` |
| `all_workspace_contacts` migration semantics | `normative-spec` | distributed to final API contract delta and successor UI compatibility owner |
| scope-aware IM binding reuse | `normative-spec` | distributed to living `human-input-v2-im-control-plane-core` and final API contract delta |
| backend migration helper implementation | `accepted-and-landed` | archived `WTA-1288` |
| migration compatibility UI round-trip and compatibility presentation | `linear-owned` | `WTA-1971` |
| IM card handled-status update | `linear-owned` | `WTA-1970` |
| final API contract absorption | `focused-change-owned` | `openspec/changes/human-input-v2-api-contracts/` |

## Main Successors

- final API contract sync: `human-input-v2-api-contracts`
- migration compatibility round-trip: `WTA-1971`
- IM card handled-status update: `WTA-1970`
- already landed backend migration helper: archived `WTA-1288`
