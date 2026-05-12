# Integrations Route Contract

This document records the current canonical routes for the Integrations navigation, the legacy routes that redirect to them, and the remaining migration gaps. The first migration only moves existing pages onto the new routes; UI redesign work is out of scope.

## Current Status

Completed:

| Area | Status |
| --- | --- |
| Canonical `/integrations/...` route adapter | Implemented in `web/app/(commonLayout)/integrations/[[...slug]]/page.tsx`. |
| Route contract utility | Implemented in `web/app/components/tools/integration-routes.ts`. |
| Existing page reuse | Implemented through `IntegrationSectionRenderer`; no duplicated UI copy. |
| Legacy `/tools?...` redirects | Implemented through `web/app/(commonLayout)/tools/page.tsx`. |
| Legacy `/plugins` installed redirects | Implemented through `web/app/(commonLayout)/plugins/page.tsx`. |
| Tools tab navigation under new URLs | Implemented; scoped tool tabs push canonical `/integrations/tools/...` URLs. |
| Singular-only canonical URLs | Implemented; plural and misplaced aliases are intentionally unsupported. |

Not completed:

| Area | Remaining work |
| --- | --- |
| Integrations overview page | Not introduced; `/integrations` currently redirects to `/integrations/model-provider`. |
| Tools overview page | Not introduced; `/integrations/tools` currently redirects to `/integrations/tools/built-in`. |
| Plugin route migration | `/plugins` still owns the old plugin management and marketplace surface; no `/integrations/plugin` route will be introduced. Non-marketplace plugin URLs should redirect to `/integrations`. |
| Marketplace route migration | `/marketplace/...` routes below are future recommendations only; they are not implemented here. |
| New onboarding UI redesign | Not started in this route migration; current pages intentionally reuse existing UI. |
| Marketplace plugin redirects | Not implemented; marketplace plugin URLs intentionally keep rendering the legacy plugin marketplace surface for now. |

## Navigation Labels

| Navigation item | Canonical label |
| --- | --- |
| Model Provider | Model Provider |
| Built-in tools | Built-in |
| Custom Tool | Swagger API as Tool |
| Workflow | Workflow as Tool |
| MCP | MCP |
| Data Source | Data Source |
| API Extension | API Extension |
| Plugins | Plugins |
| Marketplace | Marketplace |

## Canonical Integrations Routes

| Route | Destination |
| --- | --- |
| `/integrations` | Redirect to `/integrations/model-provider` unless an overview page is introduced. |
| `/integrations/model-provider` | Existing model provider management page. |
| `/integrations/tools` | Redirect to `/integrations/tools/built-in` unless a tools overview page is introduced. |
| `/integrations/tools/built-in` | Existing built-in tools list. |
| `/integrations/tools/swagger-api` | Existing custom API tool list, relabeled as Swagger API as Tool. |
| `/integrations/tools/workflow` | Existing Workflow as Tool management page. |
| `/integrations/tools/mcp` | Existing MCP tools management page. |
| `/integrations/trigger` | Existing plugin trigger list filtered from plugin management. |
| `/integrations/agent-strategy` | Existing agent strategy plugin list filtered from plugin management. |
| `/integrations/extension` | Existing extension plugin list filtered from plugin management. |
| `/integrations/data-source` | Existing data source page. |
| `/integrations/tools/api-extension` | Existing API extension page under the Tools group. |

## Integration Plugin Category Routes

These navigation items use plugin categories from the existing plugin management surface:

| Navigation item | Plugin category | Route |
| --- | --- | --- |
| Trigger | `trigger` | `/integrations/trigger` |
| Agent Strategy | `agent-strategy` | `/integrations/agent-strategy` |
| Extension | `extension` | `/integrations/extension` |

The install and filter controls in the Integrations sidebar are disabled actions, not route destinations.

These routes reuse the installed plugin management list with an initial category filter. They are not marketplace category pages.

Do not treat every plugin category as an Integrations navigation item automatically. `trigger`, `agent-strategy`, and `extension` are currently exposed under Integrations because they are explicit navigation items. Other plugin categories have different product meanings:

