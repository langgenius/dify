# App Creation

Application creation through prompts, templates, DSL files, App packages, and
URLs. The application list, its empty state, Home, and the Agent roster consume
these entrypoints.

| Development task                                                  | Owner                                                             |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| Create an app, check permissions/quota, or navigate after success | [`entry.tsx`]                                                     |
| Change available app types or template/DSL actions                | [`type-menu.tsx`]                                                 |
| Edit the opening prompt or create a blank workflow/chatflow       | [`prompt-dialog/index.tsx`]                                       |
| Improve a prompt with the workspace model                         | [`prompt-dialog/use-improve-prompt.ts`]                           |
| Explain missing model configuration                               | [`prompt-dialog/model-guide.tsx`]                                 |
| Import a DSL file, App package, or URL                            | [`dsl-dialog/index.tsx`]                                          |
| Confirm a DSL version mismatch                                    | [`dsl-version-confirm-dialog.tsx`]                                |
| Submit template imports, confirm them, and navigate after success | [`use-import-dsl.ts`]                                             |
| Open the template picker                                          | [`template-dialog/index.tsx`]                                     |
| Search, filter, preview, or import a template                     | [`template-dialog/template-list.tsx`]                             |
| Render template categories or cards                               | [`template-dialog/categories.tsx`], [`template-dialog/app-card/`] |
| Change the shared full-screen dialog layout                       | [`dialog-shell.tsx`]                                              |

`AppCreationFlow` owns creation state and exposes controls to the entry button
and empty state. Prompt drafts belong to the mounted prompt dialog. Creating an
app with a goal writes the one-shot Builder handoff before navigating; the
workflow editor consumes it after its graph is ready.

Studio selects the Builder flow in `app/components/apps/list.tsx`. With Builder
disabled, Studio shares the standard creation menu with the Agent roster and
uses the standard blank creation form. Both flows use the template and DSL dialogs.

`dsl-dialog/` owns file/URL selection and its import request lifecycle.
`use-import-dsl.ts` is the public import command hook shared by template creation
on Home, the application list, and the template picker. The version confirmation
dialog is a public entrypoint shared by those creation flows.

Shared file selection and import warning presentation belong to
[`../dsl-import/`]. Workflow replacement, knowledge pipeline replacement, and
Snippet import consume that module directly.

From `web/`, run:

```sh
vp test run --project unit features/app-creation
vp test run --project browser features/app-creation
```

[`../dsl-import/`]: ../dsl-import/
[`dialog-shell.tsx`]: dialog-shell.tsx
[`dsl-dialog/index.tsx`]: dsl-dialog/index.tsx
[`dsl-version-confirm-dialog.tsx`]: dsl-version-confirm-dialog.tsx
[`entry.tsx`]: entry.tsx
[`prompt-dialog/index.tsx`]: prompt-dialog/index.tsx
[`prompt-dialog/model-guide.tsx`]: prompt-dialog/model-guide.tsx
[`prompt-dialog/use-improve-prompt.ts`]: prompt-dialog/use-improve-prompt.ts
[`template-dialog/app-card/`]: template-dialog/app-card/
[`template-dialog/categories.tsx`]: template-dialog/categories.tsx
[`template-dialog/index.tsx`]: template-dialog/index.tsx
[`template-dialog/template-list.tsx`]: template-dialog/template-list.tsx
[`type-menu.tsx`]: type-menu.tsx
[`use-import-dsl.ts`]: use-import-dsl.ts
