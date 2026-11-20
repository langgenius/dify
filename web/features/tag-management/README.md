# Tag management

This feature owns resource tag selection, filtering, tag management, binding
mutations, and tag permissions. It does not own product cards or their layout.

## Public entry points

- `tag-selector.tsx`: resource binding, selection, and creation.
- `tag-filter.tsx`: list filtering by tag identity.
- `tag-management-dialog.tsx`: management dialog and its existing mounted draft.
- `tag-option.ts`: the tag/create-option contract for composed tag controls.
- `tag-search-content.tsx`: search and option presentation for composed controls.

`tag-bindings.ts`, `permissions.ts`, `tag-item-editor.tsx`, and
`tag-trigger-content.tsx` implement those capabilities. Other features should not
assemble their own binding mutations or depend on these internals.

App and Dataset cards compose `TagSelector` directly. Skills list cards own the
conversion from Skill tag names to tag records in their local `skill-card-tags`.
Tag permissions use the generated permission-key contract, not another product's
UI constants. Shared browser test setup lives in `web/test/tag-management.tsx`.
