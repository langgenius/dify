# Request lifecycle and session recovery

## Scope

The browser Console client currently sends the `Request` produced by oRPC's
`OpenAPILink` through `base.request` and the Ky adapter. This change makes that
existing path reliable before replacing the transport. It does not change query
keys, generated contracts, cache invalidation, `Response` errors, `silent`, or
notification ownership.

## Ownership

- oRPC owns URL/input encoding and output decoding, including multipart and file
  responses. The HTTP adapter must preserve the encoded request and headers.
- `base.request` owns the existing authentication decisions and one replay after a
  successful refresh. Login, setup, public WebApp authorization, and redirect
  behavior remain at this boundary.
- `refresh-token.ts` owns refreshing the cookie-based Console session. It must not
  call the authenticated request layer or cause recursive refreshes.
- Query and feature owners continue to own query retries, resource invalidation,
  and application state. Session recovery is not a retry policy for writes.

## Session recovery

Concurrent callers in one document share one refresh promise and its result.
Only a successful HTTP response completes a refresh successfully. The refresh
operation has a bounded lifetime, aborts its network request on timeout, clears
its timer, and publishes an expiring result on completion.

Where available, Web Locks serialize refreshes across same-origin documents.
An attempt/result record allows callers waiting for the same refresh to observe
its outcome without starting another refresh. Records contain no credentials.
Storage coordination remains available for HTTP deployments without Web Locks;
it uses expiring, owner-identified attempts and is best effort because localStorage
has no atomic compare-and-set. It must not let a waiter or an old timer release
another attempt. Expired attempts cannot block future recovery indefinitely.

Individual cancellation stops waiting for a shared refresh, not the refresh
needed by other requests. A canceled caller must neither replay its original
request nor redirect to sign-in because of that cancellation. The shared refresh
has its own deadline.

## Request execution

Each HTTP attempt receives its own copy of an oRPC Request. Preserve the original
encoded body before the first send so a 401 can be retried once without consuming
the same body twice. Preserve multipart boundaries, filenames, bytes, keepalive,
cookies, and fresh CSRF headers. A second 401 rejects; it does not refresh again.

The caller's cancellation signal remains effective during the initial request,
while waiting for refresh, and during replay. Legacy `getAbortController` also
controls the actual request and remains usable across recovery.

Ordinary HTTP errors retain their existing representation and notification
behavior. Public WebApp authorization and the SSE event parsers are outside this
change; their use of the shared refresh function must remain compatible.

## Verification

Exercise production owners with the network boundary mocked:

- generated Console JSON and multipart requests survive one 401 and refresh;
- concurrent refresh callers share success and failure, including HTTP 500;
- refresh timeout aborts the network and does not affect a later attempt;
- canceled callers do not replay or redirect, while another caller can recover;
- ordinary error bodies, silent requests, cookies/CSRF, keepalive, file responses,
  and authentication routing retain their existing behavior;
- browser validation covers actual Request consumption, cancellation, and
  same-origin document coordination rather than only mocked lock behavior.

Run the affected service suites and repository static checks. Coordinate a later
transport/error/Cache-notification migration with the module Query migrations;
this change does not enable global Cache notifications.

## References

- [oRPC v1 OpenAPILink]
- [Fetch request bodies]
- [AbortSignal]
- [Web Locks]
- [Web Storage coordination limits]

[AbortSignal]: https://dom.spec.whatwg.org#interface-abortsignal
[Fetch request bodies]: https://fetch.spec.whatwg.org#requests
[Web Locks]: https://www.w3.org/TR/web-locks
[Web Storage coordination limits]: https://html.spec.whatwg.org/multipage/webstorage.html
[oRPC v1 OpenAPILink]: https://v1.orpc.dev/docs/openapi/client/openapi-link