| Plugin category | Integrations relationship |
| --- | --- |
| `tool` | Not equal to `/integrations/tools/...`; tool plugins can expose tool providers that appear in Tools, but the Tools page is provider-based. |
| `model` | Not equal to `/integrations/model-provider`; model providers are managed through the model provider page. |
| `datasource` | Not equal to the full Data Source page; data source integrations have their own existing page. |
| `trigger` | Reused as `/integrations/trigger`, installed plugins filtered by category. |
| `agent-strategy` | Reused as `/integrations/agent-strategy`, installed plugins filtered by category. |
| `extension` | Reused as `/integrations/extension`, installed plugins filtered by category. |

## Legacy Tools Redirects

| Legacy route | New route |
| --- | --- |
| `/tools` | `/integrations/tools/built-in` |
| `/tools?section=provider` | `/integrations/model-provider` |
| `/tools?section=builtin` | `/integrations/tools/built-in` |
| `/tools?section=builtin&category=builtin` | `/integrations/tools/built-in` |
| `/tools?category=builtin` | `/integrations/tools/built-in` |
| `/tools?section=custom-tool` | `/integrations/tools/swagger-api` |
| `/tools?section=custom-tool&category=api` | `/integrations/tools/swagger-api` |
| `/tools?category=api` | `/integrations/tools/swagger-api` |
| `/tools?section=workflow-tool` | `/integrations/tools/workflow` |
| `/tools?section=workflow-tool&category=workflow` | `/integrations/tools/workflow` |
| `/tools?category=workflow` | `/integrations/tools/workflow` |
| `/tools?section=mcp` | `/integrations/tools/mcp` |
| `/tools?section=mcp&category=mcp` | `/integrations/tools/mcp` |
| `/tools?category=mcp` | `/integrations/tools/mcp` |
| `/tools?section=data-source` | `/integrations/data-source` |
| `/tools?section=api-based-extension` | `/integrations/tools/api-extension` |
| `/tools?section=trigger` | `/integrations/trigger` |
| `/tools?section=agent-strategy` | `/integrations/agent-strategy` |
| `/tools?section=extension` | `/integrations/extension` |

Preserve non-routing query parameters such as `q`, `tags`, and `sort`, but drop legacy routing parameters such as `section` and `category` during redirects.

## Non-Canonical Integrations Routes

Do not add plural or misplaced alias redirects for new Integrations URLs. Only the singular canonical routes above should resolve. For example, `/integrations/model-providers`, `/integrations/data-sources`, `/integrations/api-extensions`, `/integrations/tools/trigger`, `/integrations/tools/agent-strategy`, and `/integrations/tools/extension` should not be treated as supported URLs unless they are later confirmed to have shipped externally.

## Legacy Plugin Redirects

Plugins have two different product meanings today: installed plugin management and marketplace discovery. Only the non-marketplace plugin URLs should redirect into Integrations. There is no `/integrations/plugin` route.

| Old Plugin URL | Recommended redirect | Reason |
| --- | --- | --- |
| `/plugins` | `/integrations` | Installed plugin management entry should move into the Integrations main entry. |
| `/plugins?tab=plugins` | `/integrations` | Explicit installed plugins tab; non-marketplace semantics. |
| `/plugins?tab=discover` | Do not redirect to Integrations | Marketplace discovery. |
| `/plugins?tab=all` | Do not redirect to Integrations | Marketplace category: all. |
| `/plugins?tab=tool` | Do not redirect to Integrations | Marketplace tool category, not installed tools management. |
| `/plugins?tab=model` | Do not redirect to Integrations | Marketplace model category. |
| `/plugins?tab=trigger` | Do not redirect to Integrations | Marketplace trigger category. |
| `/plugins?tab=agent-strategy` | Do not redirect to Integrations | Marketplace agent strategy category. |
| `/plugins?tab=extension` | Do not redirect to Integrations | Marketplace extension category. |
| `/plugins?tab=datasource` | Do not redirect to Integrations | Marketplace datasource category. |
| `/plugins?tab=bundle` | Do not redirect to Integrations | Marketplace bundle category. |

## Migration Order

1. Add the canonical route map and route tests.
2. Mount the existing pages under the new Integrations routes without UI redesign.
3. Update internal links to generate canonical URLs.
4. Add legacy redirects for `/tools` and `/plugins`.
5. Keep compatibility tests for each legacy route until old links can be removed.
