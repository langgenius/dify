# WASM Evidence Packer

## What Changed

- Added Rust/WASM `packEvidenceJson`.
- The packer accepts an `EvidenceBundle`, token budget, optional model, and bounded config.
- Output includes packed context, included evidence items, omitted evidence items, used tokens, and the requested token budget.
- Included evidence receives stable `E1`, `E2`, ... markers and carries citations forward.
- Over-budget evidence is omitted with `reason: "token-budget"` while preserving input order for included evidence.

## Why

- Sprint 7 context-window packing needs a deterministic pure-compute primitive before TypeScript generation orchestration can enforce model budgets.
- Keeping this in Rust WASM follows the project architecture: Rust owns pure compute, while TypeScript will own provider calls and runtime wiring.

## Performance And Safety Notes

- The packer has explicit defaults for input bytes, max evidence items, and max packed context characters.
- Token counting reuses the existing deterministic tokenizer logic.
- The function does not perform network, database, filesystem, cache, job, or provider work.
- Oversized or invalid inputs fail closed instead of returning partial context.

## Verification

- `cargo test --workspace`

Full workspace verification is recorded in `TEMP-progress-document.md` after completion.

## Known Risks / Follow-Up

- This slice exposes only the Rust/WASM compute function; TypeScript runtime wiring and model-specific context window splitting remain the next Sprint 7 task.
- Token counting is still the deterministic heuristic tokenizer; model-specific tokenizers can replace or refine this boundary later.
