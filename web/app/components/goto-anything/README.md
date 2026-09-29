# Goto Anything

Global command palette that coordinates detached dialog triggers, typed search, commands, and navigation.

## State Ownership

- The detached Dialog handle owns open state and trigger focus restoration.
- The dialog component owns the transient search input and selected plugin installer state.
- TanStack Query owns remote search lifecycle and cache state for each generated query contract.
- Autocomplete owns option registration, highlighting, keyboard navigation, and item activation.
- ScrollArea Viewport is the only results scroll container; Autocomplete List is a listbox for
  search results and a named grid for command cards.

Search actions adapt application, knowledge, plugin, workflow, and RAG owners into palette results. They must not duplicate those features' authorization, navigation, or query contracts.

## Discovery and interaction

- The empty input shows available featured commands followed by search scopes in a two-column grid.
- `/` browses all available commands; `@` browses search scopes. The empty view also offers footer buttons that fill either prefix and return focus to the input. Once typing begins, the footer shows the result count and an Enter hint when an item is available.
- Ordinary text searches localized command names, existing aliases, submenu choices, and resources. Commands stay usable while remote searches load or fail.
- Grid navigation follows the displayed rows; ordinary results use a listbox. Pointer and keyboard use the same highlighted state, while DOM focus stays in the input.
- Selecting a submenu or scope keeps the palette open and the input editable. Clearing the input returns to the home view. Escape dismisses the dialog.
- A fixed command catalog is available on the first render. Its lookup registry only indexes definitions; it has no registration effects, subscriptions, or separate execution bus.
- React owns the current language, workspace availability, and Studio app context. Search and execution receive this context explicitly; command definitions never retain user or request state. Execution rechecks availability.
- Browser effects (navigation, external windows, theme/language changes, generator opening) run only when a result is activated. The palette remains lazily loaded on the client; importing/searching the catalog is safe during server rendering.
