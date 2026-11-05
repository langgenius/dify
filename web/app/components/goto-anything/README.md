# Goto Anything

Global command palette that coordinates detached dialog triggers, typed search, commands, and navigation.

## State Ownership

- The detached Dialog handle owns desktop open state and trigger focus restoration. Below the `md` breakpoint the same content opens in a bottom Drawer through its own detached handle; the palette controls that Drawer so the global shortcut and a widening viewport can open or close it.
- The palette owns the session state: the typed term, the selected search scope, and the open command page. Closing either surface resets all three.
- The search pipeline reads one query string. Scope and page are encoded as its prefix (`@app term`, `/theme term`); the prefix never appears in the UI.
- TanStack Query owns remote search lifecycle and cache state for each generated query contract.
- Autocomplete owns option registration, highlighting, keyboard navigation, and item activation.
- ScrollArea Viewport is the only results scroll container; Autocomplete List is the results listbox.

Search actions adapt application, knowledge, plugin, workflow, and RAG owners into palette results. They must not duplicate those features' authorization, navigation, or query contracts.

## Discovery and interaction

- The empty input lists every available command as a row, named in plain language. Commands with choices open a page; other commands run directly.
- A segmented scope control under the input narrows results to one resource type. Selecting a scope with an empty term lists that resource's first page.
- Typed `@scope ` and `/command ` prefixes are shortcuts into the same scope and page state. A bare `@` lists scopes as rows.
- Ordinary text searches localized command names, aliases, page choices, and resources. Commands stay usable while remote searches load or fail.
- The desktop footer shows the result count and an Enter hint while a query is active. The bottom Drawer has no footer.

## Keyboard

- DOM focus stays in the input; Up and Down move the highlighted result and Enter activates it.
- Tab moves between the back button (on a page), the input, and the scope control, which is one tab stop. Inside the scope control, arrow keys move and select.
- A pointer press on a scope keeps focus in the input when the input already has it, matching Base UI's input-attached controls.
- Escape steps back one layer: it leaves a command page, then clears the term, then closes the surface. Backspace in an empty input leaves a command page. Neither acts during IME composition.

## Runtime

- A fixed command catalog is available on the first render. Its lookup registry only indexes definitions; it has no registration effects, subscriptions, or separate execution bus.
- React owns the current language, workspace availability, and Studio app context. Search and execution receive this context explicitly; command definitions never retain user or request state. Execution rechecks availability.
- Browser effects (navigation, external windows, theme/language changes, generator opening) run only when a result is activated. The palette remains lazily loaded on the client; importing/searching the catalog is safe during server rendering.
