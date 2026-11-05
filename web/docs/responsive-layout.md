# Responsive Layout

A responsive surface keeps one component tree at every width. CSS decides what is visible and where it sits; JavaScript handles only the behaviour CSS cannot express.

## Choose the Owner

Check in order:

1. Visibility, placement, spacing, and size belong to Tailwind responsive variants such as `max-sm:` and `md:`. No hook.
1. Behaviour that depends on available width, such as whether an overlay is modal or which orientation a component uses, reads `useMediaQuery` from `@langgenius/dify-ui/use-media-query`. Write the query against the Tailwind breakpoint it mirrors, so JavaScript and CSS switch at the same pixel: `(width < 40rem)` for `sm`, `(width < 48rem)` for `md`.
1. Differences in input rather than space, such as hover affordances or touch gestures, use `hover` and `pointer` media queries, not width.

## Rules

- Do not render a different component tree per breakpoint. Crossing the breakpoint remounts the subtree and drops focus and local state, and zooming a desktop browser crosses it as well. When narrow screens need an overlay, keep one copy of the content and add the overlay only for narrow screens.
- Derive from the query during render. Do not copy it into state with an effect or use it as a `useState` initial value. When the narrow and wide surfaces each need open state, keep one state per surface and choose between them by the query.
- Name the result after the breakpoint or the surface, such as `isBelowSm` or `isCompact`, not after a device. Width tells how much space there is, not what device the user has.
- A value read once inside an event handler or an effect can call `window.matchMedia` directly. A value used for rendering goes through `useMediaQuery`.
- On the server and during hydration the hook returns `false`, so the first render is the wide layout. Anything that must look different on narrow screens from the first paint belongs in CSS.

## Existing Code

Some surfaces still switch component trees by width. Do not copy them into new code; restructure them toward one tree when they are next changed.
