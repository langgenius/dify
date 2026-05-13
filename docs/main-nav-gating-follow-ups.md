# Main Nav Gating Follow-ups

Context: the desktop MainNav rewrite moved several workspace, account, tools, and marketplace entry points out of the old header/account-setting layout. These notes track product-contract questions that should be resolved before treating the rewrite as behavior-complete.

Current status:

- Open: account-setting modal navigation API, Marketplace install/error status parity, default account language entry, Integrations plugin install permission gating.
- Partially resolved: Apps/Datasets quick-switch/create parity.
- Resolved: Integrations sidebar placeholder state, branding-gated Help trigger, workspace plan billing access.

## 1. Account-setting modal naming and moved destinations

Status: Open.

Current branch behavior:

- `setShowAccountSettingModal(PROVIDER)` routes to `/integrations/model-provider`.
- `setShowAccountSettingModal(DATA_SOURCE)` routes to `/integrations/data-source`.
- `setShowAccountSettingModal(API_BASED_EXTENSION)` routes to `/integrations/tools/api-extension`.

Old behavior: these calls opened the account-setting modal and switched to the matching tab.

Question:

- Since Provider, Data Source, and API-based Extension are no longer inside Account Settings in the new design, should this API still be named `setShowAccountSettingModal` for those destinations?

Follow-up decision needed:

- Either keep the compatibility shim but document that these payloads are now route destinations, or introduce a clearer navigation API for integration destinations and update call sites intentionally.
- Re-check call sites launched from workflows, datasets, and app configuration. Some contexts may expect an in-place modal instead of leaving the current page.

## 2. Integrations sidebar disabled entries

Status: Resolved.

Previous branch behavior:

- Integrations includes disabled entries for Trigger, Agent Strategy, and Extension.
- These are visible but not actionable.

Current branch behavior:

- Trigger, Agent Strategy, and Extension are no longer disabled placeholders.
- These sections route to `PluginCategoryPage` with the corresponding plugin category.

Resolution:

- No remaining disabled-entry gating decision is tracked here.

## 3. Plugin and marketplace status parity

Status: Open.

Old header behavior:

- `PluginsNav` showed plugin install progress and error state through the installing icon and red indicator.
- Installing tasks showed the downloading icon.
- Failed or erroring install tasks showed the red status indicator.

Current MainNav behavior:

- MainNav has a Marketplace link, but it does not surface plugin installing/error state.

Follow-up decision needed:

- Decide whether MainNav Marketplace should preserve the old plugin task status indicator.
- If yes, reuse the existing `usePluginTaskStatus` behavior instead of creating a parallel status source.

## 4. Mobile/default account language entry

Status: Open.

Current branch behavior:

- Desktop MainNav account menu includes Language and Timezone submenus.
- The main app layout now uses MainNav across breakpoints.
- The default account dropdown does not expose the Language settings entry.
- The default account dropdown still exists in non-MainNav account/header surfaces such as the account layout.

Decision:

- Preserve the old language-access contract across breakpoints.
- The desktop MainNav path is acceptable; the missing case is default account-dropdown parity wherever that path remains active.

Follow-up decision needed:

- Add an equivalent language entry to the default account path, or otherwise ensure users in those surfaces can still reach language settings.
- Keep this as gate-contract parity, not a visual requirement to recreate the old Account Settings sidebar.

## 5. Apps and Datasets quick-switch/create parity

Status: Partially resolved.

Old header behavior:

- `AppNav` could show the current app, list more apps, load more results, and launch create-app flows from the header nav.
- `DatasetNav` could show the current dataset, list more datasets, load more results, and launch dataset creation from the header nav.

Current MainNav behavior:

- Apps is no longer only a static navigation link: MainNav includes a Web Apps section with installed web app search, pin, delete, and navigation behavior.
- Apps still does not preserve the old `AppNav` current-app switcher, load-more behavior, or create-app flows.
- Datasets is still a navigation link and does not preserve the old `DatasetNav` current-dataset switcher, load-more behavior, or dataset creation entry.

Follow-up decision needed:

- Decide whether the new design intentionally removes these quick-switch/create affordances.
- If not, add equivalent behavior in the MainNav flow without copying the old header UI directly.

## 6. Branding-gated Help and Support behavior

Status: Resolved.

Old account dropdown behavior:

- When `systemFeatures.branding.enabled` is `true`, the whole Dify help/community group is hidden.
- That hidden group includes Docs, Support, Compliance, Roadmap, GitHub, and About.

Current MainNav behavior:

- `HelpMenu` returns `null` when `systemFeatures.branding.enabled` is `true`.
- This prevents the empty Help trigger/popup path.

Resolution:

- Current implementation follows strict old parity for MainNav: the whole Help trigger is hidden for branded deployments.

Optional future product question:

- If branded deployments should retain configured customer support channels, split Support into customer-support and Dify-community items with separate gates.

## 7. Paid plan Billing access from workspace plan

Status: Resolved.

Old header behavior:

- The header plan badge was clickable.
- For sandbox/free plans, clicking the badge opened the pricing modal.
- For non-sandbox paid plans, clicking the badge opened Account Settings on the Billing tab.

Current MainNav behavior:

- Sandbox/free plans have an explicit Upgrade action in the WorkspaceCard credit row.
- Non-sandbox paid plans have an explicit View Plan action in the same plan-action row.
- Both actions open the pricing modal.
- The workspace plan badge is display-only.
- The WorkspaceCard Settings menu item routes to Account Settings on the Billing tab.
- Invite Members remains the Members entry, so Settings and Invite Members do not duplicate the same destination.

Resolution:

- Keep sandbox/free and paid behavior as the explicit plan-action row.
- Keep the workspace plan badge display-only.
- Use the WorkspaceCard Settings item as the Billing entry.

## 8. Integrations plugin install permission gating

Status: Open.

Old `/plugins` behavior:

- `InstallPluginDropdown` is shown only when `canManagement` is true.
- The plugins page drag-and-drop install uploader is enabled only when the plugins tab is active and `canManagement` is true.

Current Integrations behavior:

- The Integrations sidebar install dropdown remains visible.
- Trigger and Agent Strategy empty states show Marketplace, GitHub, and Local Package File install entry points according to marketplace/local-package feature gates.
- Trigger and Agent Strategy drag-and-drop package install is gated by `restrict_to_marketplace_only`, not by `canManagement`.

Question:

- Should `canManagement` hide all Integrations install entry points, including Marketplace, GitHub, Local Package File, and drag-and-drop install, or should some Marketplace browsing/entry affordances remain visible for users without plugin management permission?

Follow-up decision needed:

- If Integrations should match strict old `/plugins` install permission behavior, apply `canManagement` to every install path, not only drag-and-drop.
- If Marketplace should remain visible as a read-only discovery path, separate browse affordances from install actions so users without `canManagement` cannot trigger installation flows.
