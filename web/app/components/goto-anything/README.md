# Goto Anything

Global command palette that coordinates detached dialog triggers, typed search, commands, and navigation.

## State Ownership

- The detached Dialog handle owns open state and trigger focus restoration.
- The dialog component owns the transient search input and selected plugin installer state.
- TanStack Query owns remote search lifecycle and cache state for each generated query contract.
- Autocomplete owns option registration, highlighting, keyboard navigation, and item activation.
- ScrollArea Viewport is the only results scroll container; Autocomplete List remains the listbox.

Search actions adapt application, knowledge, plugin, workflow, and RAG owners into palette results. They must not duplicate those features' authorization, navigation, or query contracts.
