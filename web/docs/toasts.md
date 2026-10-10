# Toasts

A toast reports a result the user cannot see where they acted. It is the last choice for feedback, not the default completion signal of a mutation.

## Choose the Feedback Owner

Before adding a toast, check in order:

1. If the result is already visible where the user acted, add nothing.
1. If the feedback can live at the trigger, such as a button state, an inline message, or a field error, put it there.
1. Otherwise a toast is appropriate.

## Success

Do not show a success toast when:

- A switch, select, segmented control, checkbox, toggle, or rating control shows the new value itself. After a failed request the control must show the server value again.
- A button copies content. Show the copied state on the button. For an icon button use [CopyFeedback], which changes the icon, the tooltip, and the accessible name.
- A dialog submits and closes, and the created, changed, or removed item is visible on the surface behind it.

A success toast is appropriate when the result is not on screen: a background job started, an import, export, or download finished, or the action left the page that showed its subject, such as deleting an item from its detail page. The message must name what happened. Do not use generic messages such as “Action succeeded” or “Modified successfully”.

## Errors

- When a request fails and the server returns an error message, the request layer shows that message unless the request is `silent`; see `afterResponseErrorCode` in [request layer]. Do not add a second toast for the same failure in `catch` or `onError`.
- To present a request error differently, make the request `silent` (`{ context: { silent: true } }` for generated clients) and show the error inline. A `silent` request with no other error presentation fails without any feedback.
- Failures that never reach the request layer, such as a rejected clipboard write or a client-side exception, still need their own feedback.
- Client-side validation belongs at the field through the [form contract], never in a toast.

## Existing Code

Many existing calls predate these rules and are migrated in batches: success toasts after a dialog closes, error toasts that duplicate the request layer, and validation toasts. Do not copy them into new code, and do not remove an error toast without confirming the request layer covers that failure.

[CopyFeedback]: ../app/components/base/copy-feedback/index.tsx
[form contract]: ../../packages/dify-ui/docs/forms.md
[request layer]: ../service/fetch.ts
