# Step-by-step Tour

This directory owns the cross-route Step-by-step Tour capability.

- `state.ts` owns the server query graph, the in-memory tour session, and domain commands.
- `storage.ts` owns only the persisted shell preference.
- `target-registry.ts` owns guide target registration and lookup across route content.
- `mount.tsx` composes the checklist, coachmarks, navigation, and analytics.
- `coachmark.tsx` owns the feature-specific portal, spotlight geometry, pointer blockers, and target interaction policy.
- Route consumers resolve only the guide branch and targets that depend on their page data.

Server state remains canonical in the TanStack Query cache. Components consume narrow derived atoms
and write-only commands instead of a combined account-state facade.

The checklist uses Dify UI Popover. The coachmark is a deliberate feature-owned exception because ordinary overlay primitives do not model an arbitrary-page spotlight; it is not a reusable overlay primitive.
