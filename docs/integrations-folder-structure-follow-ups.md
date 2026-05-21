# Integrations Folder Structure Follow-ups

Context: the onboarding UI rewrite moved Integrations into a first-class `/integrations/...` route family, but the implementation still intentionally reuses several legacy Account Settings, Tools, and Plugins components. This document records the recommended cleanup order after this branch is merged into `main`.

## Current Structure

| Area | Current location | Status |
| --- | --- | --- |
| MainNav shell | `web/app/components/main-nav` | Healthy. Keep the shallow `components/` layout. |
| Integrations route adapter | `web/app/(commonLayout)/integrations/[[...slug]]/page.tsx` | Canonical route entry. |
| Integrations route contract | `web/app/components/tools/integration-routes.ts` | Works, but ownership belongs to Integrations long-term. |
| Integrations shell and sidebar | `web/app/components/tools/integrations-page.tsx` | Works, but ownership belongs to Integrations long-term. |
| Integrations section renderer | `web/app/components/tools/integration-section-renderer.tsx` | Reuse-first adapter for existing pages. |
| Model Provider page | `web/app/components/header/account-setting/model-provider-page` | Still active and widely imported. Do not move first. |
| Data Source page | `web/app/components/header/account-setting/data-source-page-new` | Still active and reused by Integrations. Do not move first. |
| API Extension page | `web/app/components/header/account-setting/api-based-extension-page` | Still active and reused by Integrations. Do not move first. |
| Plugin management primitives | `web/app/components/plugins/plugin-page` | Still active for `/plugins` and reused by Integrations. Do not delete. |

## Recommended Timing

Do not do a broad folder move in the current onboarding UI branch. This branch already carries UI, route, i18n, and permission behavior changes; adding large path churn would increase merge conflict risk with `main` and make review harder.

After this branch is merged into `main`, do the structure cleanup in small PRs.

## Step 1: Establish Integrations Ownership

When: first cleanup PR after the onboarding UI branch lands on `main`.

Goal: make the new feature ownership visible without moving legacy implementation internals.

Recommended target:

```text
web/app/components/integrations/
  routes.ts
  integrations-page.tsx
  integration-section-renderer.tsx
  sidebar/
  sections/
  hooks/
```

Move or wrap only Integrations-owned shell files first:

| Current file | Target |
| --- | --- |
| `web/app/components/tools/integration-routes.ts` | `web/app/components/integrations/routes.ts` |
| `web/app/components/tools/integrations-page.tsx` | `web/app/components/integrations/integrations-page.tsx` |
| `web/app/components/tools/integration-section-renderer.tsx` | `web/app/components/integrations/integration-section-renderer.tsx` |
| `web/app/components/tools/integration-page-header.tsx` | `web/app/components/integrations/integration-page-header.tsx` |
| `web/app/components/tools/integration-sidebar-nav-item.tsx` | `web/app/components/integrations/sidebar/nav-item.tsx` |
| `web/app/components/tools/integration-sidebar-nav-item-styles.ts` | `web/app/components/integrations/sidebar/nav-item-styles.ts` |
| `web/app/components/tools/permission-quick-panel.tsx` | `web/app/components/integrations/sidebar/permission-quick-panel.tsx` |
| `web/app/components/tools/hooks/use-integration-*` | `web/app/components/integrations/hooks/*` |

Keep compatibility re-exports from the old `components/tools` paths during this PR if the import churn becomes large.

## Step 2: Add Section Adapters

When: same PR as Step 1 if the diff stays small, otherwise a second cleanup PR.

Goal: avoid importing legacy Account Settings components directly from the shared renderer.

Add thin adapters:

```text
web/app/components/integrations/sections/model-provider-section.tsx
web/app/components/integrations/sections/data-source-section.tsx
web/app/components/integrations/sections/api-extension-section.tsx
web/app/components/integrations/sections/tools-section.tsx
web/app/components/integrations/sections/plugin-category-section.tsx
```

These adapters should keep importing the existing implementation from its current location. For example, `model-provider-section.tsx` can wrap `header/account-setting/model-provider-page` and pass Integrations-specific props such as `stickyToolbar`, `fixedWarningAlignment`, and `hideSystemModelSelectorProviderSettingsFooter`.

Do not duplicate page logic in the adapters.

## Step 3: Remove Confirmed Dead Account Settings Pages

When: after Step 1 and Step 2 are merged and the app still passes route/modal smoke tests.

Likely removal candidates:

| Candidate | Reason |
| --- | --- |
| `web/app/components/header/account-setting/Integrations-page` | Superseded by the new Integrations shell. No production reference should remain. |
| `web/app/components/header/account-setting/plugin-page` | Superseded by `web/app/components/plugins/plugin-page`. No production reference should remain. |

Before deleting, run a fresh reference check:

```bash
rg "Integrations-page|header/account-setting/plugin-page" web/app web/context web/service
```

Delete only if the remaining hits are tests for the files being removed.

## Step 4: Consider Deeper Page Moves Later

When: only after the Integrations shell ownership is stable and `main` has absorbed the onboarding rewrite.

Do not start by moving these directories:

| Directory | Why |
| --- | --- |
| `header/account-setting/model-provider-page` | Its types, hooks, model selector, model auth, and modals are imported by workflows, datasets, app debug, services, and global modal context. |
| `header/account-setting/data-source-page-new` | Its types and credential flows are used by dataset creation, Notion selectors, and Integrations. |
| `header/account-setting/api-based-extension-page` | It is still reused by feature settings and Integrations. |
| `plugins/plugin-page` | `/plugins`, Integrations install controls, plugin category pages, plugin task status, and plugin detail flows still depend on it. |

If these are moved later, split the work by domain:

1. Extract shared types/hooks into stable shared modules.
2. Move only one page family per PR.
3. Keep temporary re-export files at old paths if external imports are still broad.
4. Remove re-exports only after the branch has settled on `main`.

## Merge Conflict Strategy

Prefer additive changes first:

- New adapter files under `components/integrations`.
- Small import updates in the route adapter and renderer.
- Temporary re-exports from old paths when needed.

Avoid early broad changes:

- Large `git mv` batches.
- Renaming model-provider/data-source imports across workflow and dataset code.
- Deleting reused plugin primitives.
- Combining structure cleanup with visual changes.

## Validation Checklist

Run at least:

```bash
pnpm test app/components/tools/__tests__/integrations-page.spec.tsx
pnpm test app/components/tools/__tests__/integration-routes.spec.ts
pnpm test app/components/main-nav/__tests__/index.spec.tsx
pnpm eslint --cache --quiet app/components/tools app/components/main-nav
```

For deeper moves, also run targeted tests for the moved page family, such as model-provider, data-source, API extension, plugin-page, and plugin detail panel tests.
