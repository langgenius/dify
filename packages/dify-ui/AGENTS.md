# @langgenius/dify-ui

This package owns shared design tokens, CSS-first Tailwind styles, the `cn()` utility, and headless primitives consumed by `web/`. Read only the matching topic in [`README.md`] for public imports, forms, typed values, pickers, overlays, tokens, or tests.

## Component Authoring Rules

- Build primitives from `@base-ui/react`, `cva`, and `cn`.
- Use relative cross-component imports inside the package and subpath exports such as `@langgenius/dify-ui/button` from consumers. Add a matching `package.json#exports` entry for each public primitive.
- Keep one primitive per `src/<name>/` folder with optional colocated stories and tests.
- Do not import from `web/` or depend on Next.js, i18n, application state, or data-fetching libraries.
- Preserve upstream Base UI anatomy and generic value contracts. Use discriminated unions when one prop changes the valid shape of related props; do not flatten those relationships or hard-code selectable values to `string`.
- Export shared public types from the owning component subpath.
- Prefer Base UI data attributes and CSS variables for visual states; do not mirror primitive state in React solely to add classes.
- When a Base UI API or selector contract is unclear, read the current official documentation and local `@base-ui/react` type declarations before coding.

Use the README sections as the detailed owners:

- [Imports and public boundaries]
- [Typed value contracts]
- [Search and picker selection]
- [Tailwind and Figma radius mapping]
- [Overlay and portal contracts]
- [Development and test boundaries]

[Development and test boundaries]: README.md#development
[Imports and public boundaries]: README.md#imports
[Overlay and portal contracts]: README.md#overlay--portal-contract
[Search and picker selection]: README.md#search-and-picker-selection
[Tailwind and Figma radius mapping]: README.md#tailwind-css-v4-integration
[Typed value contracts]: README.md#typed-value-contracts
[`README.md`]: README.md
