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

The request layer only rejects; it never shows a toast. Failure feedback is decided where the request is made:

- **Mutations**: the global mutation handler in [query client] shows the server message once. Declaring `onError` on `useMutation` (or on generated `mutationOptions`) takes over that feedback, whether you show a toast, render the error inline, or rely on feedback the mutation function already gives. Put that `onError` on the hook, not on the `mutate(variables, { onError })` call, and do not toast again in a `catch` around `mutateAsync`: the global handler cannot see either, so the failure would toast twice. Keep call-level `onError` and `catch` for state cleanup. Use `meta: { errorMessage }` to name the failed action: it becomes the toast title and the server message its description, and it also covers failures that never got a response. Service mutation hooks take `meta` so each caller can name its action.
- **Queries**: a failed first load shows nothing globally; render the error state in the component, or set `meta: { errorMessage }` to toast it. A failed background refetch keeps the stale data and toasts once. When an error status is an expected answer, such as a 404 meaning "not created yet", return it as data from `queryFn` instead of throwing.
- **Imperative requests** outside React Query: call `toastRequestError(error)` from [request error] in `catch`, or wrap the request in `withRequestErrorToast(...)` when the rejection must keep propagating.
- **Streams** (`ssePost`, `sseGet`): every failure, including cancellation, reaches `onError`. Call `toastStreamError(message)` there; it ignores cancellations and accepts a page-specific notifier.
- These helpers skip 401 responses, aborted requests, and workflow requests that race an app deletion, and identical failures share one visible toast.
- Failures that never reach the request layer, such as a rejected clipboard write or a client-side exception, still need their own feedback.
- Client-side validation belongs at the field through the [form contract], never in a toast.

## Existing Code

Many existing calls predate these rules and are migrated in batches. Do not copy them into new code.

[CopyFeedback]: ../app/components/base/copy-feedback/index.tsx
[form contract]: ../../packages/dify-ui/docs/forms.md
[query client]: ../app/get-query-client.ts
[request error]: ../app/notifications/request-error.ts
