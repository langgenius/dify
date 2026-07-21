# Goto Anything

Global command palette that coordinates detached dialog triggers, typed search, commands, and navigation.

## Internal Modules

- `actions`: Search actions, command registration, result conversion, and recent-item persistence.
- `components`: Goto Anything empty and footer presentation.
- `dialog-handle`: The detached Base UI Dialog handle shared by triggers and the lazy dialog root.

## State Ownership

- The detached Dialog handle owns open state and trigger focus restoration.
- The dialog component owns the transient search input and selected plugin installer state.
- TanStack Query owns remote search lifecycle and cache state for each generated query contract.
- Autocomplete owns option registration, highlighting, keyboard navigation, and item activation.
- ScrollArea Viewport is the only results scroll container; Autocomplete List remains the listbox.

## External Modules

- `app/components/app`: Application result icons and current application state used by workflow commands.
- `app/components/base`: Shared application, dataset, and form types and icons.
- `app/components/plugins`: Plugin installation permissions and installer UI.
- `app/components/rag-pipeline/goto-anything-search`: RAG pipeline node search owned by the RAG feature.
- `app/components/workflow/goto-anything-search`: Workflow node search owned by the workflow feature.
- `app/components/workflow/utils/node-navigation`: Workflow node navigation.
- `app/components/workflow/workflow-generator`: Workflow generator commands and state.
- `app/components/workflow/types`: Workflow node contracts.
- `config`: Feature preview configuration.
- `context/i18n`: Locale and documentation URL configuration.
- `i18n-config`: Client locale updates and supported languages.
- `types/app`: Application mode and icon contracts.
- `utils/app-redirection`: Application result navigation paths.
