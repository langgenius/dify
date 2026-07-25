# Detail Sidebar

Owns the shared console detail sidebar shell, interaction state, and SSR-aware Cookie preference.

## Internal Modules

- `index`: Shared sidebar frame and expand, collapse, hover-preview, and shortcut interactions.
- `preference`: Cookie name, runtime validation, and the default sidebar mode.
- `server`: Request Cookie adapter that resolves the initial sidebar mode.
- `state`: Feature-level Jotai state, initialization command, and client-side Cookie persistence.
- `state-initializer`: Initializes the feature atom from the request snapshot during render.
- `hotkeys`: Shared keyboard shortcut contract.
- `toggle-button`: Sidebar toggle presentation.

## State Ownership

- The Common Layout request snapshot initializes the feature atom at its surface boundary.
- The feature atom is the client runtime source of truth.
- Public atom writes update Jotai synchronously and then attempt to persist the same mode to the Cookie.
- Store initialization never writes the Cookie, and Cookie changes outside this feature are not synchronized back at runtime.

## External Modules

- `app/components/header/env-nav`: Environment metadata shown in the expanded sidebar.
- `app/components/main-nav/components/account-section`: Shared account control.
- `app/components/main-nav/components/help-menu`: Shared help control.
- `context/version-state`: Current environment state.
