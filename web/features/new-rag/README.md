# New RAG

This feature owns the KnowledgeFS-backed knowledge list, creation flows, sources, documents, revisions, and processing tasks.

- `routes.ts` provides feature route construction; new or modified navigation must consume it instead of rebuilding paths.
- Document query modules own server state. View components receive query results and user commands rather than mirroring remote state.
- Processing task events are normalized by the feature service and coordinated by the task observer and progress store.
- Exit confirmation, creation, and processing overlays are feature compositions of Dify UI Dialog, AlertDialog, Drawer, and Popover primitives.

Files in this directory remain feature-owned; direct consumers do not become their owners. Keep shared dataset APIs and permission policy in their existing owners rather than copying them into this feature.
