# Format and Lint Guide

We use Vite+ Oxfmt for formatting, Vite+ Oxlint for code-quality rules, and TypeScript for type safety.

## Format

Format the supported frontend and TypeScript workspace files from the repository root:

```sh
vp fmt
```

Check formatting without writing changes:

```sh
vp fmt --check
```

The shared formatter options and ignore boundaries live in the root `vite.config.ts`.
Editor format-on-save must point Oxc at that file so local edits match the commit hook and CI.

## Lint

Run the repository lint from the root:

```sh
pnpm lint
```

Call Vite+ directly with files or directories to target a smaller scope:

```sh
vp lint web/app/components packages/dify-ui/src/button
```

Apply safe fixes, then format the result:

```sh
vp lint --fix web/app/components
vp fmt web/app/components
```

Use `pnpm lint:quiet` to hide warnings. Oxlint runs in parallel by default, so the former ESLint cache and concurrency flags are not needed.

The complete rule baseline lives in `lint.config.ts` and is connected through the root `vite.config.ts` `lint` block. The rules are explicit snapshots of the ESLint configurations that were active at migration time. Do not import an upstream preset wholesale: enable a new rule intentionally and review its existing violations first.

Oxlint native rules are preferred. Rules that do not have a native equivalent use `jsPlugins` where the ESLint plugin API is compatible. The `eslint` package remains installed only to satisfy those plugins' peer dependencies; repository lint commands do not invoke ESLint.

### Auto-fix Workflow

Configure the Oxc editor extension to format and apply Oxlint fixes on save. As a fallback, the commit hook runs `vp staged`, applies `vp lint --fix` to staged JavaScript and TypeScript files, and then formats all supported staged files with Oxfmt. The autofix workflow also prunes resolved bulk suppressions.

Always review automatic fixes before committing. JS plugins are allowed to provide fixes, and their behavior is not necessarily identical to a native Oxlint rule.

### Type-aware Linting

The root configuration enables `typeAware` without enabling Oxlint's full `typeCheck` diagnostics. This preserves the Node SDK's existing type-aware lint rules without making lint duplicate the repository type-check task.

The web package still runs its existing TSSLint rule separately:

```sh
pnpm --dir web lint:tss
```

Run the regular type check before committing or pushing:

```sh
pnpm type-check
```

### Bulk Suppressions

Existing error diagnostics are tracked in the root `oxlint-suppressions.json`. Oxlint hides errors while their per-file rule count stays at or below the recorded baseline and reports newly added errors. Warnings remain visible and do not fail lint.

The bulk-suppression flags are available in the bundled Oxlint version but are currently hidden from `vp lint --help`. Run them from the repository root so every package uses the same baseline:

```sh
pnpm lint:scope packages web e2e cli sdks/nodejs-client vite.config.ts lint.config.ts --suppress-all
pnpm lint:scope packages web e2e cli sdks/nodejs-client vite.config.ts lint.config.ts --prune-suppressions
```

The Oxc editor extension does not yet apply the bulk-suppression baseline, so the editor may still display findings that the CLI suppresses.

### Known Migration Gaps

The following ESLint behavior is not currently expressible with the Vite+ Oxlint integration:

| Area                                        | Current status                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JSON, JSONC, YAML, TOML, and Markdown rules | Oxlint JS plugins cannot provide custom parsers or file formats. Oxfmt still formats these files, but the former JSONC semantic rules, package and tsconfig key ordering, pnpm workspace checks, Markdown preferences, and i18n JSON rules are deferred.                                                                                          |
| TypeScript declaration files                | The Oxlint 1.72 JS plugin runner crashes on declaration-only syntax used by the repository. `*.d.ts` files are excluded from lint until that compatibility issue is fixed; TypeScript still checks them.                                                                                                                                          |
| Missing core rules                          | `one-var`, `no-unreachable-loop`, `no-undef-init`, generic `no-restricted-syntax`, and JavaScript `dot-notation` have no equivalent in the bundled Oxlint version. The web restriction on importing `ahooks/useLocalStorageState` was rewritten with native `no-restricted-imports`; erasable TypeScript syntax remains covered by its JS plugin. |
| Override-scoped settings                    | Oxlint does not support `settings` inside overrides. The shared `better-tailwindcss` and `react-x` settings use the web values, so Dify UI cannot retain its separate Tailwind entry point yet.                                                                                                                                                   |
| Unused disable severity                     | Oxlint only accepts `reportUnusedDisableDirectives` at the root. It is set to `warn`; the former Dify UI-only `error` severity cannot be preserved.                                                                                                                                                                                               |
| JS plugin stability                         | JS plugin support is alpha. Plugins that require a custom parser or type-aware ESLint parser services cannot be used.                                                                                                                                                                                                                             |

Existing `eslint-disable` comments remain recognized because `respectEslintDisableDirectives` is enabled. Use the rule IDs from `lint.config.ts` when adding or updating a directive.

### Introducing New Plugins or Rules

Prefer a native Oxlint rule. If none exists, verify that the rule works through a JS plugin on representative files before enabling it. Record the limitation here instead of retaining a second ESLint lint path when the language, parser, settings, or type-aware plugin API is unsupported.

For overlay import policy and composition rules, see [Overlay Guide].

## Type Check

You should be able to see suggestions from TypeScript in your editor for all open files.

Run the repository type check from the root:

```sh
pnpm type-check
```

Type checking is powered by [`tsgo`] (the native TypeScript 7 compiler), which is significantly faster than `tsc`.

[Overlay Guide]: ./overlay.md
[`tsgo`]: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta
