# Main Nav Gating Follow-ups

Context: the desktop MainNav rewrite moved several workspace, account, tools, and marketplace entry points out of the old header/account-setting layout. These notes track product-contract questions that should be resolved before treating the rewrite as behavior-complete.

## 1. Account-setting modal naming and moved destinations

Current branch behavior:

- `setShowAccountSettingModal(PROVIDER)` routes to `/tools?section=provider`.
- `setShowAccountSettingModal(DATA_SOURCE)` routes to `/tools?section=data-source`.
- `setShowAccountSettingModal(API_BASED_EXTENSION)` routes to `/tools?section=api-based-extension`.

Old behavior: these calls opened the account-setting modal and switched to the matching tab.

Question:

- Since Provider, Data Source, and API-based Extension are no longer inside Account Settings in the new design, should this API still be named `setShowAccountSettingModal` for those destinations?

Follow-up decision needed:

- Either keep the compatibility shim but document that these payloads are now route destinations, or introduce a clearer navigation API for integration destinations and update call sites intentionally.
- Re-check call sites launched from workflows, datasets, and app configuration. Some contexts may expect an in-place modal instead of leaving the current page.

## 2. Integrations sidebar disabled entries

Current branch behavior:

- Integrations includes disabled entries for Trigger, Agent Strategy, and Extension.
- These are visible but not actionable.

Status:

- Currently being handled separately.

Follow-up decision needed:

- Decide whether disabled future entries should remain visible, be hidden until supported, or be gated by feature flags/edition/role.
- If they stay visible, define the tooltip or disabled-state copy so users understand why the option is unavailable.

## 3. Plugin and marketplace status parity

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

Current branch behavior:

- Desktop MainNav account menu includes Language and Timezone submenus.
- Mobile still uses the default header/account dropdown path.
- The default account dropdown does not expose the Language settings entry.

Decision:

- Preserve the old language-access contract across breakpoints.
- The desktop MainNav path is acceptable; the missing case is mainly mobile/default account dropdown, including dataset-operator users on mobile.

Follow-up decision needed:

- Add an equivalent language entry to the default/mobile account path, or otherwise ensure mobile users can still reach language settings.
- Keep this as gate-contract parity, not a visual requirement to recreate the old Account Settings sidebar.

## 5. Apps and Datasets quick-switch/create parity

Old header behavior:

- `AppNav` could show the current app, list more apps, load more results, and launch create-app flows from the header nav.
- `DatasetNav` could show the current dataset, list more datasets, load more results, and launch dataset creation from the header nav.

Current MainNav behavior:

- Apps and Datasets are static navigation links.
- App/dataset quick switching and create actions are not present in the desktop MainNav.

Follow-up decision needed:

- Decide whether the new design intentionally removes these quick-switch/create affordances.
- If not, add equivalent behavior in the MainNav flow without copying the old header UI directly.

## 6. Branding-gated Help and Support behavior

Old account dropdown behavior:

- When `systemFeatures.branding.enabled` is `true`, the whole Dify help/community group is hidden.
- That hidden group includes Docs, Support, Compliance, Roadmap, GitHub, and About.

Current MainNav behavior:

- HelpMenu keeps the trigger visible, but its content is gated by `!systemFeatures.branding.enabled`.
- This can produce an empty Help popup when branding is enabled.

Open question:

- The old coarse gate also hides Support, but Support can contain instance-specific channels such as configured Zendesk or support email in addition to Dify forum/Discord links.
- Confirm whether branded deployments should hide Support entirely, or keep configured customer support channels while hiding Dify official/community links.

Follow-up decision needed:

- If strict old parity is required, hide the HelpMenu trigger when branding is enabled.
- If branded deployments should retain support access, split Support into customer-support and Dify-community items with separate gates.

## 7. Paid plan Billing access from workspace plan

Old header behavior:

- The header plan badge was clickable.
- For sandbox/free plans, clicking the badge opened the pricing modal.
- For non-sandbox paid plans, clicking the badge opened Account Settings on the Billing tab.

Current MainNav behavior:

- Sandbox/free plans have an explicit Upgrade action in the WorkspaceCard credit row.
- Non-sandbox paid plans show the workspace plan badge, but the badge is display-only.
- The WorkspaceCard Settings menu item routes to Account Settings on the Billing tab.
- Invite Members remains the Members entry, so Settings and Invite Members do not duplicate the same destination.

Open question:

- Confirm whether product still wants the plan badge itself to be clickable, or whether the Settings-to-Billing menu item is the intended MainNav access path.
- Avoid making the plan badge itself clickable unless the interaction is explicitly approved, because the WorkspaceCard already uses a button to open the workspace menu.

Recommended default:

- Keep sandbox/free behavior as the explicit Upgrade action.
- Keep the plan badge display-only.
- Use the WorkspaceCard Settings item as the Billing entry.
