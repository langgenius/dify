# Web feature ownership

A feature owns a product capability, route, or workflow: its behavior, state,
queries, presentation, and tests change together. A directory is not a feature
merely because several callers use the same endpoint. Shared operation policy and
response adapters belong to their service contract; generic file presentation
belongs to Web utilities.

## Entry points and dependencies

Import a concrete documented capability. An entry point owns composition or a
stable domain contract; do not add a root barrel that only exposes internal files.
Keep route identity, providers, and session lifetimes at the appropriate entry
point. Local forms and interactions remain with their mounted owner.

- Agent V2's [editor] owns the editing surfaces shared by Agent routes, Workflow
  nodes, and template previews. Workflow owns graph bindings and passes resource
  identity to the editor. `agent-composer` remains the only editable configuration
  state owner.
- [Skills] owns list and detail workflows. Other features consume its route,
  permission, and error entry points, not editor components or mutation internals.
- [Tag management] owns tag selection and management. Product cards own their
  presentation and resource-specific adapters.
- [Marketplace] owns availability, links, assets, and generated search results.
  Consumer UI owns the conversion to its card model.
- [KnowledgeFS] service contracts own shared reads, including citation resolution;
  `new-rag` owns knowledge editing workflows.

The `dify/feature-boundaries` check enforces the migrated Agent editor, Skills,
and tag entry points, keeps shared Marketplace and tag capabilities independent
of consumer UI, and prevents Skills from depending on Agent-specific file helpers.
It checks static imports, re-exports, and literal dynamic imports, including
relative paths. Tests may import internal owners to verify their contracts.

## Existing application capabilities

`theme`, `system-features`, and `account-profile` also contain application-wide
contracts. Their presence here does not make them product workflows. Preserve
one authoritative theme/bootstrap/account contract rather than creating parallel
feature state. A future directory classification change must preserve those
contracts and their server/client entry points; moving them alone does not repair
a business boundary.

[KnowledgeFS]: ../service/knowledge-fs/
[Marketplace]: ./marketplace/README.md
[Skills]: ./skills/README.md
[Tag management]: ./tag-management/README.md
[editor]: ./agent-v2/agent-editor/README.md
