# Admin Console README Guide

## Summary

- Added an `Admin Console Guide` section to `README.md`.
- Documented each sidebar surface: System health, Control plane, FSCK, GC, Upload intake, Retrieval workspace, KnowledgeFS, Documents, Entity browser, Semantic views, Document diff, Golden questions, Evaluation dashboard, Retrieval Studio, Trace comparison, Failed diagnostics, and Trace review.
- Included the recommended local workflow from health checks through upload, retrieval debugging, and evaluation capture.

## Why

The Admin console now exposes multiple operator and retrieval-quality surfaces. New users need a single README reference explaining what each panel is for and when to use it.

## Verification

- `git diff --check`

## Risks And Follow-Up

- Documentation only; no runtime behavior changed.
