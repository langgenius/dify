# Toasts

A toast reports a result the user cannot see where they acted. It is the last choice for feedback, not the default completion signal of a mutation.

## Choose the Feedback Owner

Before adding a toast, check in order:

1. If the result is already visible where the user acted, add nothing.
1. If the feedback can live at the trigger, such as a button state, an inline message, or a field error, put it there.
1. Otherwise a toast is appropriate.

Show at most one toast for one user action. When an action succeeds with a warning, show the warning and not a separate success message.

## Choose the Type

The type says whether the thing the user asked for happened.

| Type      | Meaning                                                                              | Example                                                   |
| --------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `success` | It happened as asked, and the result is not on screen.                               | An export finished; reindexing started.                   |
| `warning` | It happened, but incompletely or with a side effect the user should know about.      | An import completed with warnings.                        |
| `error`   | It did not happen.                                                                   | A request failed.                                         |
| `info`    | Something the user did not trigger happened, and it needs no response from the user. | A collaborator restored a version of the shared workflow. |

A toast is not the place to explain why an action is unavailable. When a precondition is not met, such as missing permission, a response still in progress, or a feature that is not available, prevent the action at the control instead: disable it, keep it focusable, and give the reason in a tooltip or inline text next to it.

## Success

Do not show a success toast when:

- A switch, select, segmented control, checkbox, toggle, or rating control shows the new value itself. After a failed request the control must show the server value again.
- A button copies content. Show the copied state on the button. For an icon button use [CopyFeedback], which changes the icon, the tooltip, and the accessible name.
- The created, changed, or removed item is visible on the current surface, whether the action ran inline, from a menu, or through a dialog that closed.
- The action navigates to the item it just created, or the page reloads right after.

A success toast is appropriate when the result is not on screen: a background job started, an import, export, or download finished, a save left the page looking the same, or the action left the page that showed its subject, such as deleting an item from its detail page. The message must name what happened. Do not use generic messages such as “Action succeeded” or “Modified successfully” in new code.

## Errors

The request layer propagates errors. It does not present them. Authentication recovery, cancellation, structured error decoding, and retries are independent of notification policy.

| Owner                              | Error feedback                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `defaultOptions.mutations.onError` | Default business error toast, excluding cancellation.                                 |
| `useMutation({ onError })`         | Replaces the default; owns complete feedback, including when it also rolls back data. |
| `mutate(input, { onError })`       | Runs in addition to the hook or default callback; does not suppress either.           |
| `mutateAsync` catch                | Handles the rejected promise; does not suppress mutation feedback.                    |
| Direct requests and streams        | The business interaction owns feedback and pending-state cleanup.                     |

Do not put an overridable default toast in `MutationCache.onError`, or suppress feedback with an empty `onError`. Generated mutation options must retain shared invalidation, cache updates, and rollback callbacks. Required data maintenance belongs in hook callbacks or awaited operations, because invocation callbacks may not run after unmount.

For a composed operation, assign one error owner across its requests. Keep form input and unsaved drafts on failure. Autosave reports failure at the save status; existing version-conflict refresh behavior still applies. Stream owners handle HTTP failures, stream errors, and network interruption through `onError`, finish their pending state, and avoid duplicate feedback from completion callbacks. Active cancellation must not produce a failure toast. Success feedback stays with the business interaction.

Query error presentation is deferred to a later PR. Removing request-layer notifications removes default toasts for initial Query failures and background refetch failures. Preserve existing Query error UI, retry settings, and caching. Do not introduce QueryCache notifications or notification-related query metadata as part of this migration.

Client-side validation belongs at the field through the [form contract], never in a toast. Clipboard and other client-side failures still need their own business feedback.

## Transport Boundary

`service/fetch.ts`, `service/base.ts`, and Console transport adapters must not depend on notification modules, either directly or through re-exports, helpers, or dynamic imports. Check the transitive local import graph when changing their dependencies. Business error helpers such as `app/notifications/notify-error.ts` belong at consumers; moving automatic toasts into a generic request wrapper violates the same boundary.

Do not add notification flags, compatibility aliases, URL-based toast suppression, or notification deduplication to the transport. OAuth silent authorization and unrelated logging or validation controls retain their own semantics.

## Existing Code

Before removing a consumer's error feedback, identify the hook callback, visible error state, or enclosing business operation that takes responsibility. A rejected promise or rollback alone does not present an error.

[CopyFeedback]: ../app/components/base/copy-feedback/index.tsx
[form contract]: ../../packages/dify-ui/docs/forms.md
