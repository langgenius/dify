# Workflow Draft

Persistence and recovery for the application editor's workflow draft.

| Development task                                             | Owner                             |
| ------------------------------------------------------------ | --------------------------------- |
| Save a draft or prepare the save barrier for Builder         | [`use-draft-save.ts`]             |
| Reload a draft, preserve the viewport, or resolve a conflict | [`use-draft-refresh.ts`]          |
| Hydrate the graph and restore a local start placeholder      | [`use-draft-graph-for-canvas.ts`] |
| Display the draft conflict and reload interaction            | [`conflict-dialog.tsx`]           |

`useWorkflowDraftSave` owns persistence requests. The generic canvas calls
`workflow/hooks/use-schedule-draft-save.ts`, whose `useScheduleDraftSave` notifies
the owner through `onDraftChange` and schedules the injected persistence callback.

The App operation queue, generation, revision counters, conflict state, and Builder
edit locks live in `workflow-app/store/workflow/draft-slice.ts`. App coordination
exposes the generic `canvasReadOnly`, `nodeEditingLocked`, and `autoFollowExecution`
canvas settings.
Knowledge pipelines keep their own persistence hooks and do not initialize this
App state. Collaborative transport and server graph updates stay in
`workflow/collaboration/core/`. Builder uses the same App persistence boundary as
ordinary editor actions.

From `web/`, run:

```sh
vp test run --project unit app/components/workflow-app/draft
vp test run --project browser app/components/workflow-app/draft
```

[`conflict-dialog.tsx`]: conflict-dialog.tsx
[`use-draft-graph-for-canvas.ts`]: use-draft-graph-for-canvas.ts
[`use-draft-refresh.ts`]: use-draft-refresh.ts
[`use-draft-save.ts`]: use-draft-save.ts
