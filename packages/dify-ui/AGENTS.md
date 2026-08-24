# @langgenius/dify-ui

This file owns the package boundary and routes detailed contracts. Start from the [package index],
then read only the guide for the contract being changed.

## Package boundary

- Keep this an independent primitive package. Do not import from application packages or depend on
  routing, i18n, application state, schemas, data fetching, or business APIs.
- Prefer `@base-ui/react` when it owns the required headless behavior. Style primitives with `cva`,
  `cn`, and Dify design tokens. Keep one primitive per `src/<name>/` folder with optional colocated
  stories and tests.
- Prefer Base UI data attributes and CSS variables for visual states. Do not mirror primitive state
  in React solely to add classes.
- When an upstream API or selector contract is unclear, read the current official Base UI
  documentation and installed `@base-ui/react` declarations before coding.

## Contract owners

- Imports, exports, naming, public types, generics, and anatomy: [Public API authoring]
- Button and icon-only action behavior: [Button contract] and [Icon Button contract]
- Compound input behavior: [Input Group contract]
- Form structure and labels: [Forms]
- Picker choice and typed values: [Selection]
- Portals, layering, and floating-surface semantics: [Overlays]
- Tailwind integration and radius mapping: [Styling]
- Package test ownership and setup: [Testing and development]

A component needs a local README only when it owns a substantial Dify-specific contract that its
types, stories, and upstream documentation do not express. Do not create one for completeness.

[Button contract]: src/button/README.md
[Forms]: docs/forms.md
[Icon Button contract]: src/icon-button/README.md
[Input Group contract]: src/input-group/README.md
[Overlays]: docs/overlays.md
[Public API authoring]: docs/authoring.md
[Selection]: docs/selection.md
[Styling]: docs/styling.md
[Testing and development]: docs/testing.md
[package index]: README.md
