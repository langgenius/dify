# Prototype Product Alignment Plan

Date: 2026-06-24

## Summary

Reviewed the `/datasets` product prototype and updated the master iteration plan so
KnowledgeFS implementation priority matches the intended dataset workspace.

The existing backend-oriented plan already covered many foundational capabilities:
KnowledgeFS, SourceFS, EvidenceFS, PageIndex-style outlines, multimodal manifests,
retrieval modes, MCP tools, and evaluation. The gap was prioritization and product
surface coverage. The prototype expects a coherent dataset workspace before deeper
quality-only iteration.

## Plan Changes

- Added the prototype as an explicit source input for the master iteration plan.
- Added `Prototype product parity` to the current-state matrix.
- Moved prototype product surface parity ahead of PageIndex and multimodal quality
  hardening in the execution order.
- Added milestone `M0.5: Prototype Product Surface Alignment`.
- Captured required surfaces:
  - dataset list and create flows;
  - dataset detail shell and navigation;
  - overview readiness;
  - sources provider workflow;
  - documents workspace;
  - evidence test workspace;
  - quality workspace;
  - settings/API workspace;
  - agent access workspace;
  - knowledge pipeline mode;
  - prototype conformance matrix.
- Updated the immediate next slice recommendation to start with dataset list/create
  flows and then proceed through prototype parity before returning to outline and
  multimodal quality hardening.

## Files

- `.harness/docs/consolidated-iteration-plan.md`
- `.harness/changes/2026-06-24-prototype-product-alignment-plan.md`

## Verification

- Markdown and diff checks should confirm this is a documentation-only update.
