# New RAG

This feature owns the KnowledgeFS-backed knowledge list, creation flows, sources, documents, revisions, retrieval evaluation, and processing tasks.

- Route surfaces live in `create/`, `documents/`, `sources/`, `retrieval/`, `quality/`, `settings/`, `space/`, and `overview/`; feature tests stay beside their owning surface.
- `list/` owns the KnowledgeFS list integration used by the existing dataset list, while `upload/` owns upload behavior shared by creation and document-management flows.
- `routes.ts` owns navigation only; shared source drafts, provider discovery, datasource parameters, and setup fields belong to `sources/setup/`.
- `create/`, `sources/create/`, and source editing own their distinct submission lifecycles; setup modules do not submit those workflows.
- `sources/connections/` owns provider identity matching and connection ranking across source flows.
- `documents/` owns document list and detail behavior, query options, permission recovery, task recovery, and metadata editing.
- Shared KnowledgeFS read contracts used by other features live under `service/knowledge-fs/`; feature-specific editing policy remains here.
- Document query modules own server-state configuration. View components consume those options and coordinate only workflows that require one consistent page snapshot.
- Document processing events live with `documents/tasks/`; retrieval event streams live with `retrieval/services/`.
- Creation and processing overlays are feature compositions of Dify UI Dialog, AlertDialog, Drawer, and Popover primitives.

Files in this directory remain feature-owned; direct consumers do not become their owners. Keep shared dataset APIs and permission policy in their existing owners rather than copying them into this feature.
