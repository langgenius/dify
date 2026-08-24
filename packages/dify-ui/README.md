# @langgenius/dify-ui

Independent UI primitives, design tokens, CSS-first Tailwind styles, and the `cn()` utility for
Dify products.

Most interactive primitives are thin, opinionated wrappers around [Base UI] headless components.
Dify-authored primitives use semantic HTML, `cva`, `cn`, and Dify design tokens. The package is
private to the workspace, but its public subpaths are treated as stable package boundaries.

## Usage

Add the workspace dependency:

```jsonc
{
  "dependencies": {
    "@langgenius/dify-ui": "workspace:*",
  },
}
```

Import from a public subpath. The package intentionally has no root barrel:

```tsx
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { cn } from '@langgenius/dify-ui/cn'
import '@langgenius/dify-ui/styles.css'
```

Import `styles.css` once from the consumer's root stylesheet or entrypoint.

## Primitives

| Category         | Public subpaths                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Actions          | `./button`, `./icon-button`, `./toggle`                                                                                                                                              |
| Controls         | `./segmented-control`                                                                                                                                                                |
| Display          | `./collapsible`, `./kbd`                                                                                                                                                             |
| Feedback         | `./meter`, `./progress`, `./status-dot`, `./toast`                                                                                                                                   |
| Form             | `./form`, `./field`, `./fieldset`, `./input`, `./input-group`, `./textarea`, `./checkbox`, `./checkbox-group`, `./radio-group`, `./number-field`, `./select`, `./slider`, `./switch` |
| Layout           | `./scroll-area`                                                                                                                                                                      |
| Media            | `./avatar`                                                                                                                                                                           |
| Navigation       | `./file-tree`, `./pagination`, `./tabs`                                                                                                                                              |
| Overlay and menu | `./alert-dialog`, `./context-menu`, `./dialog`, `./drawer`, `./dropdown-menu`, `./popover`, `./preview-card`, `./tooltip`                                                            |
| Search and pick  | `./autocomplete`, `./combobox`, `./select`                                                                                                                                           |

Utilities:

- `./cn` composes conditional classes with `clsx` and `tailwind-merge`.
- `./styles.css` provides design tokens, theme variables, and shared utilities.

## Guides

Start here, then open only the guide for the contract being changed. Component-specific Dify
behavior lives beside the component. Contracts shared by several primitives live in `docs/`.
Upstream behavior remains owned by the [Base UI documentation].

### Component guides

| Guide         | Dify-owned contract                                                                         |
| ------------- | ------------------------------------------------------------------------------------------- |
| [Button]      | Action semantics, submit and link choices, loading versus disabled, and content spacing.    |
| [Icon Button] | Accessible names, decorative glyphs, appearance ownership, and primitive composition.       |
| [Input Group] | Compound input anatomy, shared-surface ownership, DOM order, focus, and interactive addons. |

### Cross-component guides

| Guide                     | Scope                                                                          |
| ------------------------- | ------------------------------------------------------------------------------ |
| [Forms]                   | Native submit boundaries, fields, labels, grouped controls, and errors.        |
| [Selection]               | Typed values and choosing among segmented controls, pickers, and radio groups. |
| [Overlays]                | Portals, root isolation, layering, trigger composition, and semantics.         |
| [Styling]                 | Tailwind CSS integration and the Figma radius mapping.                         |
| [Public API authoring]    | Subpath exports, naming, public types, generics, and private helpers.          |
| [Testing and development] | Package commands, test ownership, accessibility, and animation setup.          |

## Contributing

Read [component authoring rules] before modifying the package, then open only the matching owner
guide. This index intentionally does not duplicate those contracts.

[Base UI documentation]: https://base-ui.com/llms.txt
[Base UI]: https://base-ui.com/react
[Button]: ./src/button/README.md
[Forms]: ./docs/forms.md
[Icon Button]: ./src/icon-button/README.md
[Input Group]: ./src/input-group/README.md
[Overlays]: ./docs/overlays.md
[Public API authoring]: ./docs/authoring.md
[Selection]: ./docs/selection.md
[Styling]: ./docs/styling.md
[Testing and development]: ./docs/testing.md
[component authoring rules]: ./AGENTS.md
