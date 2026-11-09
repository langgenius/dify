# Agent strategies

The plugin detail panel, workflow strategy selector, and agent node configuration
consume generated Console options directly. The agent provider list and detail
share the backend contract across these surfaces; neither a service hook nor a
frontend response DTO owns a second version of that contract.

## API and type ownership

[Agent provider controllers] own the HTTP list and detail schemas, authentication,
and tenant admission. Their response models use `PluginAgentProviderEntity`, the
[plugin daemon model] already returned by `AgentService`. The generated
`AgentProviderResponse`, `AgentStrategyEntity`, and `AgentStrategyParameter` types
flow to their consumers without assertions that widen or narrow the response.
When this API changes, update its Python owner and regenerate TypeScript, Zod,
and OpenAPI Markdown together. The installed-plugin response contains a dynamic
manifest; its strategy declaration is parsed once with the generated Zod schema
at that existing boundary, so the plugin detail query never takes its provider
name from `any`.

Generated optional and nullable fields remain optional and nullable. Rendering
owners supply display fallbacks; they do not rewrite cached responses into a
second DTO. Localized labels use the i18n renderer. The generic credential form
accepts its own presentation schema, so the agent form owns that conversion and
retains typed parameter defaults, constraints, and field behavior, including
one-sided numeric bounds. Open JSON schema values are narrowed at their rendering
boundary; properties with boolean or unresolved schemas still display as unknown.

[Parameter initialization] owns execution-time defaults: missing, null, and empty
string inputs use the declaration default, while explicit `0` and `false` remain
values. Required defaults of `0` and `false` are valid too. Workflow validation
follows that rule. Editing may temporarily contain an empty input; do not force a
default back into every keystroke or lose the existing field's clearing behavior.

Strategy selection passes the fetched provider and strategy directly to the
agent-owned list. Only presentation helpers such as alphabetical grouping are
shared with other provider catalogs. Workflow state keeps the selected strategy's
output schema and the provider's plugin metadata without a Tool DTO intermediary. Saved nodes can lack a
plugin installation identifier; they still display and edit their selected
provider/strategy. Only installation and version-switch actions require that
identifier.

## Queries and freshness

| Call site                | Decision                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin detail            | Query the selected provider using its generated route input; disable the query when the provider is absent. Inherit normal query retries.                |
| Strategy selector        | Query the generated provider list while mounted; pass raw providers to the agent-owned list for display and selection.                                   |
| Workflow checklist       | Use the same provider list cache when checking installed strategies.                                                                                     |
| Agent node configuration | Query provider detail only when a provider is selected. Keep `retry: false` here because the error state participates in the node's installation status. |

All these queries inherit the existing QueryClient's five-minute freshness.
There is no strategy-specific `query-policies.ts` override, redundant locale key,
or custom polling policy. Provider names, including names containing slashes,
are part of generated route input and therefore cache identity. A missing
provider uses `skipToken`; an empty identifier is not a substitute request.

## Installation invalidation

There is no strategy mutation in this API. [Plugin installation refresh] owns the
completion event from install, upgrade, and uninstall workflows. For an agent
plugin, or an explicit refresh of every category, it invalidates both the provider
list and every provider detail using their generated keys. Refreshing only the
list would leave an open agent node or plugin detail using an outdated declaration.
Other categories do not invalidate strategy data. An absent manifest retains the
existing installed-list-only behavior unless the caller requests all categories.

This event hook owns category orchestration. It is not a forwarding wrapper
around a strategy query, and no additional invalidation helper is needed.

## Persisted workflow boundary

A current fetched declaration determines available parameter types. The backend
contract does not support `tool-selector`; it is not a valid strategy API variant.
Persisted workflow values have a separate lifecycle: existing `array[tools]`
conversion and `tool_node_version` handling remain at the agent node owner.
Removing obsolete response DTOs must not discard legitimate saved values.

Workflow variable discovery uses the existing JSON Schema-to-`VarType` resolver.
Display labels such as `String` and `Unknown` are not internal variable types:
string outputs use `VarType.string`, and unconstrained properties use `VarType.any`.
This keeps the variable picker's type filters consistent with strategy outputs.

## Verification

Controller and schema tests protect real daemon response serialization, nullable
fields, scalar defaults, and invalid parameter variants. Consumer tests exercise
generated requests, missing-provider behavior, selection, and form state.
Installation refresh tests use a real QueryClient to check both list and detail
invalidation and isolation from unrelated categories. Coverage percentage is not
an acceptance criterion.

[Agent provider controllers]: ../../../../../api/controllers/console/workspace/agent_providers.py
[Parameter initialization]: ../../../../../api/core/plugin/entities/parameters.py
[Plugin installation refresh]: ../install-plugin/hooks/use-refresh-plugin-list.tsx
[plugin daemon model]: ../../../../../api/core/plugin/entities/plugin_daemon.py
