# Format and Lint Guide

We use Vite+ Oxfmt for formatting, Vite+ Oxlint as the primary code-quality linter, ESLint for the rules and file types that Oxlint cannot handle reliably, and TypeScript for type safety.

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

Run the two lint paths separately when targeting a smaller scope:

```sh
pnpm lint:oxlint:scope web/app/components packages/dify-ui/src/button
pnpm lint:eslint:scope web/app/components packages/dify-ui/src/button
```

Apply safe fixes, then format the result:

```sh
pnpm lint:oxlint:scope:fix web/app/components
pnpm lint:eslint:scope:fix web/app/components
vp fmt web/app/components
```

Use `pnpm lint:quiet` to hide warnings from both linters. Oxlint runs in parallel by default. The root ESLint scripts enable automatic concurrency, while scoped runs use ESLint's default for smaller file sets.

The primary rule baseline lives in `lint.config.ts` and is connected through the root `vite.config.ts` `lint` block. Oxlint-native rules are preferred, and compatible ESLint rules can run through Oxlint's `jsPlugins` support. The rules are explicit snapshots of the ESLint configurations that were active at migration time. Do not import an upstream preset wholesale: enable a new rule intentionally and review its existing violations first.

The fallback baseline lives in `eslint.config.mjs`. It covers declaration files, structured data and Markdown, missing core rules, rules with incomplete Oxlint behavior such as `no-control-regex`, and rules that require override-scoped settings such as Dify UI's Tailwind entry point. This configuration lists only the required fallback rules and does not import or depend on the Antfu ESLint config.

### Auto-fix Workflow

Configure the Oxc and ESLint editor extensions to apply their respective fixes on save. The commit hook runs `vp staged`: JavaScript and TypeScript pass through Oxlint, ESLint, and Oxfmt in that order; data and Markdown files pass through ESLint and Oxfmt. The autofix workflow also prunes resolved bulk suppressions.

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

Existing error diagnostics are tracked in two root files:

- `oxlint-suppressions.json` stores the Oxlint baseline.
- `eslint-suppressions.json` stores the ESLint fallback baseline.

Each linter reports newly added errors beyond its recorded per-file rule baseline. Warnings remain visible and do not fail the normal lint command.

The bulk-suppression flags are available in the bundled Oxlint version but are currently hidden from `vp lint --help`. Run them from the repository root so every package uses the same baseline:

```sh
pnpm lint:oxlint:scope packages web e2e cli sdks/nodejs-client vite.config.ts lint.config.ts --suppress-all
pnpm lint:oxlint:scope packages web e2e cli sdks/nodejs-client vite.config.ts lint.config.ts --prune-suppressions
pnpm lint:eslint:scope packages web e2e cli sdks/nodejs-client/src sdks/nodejs-client/tests package.json pnpm-workspace.yaml eslint.config.mjs vite.config.ts lint.config.ts --suppress-all
pnpm lint:eslint:scope packages web e2e cli sdks/nodejs-client/src sdks/nodejs-client/tests package.json pnpm-workspace.yaml eslint.config.mjs vite.config.ts lint.config.ts --prune-suppressions
```

The Oxc editor extension does not yet apply the bulk-suppression baseline, so the editor may still display findings that the CLI suppresses.

### Known Migration Gaps

The fallback config preserves behavior that is not currently expressible with the Vite+ Oxlint integration. The remaining limitations are:

| Area                     | Current status                                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oxlint JS plugins        | JS plugin support is alpha. Plugins that require a custom parser, unsupported syntax, type-aware ESLint parser services, or per-override settings must stay on the explicit ESLint fallback path.               |
| Declaration files        | The Oxlint JS plugin runner cannot safely process the repository's declaration-only syntax. Oxlint excludes `*.d.ts`; ESLint and TypeScript cover these files.                                                  |
| Non-JavaScript formats   | Oxlint plugins cannot provide custom parsers or file languages. ESLint covers JSON, JSONC, YAML, TOML, and Markdown semantic rules, while Oxfmt remains responsible for their formatting.                       |
| Markdown code blocks     | ESLint validates the Markdown document, but fenced JavaScript and TypeScript blocks are not passed through the former overlapping preset. This remains deferred rather than duplicating the Oxlint rule set.    |
| Override-scoped settings | Dify UI Tailwind rules use ESLint for their package-specific entry point. Oxlint still applies the web `react-x.additionalStateHooks` setting globally because it cannot scope settings to an override.         |
| Oxlint disable severity  | Oxlint only accepts `reportUnusedDisableDirectives` at the root, where it is `warn`. ESLint retains the Dify UI-specific `error` severity for its own directives, but cannot change the Oxlint directive check. |

Suppression comments belong to exactly one linter. Use `oxlint-disable` with rule IDs from `lint.config.ts` for primary rules, and use `eslint-disable` with rule IDs from `eslint.config.mjs` only for fallback rules. Oxlint deliberately sets `respectEslintDisableDirectives` to `false`, so an ESLint comment cannot hide an Oxlint finding.

### Introducing New Plugins or Rules

Prefer a native Oxlint rule. If none exists, verify that the rule works through an Oxlint JS plugin on representative files. Add it to the explicit ESLint fallback only when Oxlint cannot support the language, parser, syntax, settings, or type-aware plugin API. Do not add the Antfu ESLint config as a dependency or enable rules that are already covered by Oxlint.

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
