# Static Check Guide

Vite+ provides the primary static check through `vp check`, which combines Oxfmt formatting, Oxlint code-quality rules, and TypeScript diagnostics. The root command also runs ESLint for non-code file types that Oxlint cannot parse.

## Check

Run the complete repository check from the root:

```sh
pnpm check
```

Apply safe fixes before running the same checks:

```sh
pnpm check:fix
```

CI and local development use the same root `vite.config.ts` configuration.

For a smaller code scope, pass paths directly to Vite+:

```sh
vp check web/app/components packages/dify-ui/src/button
vp check --fix web/app/components packages/dify-ui/src/button
```

Run the ESLint fallback separately when targeting JSON, JSONC, JSON5, YAML, TOML, or Markdown:

```sh
pnpm lint:eslint package.json pnpm-workspace.yaml web/docs
pnpm lint:eslint:fix package.json pnpm-workspace.yaml web/docs
```

Oxlint and Vite+ type-check scope is defined by `lint.config.ts` `ignorePatterns`, and ESLint's scope is defined by `eslint.config.mjs` global ignores.

The primary rule baseline lives in `lint.config.ts` and is connected through the root `vite.config.ts` `lint` block. Oxlint-native rules are preferred, and compatible ESLint rules can run through Oxlint's `jsPlugins` support. The rules are explicit snapshots of the ESLint configurations that were active at migration time. Do not import an upstream preset wholesale: enable a new rule intentionally and review its existing violations first.

The non-code baseline and its repository-wide file scope live in `eslint.config.mjs`. ESLint checks JSON, JSONC, JSON5, YAML, TOML, and Markdown only. The configuration globally ignores JavaScript, JSX, TypeScript, TSX, and declaration files; a comment-only inventory records the removed code checks as a migration tradeoff. It does not import or depend on the Antfu ESLint config.

### Auto-fix Workflow

Configure the Oxc and ESLint editor extensions to apply their respective fixes on save. The commit hook runs `vp staged`, which delegates staged files to `vp check --fix` and adds the ESLint fallback for non-code files. The autofix workflow uses the same combined Vite+ check.

Always review automatic fixes before committing. JS plugins are allowed to provide fixes, and their behavior is not necessarily identical to a native Oxlint rule.

### Type-aware Linting

The root configuration enables both `typeAware` and `typeCheck`, so `vp check` runs type-aware rules and full TypeScript diagnostics through the TypeScript Go toolchain.

The web package still runs its existing TSSLint rule separately:

```sh
pnpm --dir web lint:tss
```

Run the complete static check before committing or pushing:

```sh
pnpm check
```

### Bulk Suppressions

Existing error diagnostics are tracked in two root files:

- `oxlint-suppressions.json` stores the Oxlint baseline.
- `eslint-suppressions.json` stores the non-code ESLint baseline; declaration-file entries were removed when ESLint stopped processing code.

Each linter reports newly added errors beyond its recorded per-file rule baseline. Warnings remain visible and do not fail the normal lint command.

The bulk-suppression flags are available in the bundled Oxlint version but are currently hidden from `vp lint --help`. Run them from the repository root so every package uses the same baseline:

```sh
pnpm lint:oxlint --suppress-all
pnpm lint:oxlint --prune-suppressions
pnpm lint:eslint --suppress-all
pnpm lint:eslint --prune-suppressions
```

The Oxc editor extension does not yet apply the bulk-suppression baseline, so the editor may still display findings that the CLI suppresses.

### Known Migration Gaps

ESLint is intentionally limited to non-code files. The remaining limitations and accepted migration tradeoffs are:

| Area                     | Current status                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code-only fallback rules | ESLint globally ignores all code files. Six core fallback rules, JS `dot-notation`, and other code-only ESLint checks are listed only in comments rather than executable configuration.                          |
| Declaration files        | Oxlint excludes declaration files and ESLint no longer processes code. The former 223-rule declaration snapshot and CLI declaration import restriction are not enforced.                                         |
| Generated contracts      | Both linters and Vite+ type checking ignore `packages/contracts/**`; Oxfmt remains the only staged quality step for the contracts package.                                                                       |
| Non-JavaScript formats   | Oxlint plugins cannot provide custom parsers or file languages. ESLint covers JSON, JSONC, YAML, TOML, and Markdown semantic rules, while Oxfmt remains responsible for their formatting.                        |
| Markdown code blocks     | ESLint validates the Markdown document, but fenced JavaScript and TypeScript blocks are not passed through the former overlapping preset. This remains deferred rather than duplicating the Oxlint rule set.     |
| Override-scoped settings | The three Dify UI Tailwind rules are disabled with the rest of ESLint's code path. Oxlint still applies the web `react-x.additionalStateHooks` setting globally because it cannot scope settings to an override. |
| Oxlint disable severity  | Oxlint only accepts `reportUnusedDisableDirectives` at the root, where it remains `warn`; the former Dify UI-specific ESLint `error` severity is no longer applied to code files.                                |

Suppression comments belong to exactly one linter. Use `oxlint-disable` for code rules from `lint.config.ts`, and use `eslint-disable` only for non-code rules from `eslint.config.mjs`. Oxlint deliberately sets `respectEslintDisableDirectives` to `false`, so an ESLint comment cannot hide an Oxlint finding.

### Introducing New Plugins or Rules

Prefer a native Oxlint rule. If none exists, verify that the rule works through an Oxlint JS plugin on representative files. Record unsupported code rules as migration gaps instead of adding them to ESLint; reserve the ESLint configuration for non-code languages that Oxlint cannot parse. Do not add the Antfu ESLint config as a dependency or enable rules already covered by Oxlint.

For overlay import policy and composition rules, see [Overlay Guide].

## Type Checking

You should be able to see suggestions from TypeScript in your editor for all open files.

Type checking is part of the repository check:

```sh
pnpm check
```

Type checking is powered by [`tsgo`] (the native TypeScript 7 compiler), which is significantly faster than `tsc`.

[Overlay Guide]: ./overlay.md
[`tsgo`]: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta
