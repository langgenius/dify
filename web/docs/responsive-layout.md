# Responsive Layout

Viewport width tells how much space there is, not which device the user has. A desktop browser zoomed in is as narrow as a phone.

A responsive surface is one component tree at every width. CSS decides how it looks at each breakpoint. JavaScript reads width only for behaviour CSS cannot express, through `@langgenius/dify-ui/use-media-query`, at the same breakpoints as Tailwind.

## What Goes Wrong

- **A component tree per breakpoint.** Crossing the breakpoint, including by zooming, remounts the subtree and drops focus and local state.
- **The query copied into state**, by an Effect or as a `useState` initial value. State and screen disagree after the width changes, and a first mount during hydration only sees the wide default. See [component state] and [Effects].
- **JavaScript and CSS switching at different widths.** The surface passes through a state neither side designed.
- **Width used as a device check.** Flags named like `isMobile` invite assumptions about touch or hover that width cannot support; input differences follow the `hover` and `pointer` media features.

Some existing surfaces still switch component trees by width. They are not examples to follow.

[Effects]: ../../.agents/skills/how-to-write-component/references/runtime.md
[component state]: ../../.agents/skills/how-to-write-component/references/state.md
