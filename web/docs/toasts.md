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

- HTTP transports normalize and propagate failures. They never show toasts. Authentication recovery (token refresh and sign-in redirects) remains in the authentication layer.
- The business interaction owns feedback for the overall action, including actions that make several requests. Prefer field, form, control, or page errors. Use one business-specific toast only when the feedback cannot live where the user acted.
- Handle network failures and timeouts as well as HTTP failures. Ignore intentional cancellation. Do not depend on transport notifications or add global Query error toasts.
- Preserve the actionable reason: prefer a localized message for a known domain error, then the server's error message, then a localized generic fallback. Do not hide name conflicts, quota limits, unsupported file types, or permission requirements.
- Initial query failures belong in the owning page or section with a retry action. Background refresh, polling, and prefetch failures must not produce automatic toasts.
- Stream consumers own error presentation through their callbacks. The transport does not provide a default notification.
- Client-side validation belongs at the field through the [form contract], never in a toast.

## Existing Code

Many existing calls predate these rules and are migrated in batches. Do not copy them into new code, and keep feedback at the business boundary and confirm each failed action has a visible error.

[CopyFeedback]: ../app/components/base/copy-feedback/index.tsx
[form contract]: ../../packages/dify-ui/docs/forms.md
