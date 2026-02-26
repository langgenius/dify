# Lint Guide

We use ESLint and Typescript to maintain code quality and consistency across the project.

## ESLint

### Common Flags

**File/folder targeting**: Append paths to lint specific files or directories.

```sh
pnpm eslint [options] file.js [file.js] [dir]
```

**`--cache`**: Caches lint results for faster subsequent runs. Keep this enabled by default; only disable when you encounter unexpected lint results.

**`--concurrency`**: Enables multi-threaded linting. Use `--concurrency=auto` or experiment with specific numbers to find the optimal setting for your machine. Keep this enabled when linting multiple files.

- [ESLint multi-thread linting blog post](https://eslint.org/blog/2025/08/multithread-linting/)

**`--fix`**: Automatically fixes auto-fixable rule violations. Always review the diff before committing to ensure no unintended changes.

**`--quiet`**: Suppresses warnings and only shows errors. Useful when you want to reduce noise from existing issues.

**`--suppress-all`**: Temporarily suppresses error-level violations and records them, allowing CI to pass. Treat this as an escape hatch—fix these errors when time permits.

**`--prune-suppressions`**: Removes outdated suppressions after you've fixed the underlying errors.

- [ESLint bulk suppressions blog post](https://eslint.org/blog/2025/04/introducing-bulk-suppressions/)

### Type-Aware Linting

Some ESLint rules require type information, such as [no-leaked-conditional-rendering](https://www.eslint-react.xyz/docs/rules/no-leaked-conditional-rendering). However, [typed linting via typescript-eslint](https://typescript-eslint.io/getting-started/typed-linting) is too slow for practical use, so we use [TSSLint](https://github.com/johnsoncodehk/tsslint) instead.

```sh
pnpm lint:tss
```

This command lints the entire project and is intended for final verification before committing or pushing changes.

### Introducing New Plugins or Rules

If a new rule causes many existing code errors or automatic fixes generate too many diffs, do not use the `--fix` option for automatic fixes.
You can introduce the rule first, then use the `--suppress-all` option to temporarily suppress these errors, and gradually fix them in subsequent changes.

## Type Check

You should be able to see suggestions from TypeScript in your editor for all open files.

However, it can be useful to run the TypeScript 7 command-line (tsgo) to type check all files:

```sh
pnpm type-check:tsgo
```

Prefer using `tsgo` for type checking as it is significantly faster than the standard TypeScript compiler. Only fall back to `pnpm type-check` (which uses `tsc`) if you encounter unexpected results.
