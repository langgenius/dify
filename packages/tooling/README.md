# Repository Tooling

Vite+ provides the primary static check through `vp check`, which combines Oxfmt formatting, Oxlint code-quality rules, and TypeScript diagnostics. The root command also runs ESLint for non-code file types that Oxlint cannot parse.

`@dify/tooling` is the private workspace package that owns JS/TS linting, formatting,
custom rules, and dead-code tooling. Edit the implementations here:

- `repository.config.ts`: repository Vite+ lint, format, staged checks, and cached check task.
- `lint.config.ts`, `eslint.ts`, and `tsslint.config.ts`: rule configurations.
- `plugins/`: custom rules, their fixtures, and tests.
- `knip.config.ts`, `a11y.config.ts`, `oxlint.unused.config.json`, and `scripts/`: targeted checks.
- `package.json`: plugin dependencies and the tooling package's test and type-check scripts.

The root `vite.config.ts`, `eslint.config.mjs`, `knip.config.ts`, and
`web/tsslint.config.ts` are discovery entry points. Globs and suppression paths
remain relative to the repository or Web project as before. The Oxlint suppression
baseline stays at the root for automatic discovery by both `vp check` and `vp lint`.
ESLint and Knip remain root dev dependencies; the TSSLint CLI remains a Web dev dependency.
Their existing scripts call the dependency CLIs directly. Tooling declares ESLint and Knip
as peers for its configuration and rule tests. Vite+ remains a direct dependency of
packages that use its build, dev, or test commands.
Python rule configurations and dependencies remain with their existing projects;
the shared staged configuration continues to invoke their existing commands.

Run the tooling tests with `vp run @dify/tooling#test run`. CI runs them in TS Common.
The tests use Node and do not load Web's application mocks.

## Check

Run the complete repository check from the root before committing or pushing:

```sh
vp run -w check
```

Apply safe fixes before running the same checks:

```sh
vp run -w check:fix
```

CI and local development use the same root `vite.config.ts` configuration.

The root `check` script delegates to the `check:cached` Vite Task. Formatting, linting,
and type checking reuse successful results when their tracked inputs are unchanged.
`CI`, `NODE_ENV`, and `TAILWIND_CANONICAL_CLASSES` are included in the cache key;
check results never restore files into the working tree. Fix commands remain uncached.
To force a fresh check, run `vp run -w --no-cache check`.

The TS Common CI job restores the task cache after dependency installation and saves
it after a successful check. This is separate from the package-manager cache in
`setup-web`. When evaluating CI performance, compare cache transfer time with the
time saved in the Vite Task summary.

Reuse successful checks for the same final changes. Repeat or expand checks only when subsequent edits, failures, or unresolved concerns require it.

To narrow formatting and linting, pass paths directly to Vite+. Type checking remains repository-wide:

```sh
vp check web/app/components packages/dify-ui/src/button
vp check --fix web/app/components packages/dify-ui/src/button
```

Run only the Web JSX accessibility rules for selected files or directories with
`lint:a11y`. Quote paths that contain shell metacharacters such as parentheses:

```sh
vp run dify-web#lint:a11y 'app/(commonLayout)/app/(appDetailLayout)/layout.tsx'
```

Use dependency mode to resolve an entry file's transitive local imports, including path aliases,
re-exports, and dynamic imports, and then lint the resulting JSX and TSX files:

```sh
vp run dify-web#lint:a11y --deps 'app/(commonLayout)/app/(appDetailLayout)/layout.tsx'
```

This is a local page-scoped diagnostic. The repository-wide accessibility rule baseline remains
owned by `packages/tooling/lint.config.ts` and is also enforced by the normal `vp check` path.

Run the ESLint fallback separately when targeting JSON, JSONC, JSON5, YAML, or Markdown:

```sh
vp run -w lint:eslint package.json pnpm-workspace.yaml web/docs
vp run -w lint:eslint:fix package.json pnpm-workspace.yaml web/docs
```

Oxlint and Vite+ type-check scope is defined by `packages/tooling/lint.config.ts` `ignorePatterns`, and ESLint's scope is defined by `packages/tooling/eslint.ts` global ignores.

The primary rule baseline lives in `packages/tooling/lint.config.ts` and is connected through the root `vite.config.ts` `lint` block. Oxlint-native rules are preferred, and compatible ESLint rules can run through Oxlint's `jsPlugins` support. The rules are explicit snapshots of the ESLint configurations that were active at migration time. Do not import an upstream preset wholesale: enable a new rule intentionally and review its existing violations first.

The Tailwind plugin always loads. `better-tailwindcss/enforce-logical-properties` enforces
logical inline-direction classes in Web and Dify UI; block-axis, sizing, explicit direction,
physical swipe, and centering exceptions remain physical. Dify UI is migrated without a baseline;
existing Web findings use the per-file bulk suppressions described below.

