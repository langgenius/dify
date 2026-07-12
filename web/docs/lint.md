# Format and Lint Guide

We use Vite+ Oxfmt for formatting, ESLint for code-quality rules, and TypeScript for type safety.

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

## ESLint

### Common Flags

**File/folder targeting**: Append paths to lint specific files or directories.

```sh
pnpm eslint [options] file.js [file.js] [dir]
```

**`--cache`**: Caches lint results for faster subsequent runs.
Keep this enabled by default; only disable when you encounter unexpected lint results.

**`--concurrency`**: Enables multi-threaded linting.
Use `--concurrency=auto` or experiment with specific numbers to find the optimal setting for your machine.
Keep this enabled when linting multiple files.

- [ESLint multi-thread linting blog post]

**`--fix`**: Automatically fixes code-quality violations such as unused imports and preferred syntax.
Run `vp fmt` after ESLint fixes so Oxfmt produces the final layout.
Always review the diff before committing to ensure no unintended changes.

**`--quiet`**: Suppresses warnings and only shows errors.
Useful when you want to reduce noise from existing warnings.

**`--suppress-all`**: Temporarily suppresses error-level violations and records them, allowing CI to pass.
Treat this as an escape hatch—fix these errors when time permits.

**`--prune-suppressions`**: Removes outdated suppressions after you've fixed the underlying errors.

- [ESLint bulk suppressions blog post]

### The Auto-Fix Workflow and Suppression Strategy

To streamline your development process, we recommend configuring your editor to automatically fix lint errors on save.
Use Oxfmt for format-on-save and ESLint code actions for lint-only fixes.
As a fallback, the commit hook runs `vp staged`, which applies ESLint fixes and then formats staged files with `vp fmt`.
To prevent workflow disruptions, these commit hooks are intentionally bypassed when you are merging branches, rebasing, or cherry-picking.

Additionally, we currently track many existing legacy errors in eslint-suppressions.json.
You do not need to spend time manually pruning these suppressions (we already append `--pass-on-unpruned-suppressions` in the commit hook);
once you open a Pull Request, the CI pipeline will automatically handle the cleanup for you.

### Type-Aware Linting

Some ESLint rules require type information, such as [no-leaked-conditional-rendering].
However, [typed linting via typescript-eslint] is too slow for practical use.
So we use [TSSLint] instead.

```sh
pnpm lint:tss
```

This command lints the entire project and is intended for final verification before committing or pushing changes.

### Introducing New Plugins or Rules

If a new rule causes many existing code errors or automatic fixes generate too many diffs, do not use the `--fix` option for automatic fixes.
You can introduce the rule first, then use the `--suppress-all` option to temporarily suppress these errors, and gradually fix them in subsequent changes.

For overlay import policy and composition rules, see [Overlay Guide].

## Type Check

You should be able to see suggestions from TypeScript in your editor for all open files.

However, it can be useful to run the TypeScript 7 command-line (tsgo) to type check all files:

```sh
pnpm type-check
```

Type checking is powered by [`tsgo`] (the native TypeScript 7 compiler), which is significantly faster than `tsc`.

[ESLint bulk suppressions blog post]: https://eslint.org/blog/2025/04/introducing-bulk-suppressions
[ESLint multi-thread linting blog post]: https://eslint.org/blog/2025/08/multithread-linting
[Overlay Guide]: ./overlay.md
[TSSLint]: https://github.com/johnsoncodehk/tsslint
[`tsgo`]: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta
[no-leaked-conditional-rendering]: https://www.eslint-react.xyz/docs/rules/no-leaked-conditional-rendering
[typed linting via typescript-eslint]: https://typescript-eslint.io/getting-started/typed-linting
