# Local Vite DevTools integration

This experiment uses DevTools 0.7.6 with Vite+ 1.0.0-rc.0. Start it with
`pnpm --dir web dev:vinext`, then open `http://localhost:3000/__devtools/` or
the embedded dock. Authenticate using the code printed by the dev server.
Vinext bypasses `transformIndexHtml`, so `web/plugins/vite/devtools.ts` injects
the embedded client into the app's client entry.

The viewer is disabled for tests, Storybook, preview, and production builds.
The Rolldown **Run build** action runs `VITE_DEVTOOLS_ROLLDOWN=true vp build`;
that child records traces without starting a second viewer. The equivalent
manual command, from `web/`, is:

```sh
VITE_DEVTOOLS_ROLLDOWN=true pnpm exec vp build
```

Traces live in `web/node_modules/.rolldown` and can consume several GiB per
session. Oxc reports live in `.devtools-oxc` and are ignored by Git. Select
`../vite.config.ts` in Config Inspector for the repository lint configuration;
the default remains the project's own configuration when one exists.

## Upstream fixes now included

- [DevTools #581](https://github.com/vitejs/devtools/pull/581) ships in 0.7.6:
  project-relative paths, editor targets, and Vite+ build commands.
- [Config Inspector #17](https://github.com/nelsonlaidev/oxlint-config-inspector/pull/17)
  is included in the resolved `@oxlint-config-inspector/core` 1.1.4:
  discover and execute the inspected workspace's Vite+ installation.

The old `devtools-kit` and Config Inspector backport patches are no longer
needed. The original stash remains available; these patches contain only the
additional local fixes below.

## Remaining patches

| Package                                   | Purpose                                                                                                                                                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vitejs/devtools-oxc@0.7.6`              | Discover ancestor configs up to the workspace root without scanning sibling projects; validate real paths; retain project execution cwd; preserve explicit selection, then prefer project configs and the nearest ancestor. |
| `@vitejs/devtools-rolldown@0.7.6`         | Bound idle reader retention by source-log bytes; hydrate plugin details in batches; exclude dynamic imports from Initial JS, including restored caches.                                                                     |
| `@voidzero-dev/vite-plus-core@1.0.0-rc.0` | Allow large analysis traces to settle before native close, bounded to five minutes. Native close still provides the final flush acknowledgement.                                                                            |
| `@devframes/hub-ui@1.1.0`                 | Associate saved iframe routes with their owning dock in embedded and standalone viewers.                                                                                                                                    |

The reader budget is a cache-retention policy, not a process-wide heap limit.
An oversized active reader and simultaneous requests can exceed it. The trace
drain is a workaround: file quiescence alone is not proof of a native flush.
Reconcile these patches with upstream source before each dependency upgrade.
They modify published bundles, so asset names and regression extraction points
may also need updating.

## Verification

```sh
node --test patches/tests/*.test.mjs
pnpm exec vp check patches/tests web/vite.config.ts web/plugins/vite/devtools.ts
```

On 2026-09-25, all 12 installed-patch regression tests passed. A complete
traced build exited successfully and finalized all five sessions, including a
5.33 GiB client trace and a 5.05 GiB SSR trace. Config Inspector loaded the root
config with 1,301 rules and no plugin errors. The Vite panel loaded, and the
Vitest UI ran all 44 tests in `packages/nuqs-jotai` successfully. The client
trace and its Tailwind plugin details loaded in the browser with 11,982
transform calls. Dock switching followed by reload restored the selected tool.
Lint Inspector also produced a browsable report; refresh the result list if a
completed run still displays its loading state. Format Inspector passed its
read-only check of 7,520 files. Loading the 5.05 GiB SSR trace after the client
trace also succeeded (11,509 modules).

The repository-root `vp lint --quiet` also passed. The DevTools lint launcher
runs from `web/`; its report can differ from the root command, including the
application of the repository suppression baseline. Use the root command as
the authoritative repository check.

These checks do not imply that the entire Dify test suite passed. Loading the
Dify application itself also requires its backend; the DevTools viewer works
independently of that backend.

## Pending upstream PRs

- [DevTools #591](https://github.com/vitejs/devtools/pull/591): Initial JS static dependency traversal.
- [DevTools #592](https://github.com/vitejs/devtools/pull/592): batched plugin detail hydration.
- [DevTools #593](https://github.com/vitejs/devtools/pull/593): reader cache retention, including protection for metadata reads within the current session.

These fixes remain patched locally until an upstream release includes them.
