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

- When a request fails and the server returns an error message, the request layer shows that message unless the request is `silent`; see `afterResponseErrorCode` in [request layer]. Do not add a second toast for the same failure in `catch` or `onError`.
- To present a request error differently, make the request `silent` (`{ context: { silent: true } }` for generated clients) and show the error inline. A `silent` request with no other error presentation fails without any feedback.
- Failures that never reach the request layer, such as a rejected clipboard write or a client-side exception, still need their own feedback.
- Client-side validation belongs at the field through the [form contract], never in a toast.

## Existing Code

Many existing calls predate these rules and are migrated in batches. Do not copy them into new code, and do not remove an error toast without confirming the request layer covers that failure.

[CopyFeedback]: ../app/components/base/copy-feedback/index.tsx
[form contract]: ../../packages/dify-ui/docs/forms.md
[request layer]: ../service/fetch.ts
