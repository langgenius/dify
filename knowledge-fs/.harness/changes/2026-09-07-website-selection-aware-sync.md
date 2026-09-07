# Website Selection-aware Sync

## Problem

Website Source imports froze the selected URLs only in the import workflow payload. Later scheduled
syncs ignored that selection and repeated the persisted root crawl, so provider pages outside the
user's selection could be published. Remote-missing cleanup also omitted the parent workflow ID
when requesting logical-document deletion; the resulting child deletion then fenced the parent's
next durable checkpoint.

## Changes

- Persist the selected URL list in `__knowledgeFsWebsiteSelection` only after a website import and
  staged-content cleanup succeed. A later successful website import replaces the marker, so Source
  edits become the authority for subsequent syncs; failed replacements retain the previous marker.
- Sync marked website Sources by exact single-page fetches for the latest selected URLs and ignore
  extra pages returned by a provider. Sources created before this marker use their initial preview
  selection; legacy website Sources without either selection marker retain root-crawl behavior.
- Keep website provider identity stable as the SHA-256 of the selected URL for both imports and
  later syncs, including when the provider reports a different canonical URL.
- Make Dify Source-edit comparison prefer the latest website selection marker, with initial preview
  and legacy crawl metadata as compatibility fallbacks.
- Propagate the parent workflow ID into remote-missing logical-document deletion so repository
  admission can exclude only that workflow's own child deletion while preserving all unrelated
  deletion fences.

## Verification

- Established failing behavior tests first for marker persistence, latest-selection sync, and
  remote-missing workflow ownership.
- `@knowledge/api` full suite: 426 files passed, 1 skipped; 5,053 tests passed, 3 skipped.
- Focused workflow runtime, adapter, deletion admission, database repository, and code-health suite:
  288 tests passed.
- Dify KnowledgeFS resource controller suite: 141 tests passed.
- KnowledgeFS build: 12 packages passed.
- KnowledgeFS API typecheck and targeted Biome checks passed.
- Dify targeted Ruff check and format verification passed.
- Local Dify `basedpyright` was not runnable because the executable is absent from the current API
  development environment; this is an environment dependency issue rather than a reported type
  diagnostic.
