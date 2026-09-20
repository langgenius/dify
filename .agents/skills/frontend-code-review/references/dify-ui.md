# Dify UI Review Routing

Use this reference when a review touches `packages/dify-ui/` or consumes
`@langgenius/dify-ui/*`. It routes to owner documentation; it does not redefine package
contracts.

Read `packages/dify-ui/AGENTS.md` and the primitive implementation first, then only the matching
owner:

| Review area                                | Canonical owner                                                     |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Package boundary and document routing      | `packages/dify-ui/AGENTS.md`                                        |
| Imports, exports, public types, and anatomy | `packages/dify-ui/docs/authoring.md`                                 |
| Button or icon-only actions                | `packages/dify-ui/src/button/README.md`, `packages/dify-ui/src/icon-button/README.md` |
| Compound inputs                            | `packages/dify-ui/src/input-group/README.md`                         |
| Forms and field semantics                  | `packages/dify-ui/docs/forms.md`                                     |
| Selection and typed values                 | `packages/dify-ui/docs/selection.md`                                 |
| Portals, layers, and floating surfaces     | `packages/dify-ui/docs/overlays.md`                                  |
| Tailwind and radius tokens                 | `packages/dify-ui/docs/styling.md`                                   |
| Package tests and Storybook                | `packages/dify-ui/docs/testing.md`                                   |

For consumer code under `web/`, also read `web/AGENTS.md` for application-owned reuse policy and
`packages/dify-ui/README.md` for the available public subpaths.

Treat the implementation, public types, tests, and stories as evidence for the documented
contract. If they disagree, identify the actual owner before reporting a finding. Read current
official Base UI documentation and installed type declarations for upstream-derived behavior.
Report only a reproducible contract violation or observable defect, not a preference inferred from
this routing file.
