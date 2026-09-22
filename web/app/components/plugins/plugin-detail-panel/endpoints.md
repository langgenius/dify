# Plugin endpoints

The endpoint list, card, and modal own the plugin endpoint management surface.
They consume generated `consoleQuery.workspaces.current.endpoints` options
directly. There is no endpoint service hook, handwritten cache key, or frontend
copy of an API response type.

## API and types

- [Endpoint controllers]
  own request/response models and tenant, user, and permission enforcement.
- [Plugin endpoint client]
  owns the daemon boundary. Successful writes return `true`; daemon failures
  raise errors. An unexpected `false` acknowledgement is an error, not a second
  successful HTTP response. Deleting an already removed endpoint remains
  idempotent.
- Generated Console contracts own list items, provider configuration, and write
  payloads. Create uses `POST /endpoints`, edit uses `PATCH /endpoints/{id}`, and
  delete uses `DELETE /endpoints/{id}`. Enable and disable use their generated
  action endpoints. Success keeps the existing `200 { success: true }` shape.
- The modal owns conversion from provider configuration to the existing form
  schema and from form values to the generated settings payload. It preserves
  `false`, `0`, and empty strings, and separates the name without mutating the
  submitted object. Optional declarations and nullable localized labels are
  handled at this display boundary.

When an API shape changes, update its Pydantic owner and regenerate TypeScript,
Zod, and OpenAPI Markdown. Do not widen generated unions, assert a different DTO,
or add a frontend compatibility type to hide a contract mismatch.

## Queries and mutations

| Decision              | Owner and behavior                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List identity         | Generated input includes plugin ID, page `1`, and page size `100`; pagination behavior is unchanged.                                                                                                                 |
| Freshness and retries | Inherit the existing QueryClient defaults, including five-minute freshness. No endpoint-specific override is needed.                                                                                                 |
| Rendering             | The list queries when its endpoint surface is mounted. The card reads `enabled` from query data; pending changes disable the switch.                                                                                 |
| Shared invalidation   | All five successful writes invalidate the endpoint list family and installed plugin list/category queries containing endpoint counts.                                                                                |
| Invalidation scope    | Update/delete/enable/disable only identify an endpoint, so their shared policy cannot safely infer its plugin. All endpoint list inputs are marked stale. Installed plugin IDs and unrelated tools remain untouched. |
| Failure               | Rejected mutations preserve query data and editable form state. They do not invalidate lists or close the form.                                                                                                      |
| Local callbacks       | The surface owns toast, confirmation, and closing behavior; shared cache work stays in `query-policies.ts` `onSettled`.                                                                                              |

The endpoint list family uses `endpoints.list.key()`: `list.get.key()` would not
match `list.plugin.get`. Query data remains scoped by the application's existing
workspace-switch boundary; this module does not introduce a separate cache.

## Verification

Backend tests protect the success-only write contract, daemon failure handling,
delete idempotence, and generated schema. Frontend tests exercise generated
transport and real QueryClient invalidation alongside local callbacks, including
failure and unchanged scalar settings. Surface tests protect form submission,
server-owned switch state, and failure recovery. Coverage percentage is not an
acceptance criterion.

[Endpoint controllers]: ../../../../../api/controllers/console/workspace/endpoint.py
[Plugin endpoint client]: ../../../../../api/core/plugin/impl/endpoint.py
