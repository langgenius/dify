# Block Selector

## Public contract

`index.tsx` is the only public component entry. It exports `BlockSelectorProps` and defaults to `BlockSelector`. There is no forwarding entry file or compatibility alias.

The component owns controlled or uncontrolled open state, disabled behavior, the modal popover, initial focus, Escape dismissal, focus return, and selection-driven close. Canvas subscriptions and available-item resolution live in the mounted popup content so a closed selector does not subscribe to workflow state.

`trigger` must return one focusable button root that accepts the props and ref supplied by Dify UI `PopoverTrigger`. Compound or non-forwarding wrapper components are not valid trigger roots. Use `triggerAriaLabel` for icon-only triggers and `triggerTooltip` only when the visible control needs supplemental hover and focus help.

Positioning uses the Dify UI popover API directly. Prefer `placement` alone. `sideOffset` and `alignOffset` are escape hatches for a call site with a verified geometric constraint; the selector does not translate custom offset shapes.

Standalone selectors must declare `standalonePanel`. Availability props such as `noBlocks` only determine which tabs exist and must not change the layout mode implicitly.

## Internal Modules

- `index`: Public `BlockSelector` entry, popover lifecycle, trigger contract, focus management, and workflow-state adaptation.
- `tabs`: Tab order, one-session filter state, and panel routing.
- `tool-panel` and `tool-browser`: Installed-tool query adaptation and the complete tool browsing surface.
- `blocks`, `data-sources`, and `all-start-blocks`: Domain panels for workflow nodes, data sources, and entry nodes.
- `snippets`: Snippet filtering, insertion, list rows, and preview content.
- `tool`, `trigger-plugin`, and `marketplace-plugin`: Row and list modules for installed and Marketplace integrations.
- `featured-tools`, `featured-triggers`, and `rag-tool-recommendations`: Recommendation sections owned by this selector.
- `hooks`, `storage`, `tool-list-data`, and `types`: Selector-specific state and data contracts; these are not public compatibility entrypoints.

## External Modules

- `app/components/plugins/marketplace`: Marketplace queries, search controls, categories, and URL construction.
- `app/components/tools`: Installed tool contracts, permissions, and custom-tool creation.
- `app/components/workflow`: Workflow node contracts, stores, node metadata, and insertion callbacks.
- `features/system-features`: Marketplace feature availability.
- `service/use-plugins`, `service/use-tools`, and `service/use-triggers`: Remote recommendation and installed-provider queries.

## Ownership

`BlockSelectorPanels` owns one mounted popup session. Each tab keeps independent search and tag state for that session. Closing the popup unmounts the session and resets those values.

Each panel owns state that only affects its content:

- `ToolPanel` adapts installed-tool queries into `ToolBrowser`; `ToolBrowser` owns tool category, view, marketplace search, and tool-list presentation.
- `DataSources` owns local source filtering and datasource marketplace search.
- `AllStartBlocks` owns trigger providers and trigger-specific expansion state.
- `Snippets` owns snippet tags, pagination, insertion, and its preview-card handle.

Remote marketplace search is debounced at the section that issues the request. Local filtering uses the current input value. Data fetching and store synchronization do not belong in row components.

## Interaction contract

Tabs follow this order: Blocks, Tools, Sources, Start, Snippets. The tab list precedes the active panel in DOM order. Opening the selector focuses the active panel search field; `Shift+Tab` returns to the active tab. Arrow keys move focus between tabs and `Enter` or `Space` activates the focused tab.

Rows use one of three DOM structures:

- A single action is one native button.
- An independently expandable group uses `Collapsible` with a native trigger and an associated panel.
- A compound row uses a non-interactive container with separate primary and secondary buttons or links. Interactive elements must never be nested.

List controls use the shared two-pixel accent focus indicator. Use an inset ring inside clipped or scrollable surfaces so the ring follows the row boundary.

Each preview-enabled list owns one `PreviewCard` root and one detached handle. Rows provide focusable `PreviewCardTrigger` payloads with `delay={150}` and `closeDelay={150}`, and preview content uses `BlockSelectorPreviewCardContent`.

Block Selector deliberately composes those triggers with native row buttons rather than links. This is a feature-owned visual enhancement, not an extension of the shared Dify UI primitive contract. The row retains the complete selection or insertion action. Preview availability must not depend on an optional description; a card may show nonessential read-only context such as the item name, icon, author, or block types, but that context must not affect whether users can identify or activate the row. Preview content contains no independent interactions and never adds a second action. If any preview-only context becomes necessary for choosing an item, surface it in the row or replace this feature-level composition with an accessible disclosure.

## Testing

Tests protect observable behavior through public interfaces:

- roles, accessible names, states, and relationships;
- keyboard activation and logical Tab order;
- initial focus, Escape dismissal, and focus return;
- independent per-tab session state and reset after close;
- disabled behavior and selection side effects.

Do not assert utility classes, child indexes, component implementation details, or third-party primitive internals. Use `userEvent` and semantic queries. Verify geometry, clipped focus indicators, hover/focus reveal, and real browser focus order in Browser Mode or E2E rather than happy-dom.
