# Align the Dify Agent KnowledgeFS type-check gate

## Why

The KnowledgeFS workflow installed the locked Dify Agent development dependencies and then invoked
`basedpyright`. Dify Agent has migrated its development type checker to Pyrefly, so neither
`pyproject.toml` nor `uv.lock` provides a `basedpyright` executable and the CI step failed before it
could type-check the integration files.

## What changed

- Replaced the stale focused `basedpyright` invocation with the locked `pyrefly check` command used
  by the Dify Agent project.
- Updated the workflow regression test to require the Pyrefly command, preserving the same two
  focused KnowledgeFS integration targets.

## Verification

- The exact focused Pyrefly command passed for the Dify Agent client and its test.
- `uv lock --project dify-agent --check` passed.
- `pnpm ci:workflow:test`: 27 tests passed.
- Focused Biome and `git diff --check` passed.

## Risks and follow-up

- This changes only the CI type-check executable; production behavior and dependencies are
  unchanged.
