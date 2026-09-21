# Public API Authoring

Each `src/<primitive>/index.tsx` is an explicit public API boundary. Keep implementation details
module-local and publish the complete surface through separate `export { ... }` and
`export type { ... }` manifests at the bottom of the file. Do not mix scattered inline exports
with the manifest or use wildcard exports.

## React imports

Use React namespace imports throughout this package, including stories and tests. Use
`import * as React from 'react'` when calling React runtime APIs, and
`import type * as React from 'react'` when referencing only React types. A runtime namespace
import also covers React types; do not add separate named type imports. JSX alone does not
require an explicit React import.

## Subpaths and names

Every public primitive needs a matching `package.json#exports` subpath. Import relatively between
package components; consumers import only through public subpaths.

Use the primitive name without a `Root` suffix for the canonical boundary and matching props type:
`Select` and `SelectProps`, `Drawer` and `DrawerProps`. Keep `Root` only when the same subpath
exports both low-level anatomy and a higher-level convenience component, such as `CheckboxRoot`
and `Checkbox`.

Every runtime component must have an accurate, importable props type with the matching name. Use a
direct alias for an unchanged Base UI part. Define Dify-authored composite props at the Dify UI
boundary instead of copying upstream shapes.

Use a discriminated union when one prop changes the valid shape of related props, such as
controlled versus uncontrolled state or single versus multiple selection.

## Generic contracts

Preserve generic relationships end to end, including picker `Value` and `Multiple`, form values,
radio and slider values, and overlay payloads or handles. Do not erase caller-owned types with
`any` or a hard-coded `string`. Use `unknown` only as the safe default for independently consumed
anatomy whose value JSX cannot infer from its parent.

Do not add a root-only generic when separately rendered anatomy can produce values outside the
root's inferred type. Preserve the upstream contract until the whole component family can enforce
one value type. `Tabs` intentionally follows Base UI's non-generic root because its current tab
value type is `any | null`; do not advertise a type relationship the complete anatomy cannot
enforce.

Preserve upstream anatomy when its parts own distinct semantics, interaction, or positioning.
Create a Dify-authored convenience component only when the package adds a shared contract; do not
hide primitive parts merely to shorten a consumer call site.

## Keep the public surface small

A type is not public merely because Base UI names it or an implementation once exported it. In
addition to matching component props, export a type only when it pairs with a public factory or a
real consumer must name it independently.

State, event details and reasons, actions, controlled-state helpers, context values, render
helpers, styling helpers, and upstream passthrough aliases are private by default. Public props
already provide contextual typing for inline render and event callbacks.

Preserve upstream `className` and `style` callbacks. Resolve `className` with the owning Base UI
part's state before merging default classes with `cn()`, including through composite wrappers.
Forward `style` unchanged unless the wrapper needs to merge styles; then resolve its callback first.
Do not add state callbacks to native DOM props or unrelated custom APIs. See [Styling].

## Evidence

Use local public-subpath type tests to protect generic inference, required relationships, and
intentional errors. Read current official Base UI documentation and installed type declarations
before changing an upstream-derived contract.

[Styling]: ./styling.md
