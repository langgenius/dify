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

## Translation loading

`knowledgeSpace` contains list and shell copy, shared status labels, model readiness guidance, and labels reused across routes. Page and action owners request additional namespaces through their own translation hooks:

| Namespace            | Owner                                                    |
| -------------------- | -------------------------------------------------------- |
| `knowledgeCreate`    | Creation and initial upload                              |
| `knowledgeSources`   | Source connection, crawl preview, and sync configuration |
| `knowledgeDocuments` | Document list, detail, and metadata actions              |
| `knowledgeTasks`     | Processing task drawer controls                          |
| `knowledgeOverview`  | Overview panels and activity history                     |
| `knowledgeQuality`   | Golden questions, bad cases, and evaluations             |
| `knowledgeRetrieval` | Retrieval composer, history, and results                 |
| `knowledgeSettings`  | Configuration forms                                      |
| `knowledgeUpgrade`   | Legacy knowledge upgrade actions and dialog              |
| `knowledgeErrors`    | Structured task failures and settings mutation errors    |
| `knowledgeCitation`  | Citation resolution errors shared with chat              |

Keep shell navigation labels in `knowledgeSpace`: referencing a label from a page namespace loads the whole dictionary. Successful document and source rows do not request `knowledgeErrors`; conditional error surfaces have their own Suspense and translation boundary. The API Access dialog first mounts when requested and remains mounted afterwards to preserve closing transitions and its API Key handoff.

Server rendering and client navigation use the same component-owned namespace declarations. Server metadata requests its explicit namespace separately; SSR streams only the resources requested by rendered owners for hydration. A mounted provider retains visited namespaces, so switching language reloads previously requested namespaces as well as those on the current screen.
