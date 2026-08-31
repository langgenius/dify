# Buffered document upload admission

## Scope

- Applies to both legacy-auth and Capability v2 single and bulk multipart document routes.
- Runs after authorization and document mutation/deletion admission, but before Hono's OpenAPI
  form validator can call `Request.arrayBuffer()`.
- Does not change the upload-session single/multipart/small-fallback paths.

## Safety behavior

- Reads request streams with a hard multipart envelope before seeding Hono's body cache. Declared
  oversized requests fail before a body read; missing or dishonest `Content-Length` values remain
  bounded by the same streaming limit.
- A process-wide FIFO gate defaults to two active requests and a 192 MiB retained-buffer budget.
  Each request is conservatively charged at three times its request envelope for bounded chunks,
  Hono ArrayBuffer/FormData retention, and the handler's `File.arrayBuffer()` copy. This is a
  conservative admission estimate rather than a claim that Node RSS is exactly bounded to it.
- The 15 MiB single route permits two normal uploads concurrently. A maximum 50 MiB bulk request
  runs alone under the default byte budget.
- Body reads reset a 30 second idle deadline after every chunk and have a separate 10 minute total
  deadline. Timeout cancels the reader, responds with HTTP 408, and releases both gate budgets;
  an active client disconnect is observed immediately instead of retaining the slot until timeout.

## Verification

- Real OpenAPI multipart tests prove a second request remains unread while queued ahead of the
  validator, declared and chunked oversize bodies never reach the handler, mutation/deletion
  rejection happens before body admission, an active abort releases its slot, and two stalled
  readers release slots for a third.
- Focused API tests passed 57/57 and API-app option tests passed 3/3; both package typechecks also
  passed. These cover the gate, middleware, route integration, environment parsing, and the
  existing upload-session fallback admission.
- The final integrated suites passed 4,778 API tests (3 skipped) and 286 API-app tests. Compose,
  image-smoke, migration, OpenAPI, secret-scan, Biome, and contract-lock checks also passed.
