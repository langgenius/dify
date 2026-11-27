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

- The query client reports failed requests once, at the cache; see [query error toasts]. The request layer shows no error toasts.
  - The message comes from [`describeRequestError`]: a translated `requestErrors` entry for the error's `code`, the server's message for a code whose text is upstream detail, then the server's message for a code the catalog does not know, then generic text for the kind of failure (network, timeout, rate limit, server error).
  - A failed mutation shows that message. Set `meta: { errorMessage }` to give it the mutation's own text for codes the catalog does not know; a cataloged code keeps its translated text. Do not add a second toast for the same failure in `catch` or `onError`.
  - A failed query shows that message, on its first load and on a background refetch alike, but only when the code or the server explains the failure; a polling query shows a given message once per 10 seconds. Prefer an error state (with a retry) where the data would be: render it from [`useOwnedQueryError`]`(query)` (or `useOwnedQueryErrors([...])` for several reads), which returns `{ error, retry, retrying }` while a first load has failed and claims that error, so the cache, which waits for the render after a failure, does not also toast it. A failed refetch, which keeps showing cached data, still toasts. Call it only where the error is rendered; a hook shared by callers that do not render it exposes its query instead. Set `meta: { errorToast: false }` when the owner also presents refetch failures itself. [`query-error-claims.spec.ts`] requires every rendered query error to come through `useOwnedQueryError`.
  - Sign-in failures (401), app-access errors and other failures the request layer already presents are never reported again.
- When a business flow owns the error feedback, set `meta: { errorToast: false }` on its mutation or query and present the failure once at that business boundary. Prefer inline errors; use a business-specific toast only when the feedback cannot live where the user acted. For multi-request actions, let the business flow choose one message for the overall result. An opted-out request with no other error presentation fails without any feedback.
- A request called outside TanStack Query, such as a direct `consoleClient` call, has no automatic toast. Run a user action through a mutation, or present its failure where it is caught; `reportRequestError(error, fallback)` reports it like the mutation cache, and also reports a network failure, timeout or other exception with generic text. Event streams and uploads report through their own error callbacks.
- Failures that are not failed requests, such as a rejected clipboard write or a client-side exception, still need their own feedback.
- When choosing the business error, preserve the actionable reason. Use [`useRequestErrorMessage`]`(error, fallback)`, `useRequestErrorDescriber()` or `describeRequestError(error, { t, fallback })`: a known code gets its translated text, upstream detail stays, and the caller's translated `fallback` replaces the server's text only for codes the catalog does not know. Add a `requestErrors` entry when the backend documents a new code. Opting a request out of the toast must not hide details such as name conflicts, quota limits, unsupported file types, or permission requirements.
- Client-side validation belongs at the field through the [form contract], never in a toast.

## Existing Code

Many existing calls predate these rules and are migrated in batches. Do not copy them into new code, and do not remove an error toast without confirming the query cache covers that failure.

[CopyFeedback]: ../app/components/base/copy-feedback/index.tsx
[`describeRequestError`]: ../service/request-error-message.ts
[`query-error-claims.spec.ts`]: ../app/__tests__/query-error-claims.spec.ts
[`useOwnedQueryError`]: ../service/use-owned-query-error.ts
[`useRequestErrorMessage`]: ../service/use-request-error-message.ts
[form contract]: ../../packages/dify-ui/docs/forms.md
[query error toasts]: ../app/query-error-toast.ts
