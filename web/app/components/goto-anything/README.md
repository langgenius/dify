# Goto Anything

Global command palette that coordinates detached dialog triggers, typed search, commands, and navigation.

## State Ownership

- The detached Dialog handle owns desktop open state and trigger focus restoration. Below the `md` breakpoint the palette opens in a bottom Drawer through its own detached handle; the palette controls that Drawer so the global shortcut and a widening viewport can open or close it.
- Each surface renders its own search session inside the popup. The session owns the typed term, the selected search scope, and the open command page, so closing a surface unmounts and resets them. The plugin installer lives outside because it outlives the session.
- The search pipeline reads one query string. Scope and page are encoded as its prefix (`@app term`, `/theme term`); the prefix never appears in the UI.
- TanStack Query owns remote search lifecycle and cache state for each generated query contract.
- Autocomplete owns option registration, highlighting, keyboard navigation, and item activation.
- ScrollArea Viewport is the only results scroll container; Autocomplete List is the results listbox.

Search actions adapt application, knowledge, plugin, workflow, and RAG owners into palette results. They must not duplicate those features' authorization, navigation, or query contracts.

## Discovery and interaction

- Typing with nothing selected searches every resource and command; prefixes are never required.
- The empty input lists every available command as a single-line row named in plain language. Commands with choices open a page; other commands run directly.
- A search can be narrowed to one resource type (a scope). With an empty term, a scope lists that resource's first page.
- In the desktop dialog, the scope or page is a token at the start of the input. The empty input lists scopes after the commands, a term that names a scope suggests it, and a bare `@` lists them; the placeholder teaches `@`. Typed `@scope ` and `/command ` prefixes become tokens.
- In the bottom drawer, a scope bar under the input owns scope selection; only a page shows as a token.
- Results stay grouped by type. Resource rows show a one-line description; command and scope rows show a title only and are shorter. When some providers fail, a visible notice sits above the remaining results.
- The open surface, not the viewport width, decides between tokens and the scope bar: a sidebar trigger can open the dialog on a narrow screen. A scope that becomes unavailable falls back to all; opening a command page leaves the scope behind.

## Keyboard

- The desktop dialog follows the APG modal dialog and combobox patterns: focus starts in the input and stays there, Up and Down move the active option, Enter activates it, and one Escape closes it and returns focus to the trigger. Base UI owns the focus trap.
- Backspace in an empty input removes the token: it leaves a page or, in the dialog, clears the scope. A held key only deletes text; a fresh press removes the token. The token's remove button does the same for pointers, and the screen-reader hint mentions token removal only while a token is shown.
- The drawer's Escape clears the term before closing, like Base UI's mobile docs search.
- The drawer's scope bar is an APG radio group: Tab enters on the checked scope, arrow keys move and select, and the focus ring is drawn inset so the scroller cannot clip it.
- Escape and Backspace do nothing during IME composition.

## Runtime

- A fixed command catalog is available on the first render. Its lookup registry only indexes definitions; it has no registration effects, subscriptions, or separate execution bus.
- React owns the current language, workspace availability, and Studio app context. Search and execution receive this context explicitly; command definitions never retain user or request state. Execution rechecks availability.
- Browser effects (navigation, external windows, theme/language changes, generator opening) run only when a result is activated. The palette remains lazily loaded on the client; importing/searching the catalog is safe during server rendering.
