# New RAG

This feature owns the KnowledgeFS-backed knowledge list, creation flows, sources, documents, revisions, and processing tasks.

- `routes.ts` owns navigation only; source draft schemas and persistence belong to `sources/create/`.
- `sources/connections/` owns provider identity matching and connection ranking across source flows.
- `documents/` owns the documents route, query options, permission recovery, task recovery, upload policy, and metadata editing.
- Shared KnowledgeFS read contracts used by other features live under `service/knowledge-fs/`; feature-specific editing policy remains here.
- Document query modules own server-state configuration. View components consume those options and coordinate only workflows that require one consistent page snapshot.
- Processing task events are normalized by the feature service and coordinated by the task observer and progress store.
- Exit confirmation, creation, and processing overlays are feature compositions of Dify UI Dialog, AlertDialog, Drawer, and Popover primitives.

Files in this directory remain feature-owned; direct consumers do not become their owners. Keep shared dataset APIs and permission policy in their existing owners rather than copying them into this feature.
