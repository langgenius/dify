# Workflow Preview And Provider Boundaries

Use this pack when reviewing workflow nodes, workflow previews, or components shared with RAG template rendering. Trace the current rendering surface rather than inferring provider availability from a file's directory.

## Trace The Preview Dependency Chain

- [RAG template details] renders [WorkflowPreview], which mounts a React Flow provider and uses its own [preview node map]. It does not mount `WorkflowContextProvider`.
- Preview nodes still consume shared editor descendants, such as condition values and information panels. Trace those imports before adding a workflow-store dependency; a change outside the preview directory can still reach this surface.
- The [RAG editor] does mount `WorkflowContextProvider`. Do not prohibit workflow hooks in editor-only nodes merely because they live under `workflow/nodes/`.

Report the reachable consumer missing the provider. The [workflow store hooks] differ: `useStore` throws without a provider; `useWorkflowStore` has a TypeScript non-null assertion that does not prevent a runtime null value.

## Choose The Reactive Data Source

For rendered node or edge state, use the React Flow source and a reactive hook or selector, such as `useNodes` or `useEdges`, scoped to what the UI needs. An imperative `getState()` read does not subscribe the render to updates. Callback-only reads and mutations can use React Flow `useStoreApi`; workflow-store APIs require their own provider in every reachable surface.

[RAG editor]: ../../../../web/app/components/rag-pipeline/index.tsx
[RAG template details]: ../../../../web/app/components/datasets/create-from-pipeline/list/template-card/details/index.tsx
[WorkflowPreview]: ../../../../web/app/components/workflow/workflow-preview/index.tsx
[preview node map]: ../../../../web/app/components/workflow/workflow-preview/components/nodes/constants.ts
[workflow store hooks]: ../../../../web/app/components/workflow/store/workflow/index.ts
