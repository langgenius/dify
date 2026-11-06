# Explore catalog contract

## Ownership and scope

The recommendation catalog is owned by
`api/controllers/console/explore/recommended_app.py`, with query behavior in
`api/services/recommended_app_query_service.py` and source selection/fallback in
`api/services/recommended_app_catalog_gateway.py`. The generated Explore contract
is the frontend request and response owner. Use `RecommendedAppResponse` directly
for card props and selected templates; do not restore the removed Explore DTOs,
normalizers, fetchers, or forwarding hooks.

This module covers recommended apps, Learn Dify apps, recommendation detail, and
the installed-app lookup used by the app-card navigation action. Trial execution,
installed-app management, catalog banners, and DSL import orchestration retain
their own owners.

## Query and action decisions

| Entry point                              | Policy and reason                                                                                                                                                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home server prefetch and client list     | The generated recommended-app key includes the requested language. Both sides cache the same raw response. Pending dehydration remains owned by the shared QueryClient.                                                       |
| Template chooser                         | Uses the same generated recommended-app options and language input. Inherits the five-minute freshness default, so a fresh Home cache is reused.                                                                              |
| Learn Dify                               | Uses the generated Learn Dify operation with explicit language. The feature gate and dismissed section control mounting; hidden content does not fetch.                                                                       |
| List sorting and filtering               | The consuming observer or render owner copies rows before sorting by `position ?? 0`. Learn Dify limits rows after sorting. No consumer rewrites the canonical cache into a view model.                                       |
| Template chooser and Apps create actions | Call the generated detail client each time the user confirms. This preserves the previous always-network behavior without adding a query retry or stale-cache policy.                                                         |
| Home create action                       | Retains its existing generated detail query with `staleTime: 'static'`. This separate call-site decision is unchanged.                                                                                                        |
| Open installed app                       | The generated installed-app client runs inside `openAsyncWindow`'s URL resolver. The window opens during user activation, the published-workflow gate is retained, and the first returned installed ID determines navigation. |

The catalog has no writes and therefore adds no mutation invalidation policy.
Importing a template changes workspace apps, not the recommendation catalog.
Existing DSL import policies continue to refresh the affected app surfaces.
Local confirmation, tracking, toast, and navigation remain with the creation
workflow; they do not override shared import cache behavior.

The two migrated creation actions catch detail and import failures together.
A failed detail request must not import a DSL or navigate. The shared create
modal keeps its existing immediate-close-on-submit behavior; this migration does
not change that component's submission lifecycle. The installed-app action keeps
its existing empty-result and failure feedback.

## TypeScript and display boundaries

The API intentionally permits nullable nested app metadata and arbitrary string
`mode` and `icon_type` values because catalog sources include remote data. Keep
those generated types intact. Use the required top-level `app_id` for detail
identity even when nested app metadata is absent or has another ID.

Narrow icon values where they enter the icon primitive or controlled creation
form. Use optional access and local string defaults for rendered labels and
controlled inputs. Unknown modes remain visible in the unfiltered catalog and
match no specific mode filter. Optional categories are an empty set for filtering;
missing names do not match a nonempty name search. Keep server category order.

The removed normalizer fabricated nested description and answer-icon values.
The template chooser and Apps creation forms preserve their prior empty initial
description and false answer-icon default locally. Home retains its existing
catalog-level description. These are UI decisions, not extra API fields.

Use inference from generated options instead of manually assigning query result
generics, casting server strings to frontend enums, or adding a second transport
response type. Observer `select` may project data for rendering; it must not
change the raw cache contract or mutate the response arrays.

## Verification

Consumer tests exercise locale identity, cache reuse, sorting without mutation,
nullable metadata, selection, and creation/navigation failures through generated
transport and a real QueryClient. Existing Home tests protect its static detail
policy and preview/tour behavior. The backend controller, query service, catalog
router, and repository tests protect fallback and nullability semantics.
