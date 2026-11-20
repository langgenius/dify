# Skills

Workspace Skill management, including the list, file editing, publishing, and version restoration.

## Public entrypoints

- `list/page.tsx` owns the list route, filtering, pagination, import, and card actions.
- `detail/route.tsx` binds the route identity and remounts the detail session when the Skill changes.
- `permissions.ts` owns navigation visibility and action permissions.
- `error.ts` owns Skill error interpretation, including Agent V2's Skill operations.

## Internal owners

`list/` keeps its card presentation, tag binding, toolbar, import dialog, and query coordination together. `references.tsx` owns read-only reference presentation shared by list cards and detail publishing; neither surface imports the other's internals.

`detail/page.tsx` coordinates the selected files, active version, panel visibility, and shared file-mutation queue. Its child workflows own the corresponding implementation:

- `files/`: file tree, clipboard and drag/drop, uploads, editor, tabs, and mutation/cache coordination.
- `markdown/`: SKILL.md frontmatter, file references, and source/live editing.
- `builder/`: assistant conversation and attachment policy.
- `publishing/`: publish actions and reference confirmation.
- `versions/`: version browsing and restoration.

`draft.ts` derives the editable draft's metadata from SKILL.md. Metadata and display-name controls stay with the detail session. Query and mutation callers retain generated contracts; `client.ts` owns the existing binary upload/download and assistant stream transport.

Import concrete owners within this feature. Other features consume only the public entrypoints; do not assemble a Skill editor from detail components or import local mutation/cache internals.
