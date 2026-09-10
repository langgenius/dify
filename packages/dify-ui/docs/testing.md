# Testing and Development

Run `vp check packages/dify-ui` from the repository root for formatting, lint, and TypeScript
diagnostics. Run the remaining commands from `packages/dify-ui/`:

- `vp test --project unit` runs primitive unit tests.
- `vp run storybook` starts Storybook.
- `vp test --project storybook --run` runs Storybook component tests in browser mode.
- `vp test` runs both test projects.

## Test boundary

This guide owns the Dify UI testing policy and runtime setup. Add tests for observable Dify
integration behavior or a reproducible regression, not merely because a component or prop exists.

The package has two [Vitest projects]. Both run in Playwright Chromium [Browser Mode]; the project
name identifies the behavior owner, not a different runtime.

Use Storybook for a documented component example. Every story is a render contract and runs the
configured accessibility checks through the [Storybook Vitest addon]. Add `play` when the example
also owns visible state changes, user interaction, keyboard paths, overlay flows, form behavior,
loading behavior, or controlled-state coordination.

Use regular Vitest tests for Dify integration behavior that does not need a documented example,
such as submitted values, store behavior, or a known regression reached through a public API.
Prop passthrough alone does not justify a test. Assert the resulting behavior instead of CSS class
names or private structure, and do not duplicate behavior already owned by Base UI or the browser.

Storybook [accessibility testing] uses `a11y.test = 'error'`, so enabled violations fail the test.
Color contrast is the only globally disabled rule because it is a known design-token gap. Do not
add another global exception. Keep a temporary exception local to the affected story, and do not
use a `play` test in place of an accessibility fix.

## Animation setup

Base UI can wait for `element.getAnimations()` before unmounting transition-driven components.
[`vitest.setup.ts`] sets `BASE_UI_ANIMATIONS_DISABLED = true` for primitive tests
that assert final DOM state. Storybook uses its preview setup and retains real animation lifecycles.
A unit test that intentionally asserts animation behavior may set the flag to `false` locally,
but must restore the previous value during cleanup.

[Browser Mode]: https://vitest.dev/guide/browser
[Storybook Vitest addon]: https://storybook.js.org/docs/writing-tests/integrations/vitest-addon/index
[Vitest projects]: https://vitest.dev/guide/projects.html
[`vitest.setup.ts`]: ../vitest.setup.ts
[accessibility testing]: https://storybook.js.org/docs/writing-tests/accessibility-testing
