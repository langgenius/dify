## 1. Corrections Distributed To Living Specs

- [x] 1.1 Update living Contact admission and persistence specs so External Contact email overlap with internal contacts is allowed while workspace-local External Contact uniqueness is preserved.
- [x] 1.2 Update living recipient-resolution specs so Dynamic Email always resolves as EmailAddress-backed and no longer upgrades into Contact-backed recipients.
- [x] 1.3 Update living submission/runtime specs so EmailAddress-backed grants remain email-scoped even when a current Contact later shares the same normalized email.
- [x] 1.4 Update living IM control-plane specs so effective binding resolution remains workspace-scoped and does not assume one global `im_user_id -> Contact` mapping.

## 2. Corrections Distributed To Final API Contracts

- [x] 2.1 Update the final console contract delta to remove `non-Dify email only`, Contact auto-upgrade, and lossy whole-workspace snapshot assumptions.
- [x] 2.2 Update the final runtime form contract delta so Dynamic Email remains on the public email-proof path and cannot be converted into authenticated Contact approval by email overlap alone.
- [x] 2.3 Update the final EE / workspace binding-related contract delta so IM identity reuse is modeled as scope-aware binding resolution rather than uniqueness conflict.

## 3. Remaining Work Explicitly Re-Owned

- [x] 3.1 Record backend migration helper behavior as already landed under archived `WTA-1288`.
- [x] 3.2 Transfer migration / node-editor compatibility round-trip work to `WTA-1971`.
- [x] 3.3 Transfer IM card handled-status update to `WTA-1970` because it is new behavior, not a pure correction.
- [x] 3.4 Confirm no open question remains owned only by this correction change after archive.