Migrate with scoped `vp lint --fix <paths>` and `vp fmt <paths>`. Autofix also rewrites suppressed
classes, so review caller overrides and the suppression diff. CSS modules, inline styles, and
dynamic classes need separate review.

Canonical-class cleanup remains optional: `vp run -w lint:tailwind` and
`vp run -w lint:tailwind:fix` additionally enable `better-tailwindcss/enforce-canonical-classes`
at warning level, using `web/app/styles/globals.css` and a 16px root font size.

The non-code baseline and its repository-wide file scope live in `packages/tooling/eslint.ts`. ESLint checks JSON, JSONC, JSON5, YAML, and Markdown only. The configuration globally ignores JavaScript, JSX, TypeScript, TSX, and declaration files; a comment-only inventory records the removed code checks as a migration tradeoff. It does not import or depend on the Antfu ESLint config.

### Type-aware Linting

The root configuration enables both `typeAware` and `typeCheck`, so `vp check` runs type-aware rules and full diagnostics through the repository's `@typescript/native` compiler.

The shared `packages/tsconfig/base.json` enforces erasable TypeScript syntax through
`erasableSyntaxOnly`. Root tooling and TypeScript packages inherit this contract; enum
declarations, runtime namespaces, parameter properties, and import assignments are checked
by the compiler without a separate lint plugin.

The web package still runs its existing TSSLint rule separately:

```sh
vp run dify-web#lint:tss
```

### Bulk Suppressions

Existing Oxlint error diagnostics are tracked in the root `oxlint-suppressions.json` baseline. Oxlint reports newly added errors beyond that per-file rule baseline. ESLint has no bulk-suppression baseline. Warnings remain visible and do not fail the normal lint command.

The bulk-suppression flags are available in the bundled Oxlint version but are currently hidden from `vp lint --help`. Run them from the repository root so every package uses the same baseline:

```sh
vp run -w lint:oxlint --suppress-all
vp run -w lint:oxlint --prune-suppressions
```

The Oxc editor extension does not yet apply the bulk-suppression baseline, so the editor may still display findings that the CLI suppresses.

### Known Migration Gaps

ESLint is intentionally limited to non-code files. The remaining limitations and accepted migration tradeoffs are:

| Area                     | Current status                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code-only fallback rules | ESLint globally ignores all code files. Six core fallback rules, JS `dot-notation`, and other code-only ESLint checks are listed only in comments rather than executable configuration.                          |
| Declaration files        | Oxlint excludes declaration files and ESLint no longer processes code. The former 223-rule declaration snapshot and CLI declaration import restriction are not enforced.                                         |
| Generated contracts      | Both linters and Vite+ type checking ignore `packages/contracts/**`; Oxfmt remains the only staged quality step for the contracts package.                                                                       |
| Non-JavaScript formats   | Oxlint plugins cannot provide custom parsers or file languages. ESLint covers JSON, JSONC, YAML, and Markdown semantic rules, while Oxfmt remains responsible for their formatting.                              |
| Markdown code blocks     | ESLint validates the Markdown document, but fenced JavaScript and TypeScript blocks are not passed through the former overlapping preset. This remains deferred rather than duplicating the Oxlint rule set.     |
| Override-scoped settings | The three Dify UI Tailwind rules are disabled with the rest of ESLint's code path. Oxlint still applies the web `react-x.additionalStateHooks` setting globally because it cannot scope settings to an override. |

Suppression comments belong to exactly one linter. Use `oxlint-disable` for code rules from `packages/tooling/lint.config.ts`, and use `eslint-disable` only for non-code rules from `packages/tooling/eslint.ts`. Oxlint deliberately sets `respectEslintDisableDirectives` to `false`, so an ESLint comment cannot hide an Oxlint finding.

### Inline Disable Comments

Prefer fixing the finding. When an exception is necessary, name the specific rule and use `oxlint-disable-next-line` at the affected statement. For a shared exception spanning several statements, use a bounded disable/enable pair. File-wide disable comments are forbidden, including in tests. `dify/no-file-wide-disable` reports an error when a block disable has any rules left disabled at the end of the file; a matching enable must restore every disabled rule. The native `unicorn/no-abusive-eslint-disable` rule also rejects disables without rule names, which would otherwise suppress the custom check itself.

For existing violations that cannot be fixed in the current change, remove the file-wide comment and record a scoped bulk-suppression baseline instead of turning the rule off for the file:

```sh
vp run -w lint:oxlint path/to/file.spec.tsx --suppress-all
```

Review the `oxlint-suppressions.json` diff and retain only the intended file/rule counts. The rule remains active and findings beyond the recorded count are reported; this is a count baseline, not a list of specific suppressed lines. Avoid repository-wide `--suppress-all` for a scoped cleanup. After fixing violations, use `--prune-suppressions` as described above.

