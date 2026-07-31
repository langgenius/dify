## 1. Contact And Recipient Core Alignment

- [ ] 1.1 Update Contact admission and persistence specs so External Contact email overlap with internal contacts is allowed while workspace-local External Contact uniqueness is preserved.
- [ ] 1.2 Update recipient-resolution specs so Dynamic Email always resolves as one-time email and no longer upgrades into Contact-backed recipients.
- [ ] 1.3 Update submission/runtime-facing core specs so EmailAddress-backed grants remain email-scoped even when a current Contact later shares the same normalized email.
- [ ] 1.4 Update IM control-plane core specs so effective binding resolution remains workspace-scoped and does not assume one global `im_user_id -> Contact` mapping.

## 2. Migration And Node-Editor Rule Alignment

- [ ] 2.1 Add migration delta specs that replace lossy `whole_workspace` expansion with explicit `all_workspace_contacts` migration output.
- [ ] 2.2 Add node-editor delta specs that preserve imported `all_workspace_contacts` data while continuing to block active same-email multi-Contact selection during manual authoring.
- [ ] 2.3 Define migrated duplicate-overlap compatibility rules so preserved imported recipient combinations remain round-trippable instead of being silently normalized away.

## 3. Console And Runtime Contract Alignment

- [ ] 3.1 Update console contact-management and migration-helper contract specs to remove `non-Dify email only`, Contact auto-upgrade, and lossy whole-workspace snapshot assumptions.
- [ ] 3.2 Update runtime form contract specs so Dynamic Email and one-time email remain on the public email-proof path and cannot be converted into authenticated Contact approval by email overlap alone.
- [ ] 3.3 Update EE admin and workspace override contract specs so allowed IM identity reuse is modeled as scope-aware binding resolution rather than uniqueness conflict.
- [ ] 3.4 Add IM card status-update spec coverage so supported providers update handled cards without making card-state mutation a prerequisite for accepted task handling.

## 4. Terminology And Consistency Validation

- [ ] 4.1 Normalize affected UI and contract specs to use `Platform Contact` as the Contact type label while keeping `Organization` only for ownership-boundary concepts.
- [ ] 4.2 Audit the touched living specs and in-progress change-local specs for any remaining reverse rules that still reject internal/external same-email coexistence or still promote Dynamic Email into Contact semantics.
- [ ] 4.3 Run OpenSpec validation for the new change and resolve any artifact or delta-format issues before handing the plan off for implementation.
