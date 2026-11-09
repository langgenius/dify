# Datasource catalog

`GET /rag/pipelines/datasource-plugins` owns the workspace's available datasource
providers. The controller exports `RagPipelineDatasourceListResponse` from the
existing plugin datasource domain entities. Generated Console types are the wire
contract; consumers must not recreate a `DataSourceItem` or cast providers and
parameters to tool DTOs.

## Data ownership

The plugin manager inserts local-file support, resolves output-schema references,
and normalizes declaration identities. The top-level `provider` is the original
provider name; `declaration.identity.name` and each datasource's
`identity.provider` contain the plugin/provider path. Saved workflow nodes retain
the original provider name because execution joins it with `plugin_id`.

The pipeline service derives `is_authorized` from workspace credentials. A provider
without credential or OAuth requirements is available without authorization.
Credential lookup failures leave it unauthorized. This field describes workspace
availability; it does not grant a user permission to manage credentials.

The Query cache and workflow store retain the generated response without mutation.
Icon URLs are projected at display boundaries: root-relative URLs receive
`basePath` once; absolute and protocol-relative URLs remain intact.

Installed-plugin manifests use the generated `DatasourceProviderEntity` for
their datasource declaration. This declaration is not the catalog response: it
has no expanded action list or workspace authorization state. The unknown
manifest input is validated once with its generated Zod schema; absent and null
declarations remain absent and null. Plugin details only use its presence to
admit the datasource section.

## Query and refresh ownership

All consumers use `consoleQuery.rag.pipelines.datasourcePlugins.get.queryOptions()`.
The operation policy uses `staleTime: 0` and `retry: false`, preserving immediate
availability checks without retrying an unavailable plugin catalog.

| Consumer                | Admission and local responsibility                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Pipeline configuration  | Requires a pipeline ID. Its observer synchronizes cached data and subsequent refreshes into the workflow store, including an empty result. |
| Document source options | Reads the mounted source's icon without changing cached provider data.                                                                     |
| Deployment precheck     | Fetches only when an unsupported node is a datasource.                                                                                     |
| Plugin detail           | Checks whether the plugin has a catalog provider. Retains the existing zero-action heading; it does not enable a new action browser.       |

Plugin installation, datasource node installation, credential reconciliation, and
the datasource settings page refresh the generated catalog key directly. Each
owner calls `QueryClient.invalidateQueries` inline. This read-only catalog has no
mutation endpoint and adds no mutation policy. Credential writes and OAuth
lifecycles belong to the authorization module; they must also reconcile catalog
availability when credentials change.

## Type and presentation boundaries

`WorkflowPluginCatalogs` names each catalog explicitly: tool collections keep
their tool type, while `dataSourceList` holds generated datasource providers.
Common node fields explicitly select `provider_type`, `provider_name`, `plugin_id`,
and `plugin_unique_identifier` from plugin defaults;
tool parameters and output schemas belong to their specific node payloads.
The pipeline slice declares its complete output separately from the partially
injected workflow state, so context injection needs no type assertion.

The datasource selector consumes provider declarations directly and creates
`DataSourceDefaultValue` without an intermediate tool value. It preserves provider
search, localized grouping, marketplace discovery, and local-file defaults. A
saved node can still resolve a provider without newer plugin version metadata.

Datasource parameters have their own generated parameter union. Their form
projection reads `description`, retains `false` and `0`, and preserves numeric
bounds. The shared parameter form receives an explicit static-schema capability;
it does not send datasource identities to tool or trigger dynamic-option APIs.
Credential-management schema types are not widened to describe node parameter
values.

Output schemas may contain arbitrary JSON. The variable and read-only schema
presentations narrow supported properties, types, descriptions, and enums at the
point of use. Unknown or boolean schema nodes do not justify changing backend
JSON-schema semantics or asserting an LLM editor schema. LLM schema editing keeps
its own contract.

## Provider identity and Readme

Saved nodes resolve an exact installed identifier first, then the same plugin ID
when its installed version has changed. Provider-name fallback is only for saved
nodes without either plugin identity; another plugin with the same provider name
must not supply authorization, parameters, outputs, or installation status.

The workflow Readme entry passes the raw catalog provider through the Readme
session. Its header reads `declaration.identity` and has no installed-plugin
management actions. Full installed-plugin details retain their own header.
Catalog providers are not cast to `PluginDetail`, and no synthetic installation
fields are added to make that presentation work.