Use `packages/tooling/lint.config.ts` overrides only when a rule is intentionally inapplicable to a file, and `ignorePatterns` only when the entire file must be excluded, such as generated output. Explain the reason next to the configuration. Do not migrate existing violations to a blanket rule-off override or broaden exceptions to future files with a directory glob.

Explain the concrete reason after `--`: which external contract, lifecycle, or rule limitation makes the exception necessary. A description that merely repeats the rule or says "fix lint" is insufficient. New or modified disables must include this explanation; existing test typing exceptions can be addressed incrementally.

`dify/require-disable-directive-description` uses Oxlint's parsed directives to report missing explanations, including JSX comments. It runs at `error`; existing undescribed exceptions are tracked in the bulk-suppression baseline for incremental cleanup. Enable comments do not need a repeated explanation. This rule does not assess whether a reason is valid and does not replace review. Do not add generic descriptions just to silence it.

`reportUnusedDisableDirectives` runs at `error` repository-wide. Remove an exception when the finding no longer exists. Keep both checks active: a described disable may still be unused, and a used disable may still lack a reason.

### Handwritten HTTP Calls

Web uses native Oxlint rules to discourage deprecated APIs and new handwritten requests:

- `typescript/no-deprecated` rejects references to deprecated APIs. Legacy base/fetch
  transport entry points carry `@deprecated`; generated `consoleClient`, `consoleQuery`,
  and marketplace clients remain allowed, including direct calls from UI components.
- `no-restricted-globals` and `no-restricted-properties` reject direct global
  `fetch` / `XMLHttpRequest` references, including `window`, `globalThis`, `global`,
  and `self` property access.
- `no-restricted-imports` rejects new value imports from common HTTP packages
  (including Ky, Axios, Undici and Node http/https). Type-only imports remain allowed.
  Existing legacy-service and localStorage import/access restrictions remain active.

`typescript/no-deprecated` applies throughout Web, including tests, mocks, stories,
test infrastructure, and maintenance scripts. The raw transport and HTTP-client import
restrictions apply only to production code. Repository-wide generated/vendor and
declaration-file ignores still apply. There is no custom API rule or data-flow tracker.

Existing findings are recorded in `oxlint-suppressions.json`. These are counts of
references/imports, not endpoints awaiting migration: they include transport internals,
assets, special transports, and unrelated deprecated APIs reported by `no-deprecated`.
Prune counts when removing existing findings; do not raise them for new work.
For a necessary new special transport, use a scoped `oxlint-disable-next-line`
for the applicable native rule with a concrete contract reason.

The simpler native checks intentionally accept gaps: for a deprecated arrow-function
helper, current Oxlint reports `const saved = get` at assignment but does not propagate
deprecation to later `saved()` calls. Adding calls through an existing alias,
HTTP-client import, or XHR instance may therefore pass its existing baseline.
Dynamic property access and indirect loading also require review. A per-file count
cannot detect replacing one old use with another at the same count. Do not treat
passing lint as proof that all requests use generated contracts. This rule set
does not enforce Query ownership.

### Translation Function Types

`dify/require-i18n-namespace` requires translation hook calls to use non-empty
inline namespace arrays, including single namespaces: `useTranslation(['common'])`.
Strings and indirect arguments are rejected; only calls reading the `i18n`
instance alone may omit namespaces. Both `react-i18next` and `#i18n` are checked.
The shared client/server adapter accepts typed non-empty tuples and forwards them
through one documented lint exception in its client implementation.

`dify/require-t-function-namespace` requires i18next `TFunction` types to declare a
non-empty inline tuple of namespace string literals. Use `TFunction<['common']>`
or `TFunction<['common', 'workflow']>`; readonly tuples are also supported.
Omitted arguments, single strings, broad namespace types, tuple aliases, and
unions or rest elements inside the tuple are rejected. Named import aliases,
namespace imports, and inline `import('i18next').TFunction` types are checked.

Declare the namespaces the helper or component actually uses. TypeScript checks
translation keys and compatibility with callers; the lint rule does not infer
transitive dependencies or detect unused namespaces. Keep the first namespace
compatible with the caller because it defines the default translation namespace.
The rule has no automatic fix because choosing the dependencies requires reading
the translation calls.

### Introducing New Plugins or Rules

Prefer a native Oxlint rule. If none exists, verify that the rule works through an Oxlint JS plugin on representative files. Record unsupported code rules as migration gaps instead of adding them to ESLint; reserve the ESLint configuration for non-code languages that Oxlint cannot parse. Do not add the Antfu ESLint config as a dependency or enable rules already covered by Oxlint.
