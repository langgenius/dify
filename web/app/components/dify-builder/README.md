# Dify Builder

Shared session/stream logic for the App Builder Build, Edit, and Fix APIs. It is
consumed by both the standalone debug page and the in-editor App Builder panel.

## Internal Modules

- `state.ts`: primitive session atoms. Feature consumers scope these atoms per
  app with `ScopeProvider`.
- `use-dify-builder-session.ts`: the controller writes session atoms without
  subscribing to them. `useDifyBuilderSession` is the read-and-write wrapper
  used by the debug page.

Keep UI-only state, such as composer drafts and expanded cards, in the owning
component. Add derived atoms for shared fields instead of passing the complete
`SessionView` through React Context.

## External Modules

- `config`: `CSRF_COOKIE_NAME`, `CSRF_HEADER_NAME` for authenticated console requests.
