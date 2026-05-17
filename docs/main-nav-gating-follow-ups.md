# Main Nav Gating Follow-ups

Context: the desktop MainNav rewrite moved several workspace, account, tools, and marketplace entry points out of the old header/account-setting layout. These notes track product-contract questions that should be resolved before treating the rewrite as behavior-complete.

Current status:

- Open: account-setting modal navigation API naming, Marketplace/Integrations install task status parity, account language/timezone access parity.
- Partially resolved: Apps/Datasets quick-switch/create parity.
- Resolved: Integrations sidebar placeholder state, branding-gated Help trigger, workspace plan billing access, Integrations plugin install permission gating.

## 1. Account-setting modal naming and moved destinations

Status: Open.

Current branch behavior:

- `setShowAccountSettingModal(PROVIDER)` routes to `/integrations/model-provider`.
- `setShowAccountSettingModal(DATA_SOURCE)` routes to `/integrations/data-source`.
- `setShowAccountSettingModal(API_BASED_EXTENSION)` routes to `/integrations/tools/api-extension`.
- Document Settings no longer directly renders the old Account Settings modal for Provider; it uses the Integrations destination helper.

Old behavior: these calls opened the account-setting modal and switched to the matching tab.

Question:

- Since Provider, Data Source, and API-based Extension are no longer inside Account Settings in the new design, should this API still be named `setShowAccountSettingModal` for those destinations?

Follow-up decision needed:

- Either keep the compatibility shim but document that these payloads are now route destinations, or introduce a clearer navigation API for integration destinations and update call sites intentionally.
- Re-check call sites launched from workflows, datasets, and app configuration when new entry points are added. The known Document Settings provider entry has been migrated.

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
- Integrations has install entry points, but it does not surface the old `PluginTasks` install-task status entry near the Integrations install action.
- Marketplace is the product discovery surface for uninstalled integrations; `PluginTasks` is only the transient install-task status inbox for running/succeeded/failed installs.

Follow-up decision needed:

- Decide whether MainNav Marketplace should preserve the old plugin task status indicator.
- Decide whether Integrations should expose `PluginTasks` near the install action so users can inspect failed/running install tasks without returning to the old `/plugins` shell.
- If yes, reuse the existing `usePluginTaskStatus` behavior instead of creating a parallel status source.

## 4. Account language and timezone access

Status: Open.

Current branch behavior:

- Desktop MainNav account menu includes Language and Timezone submenus.
- The main app layout now uses MainNav across breakpoints.
- The default account dropdown does not expose a direct Language/Timezone settings entry.
- The default account dropdown still exists in non-MainNav account/header surfaces such as the account layout.
- Language and Timezone still belong to Account Settings, not Integrations.
- `UpdateSettingPopover` still links the timezone hint to `ACCOUNT_SETTING_TAB.LANGUAGE`.
- The legacy `ReferenceSettingModal` auto-update timezone hint also still links to `ACCOUNT_SETTING_TAB.LANGUAGE`.

Decision:

- Preserve the old language-access contract across breakpoints.
- The desktop MainNav path is acceptable; the remaining question is default account-dropdown parity wherever that path remains active, plus whether hidden Account Settings Language entry points should remain acceptable.

Follow-up decision needed:

- Add an equivalent language/timezone entry to the default account path, or otherwise ensure users in those surfaces can still reach language settings.
- Decide whether the Update Setting timezone hint should keep opening the hidden Account Settings Language page, or whether Account Settings should surface Language in its visible menu.
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

Status: Resolved.

Old `/plugins` behavior:

- `InstallPluginDropdown` is shown only when `canManagement` is true.
- The plugins page drag-and-drop install uploader is enabled only when the plugins tab is active and `canManagement` is true.

Previous Integrations behavior:

- The Integrations sidebar install dropdown remains visible.
- Trigger and Agent Strategy empty states show Marketplace, GitHub, and Local Package File install entry points according to marketplace/local-package feature gates.
- Trigger and Agent Strategy drag-and-drop package install is gated by `restrict_to_marketplace_only`, not by `canManagement`.

Current Integrations behavior:

- The Integrations sidebar install dropdown is shown only when `canManagement` is true.
- Trigger, Agent Strategy, and Extension empty-state install methods are hidden when `canInstall` is false.
- Trigger, Agent Strategy, and Extension drag-and-drop package install is gated by both `canInstall` and `restrict_to_marketplace_only`.
- Installed-package success can redirect to the actual installed integration category when the install context differs.

Resolution:

- Current implementation follows strict old `/plugins` install permission behavior for installation entry points while keeping Marketplace as a separate navigation surface.
