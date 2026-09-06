# Parser format contracts, encoding, provenance and coverage

## What changed

- A shared document format registry now drives native/remote routing, upload MIME aliases and source filename MIME inference. The existing 25 upload extensions are unchanged; internal YAML/NDJSON support is not added to uploads. Inherited object keys such as `constructor` and `__proto__` cannot become formats or crash admission.
- Native text decoding is strict UTF-8, or UTF-16LE/BE with a BOM. Malformed sequences, unsupported UTF-32 BOMs and unmarked binary NUL text fail with terminal `provider_input` rather than indexing replacement characters.
- Properties documents have a dedicated semantic projection: comments omitted, continued lines joined, separators and escapes decoded, Unicode surrogate pairs validated, and original source line/key/value retained. This follows Java's character-reader properties grammar; there is deliberately no heuristic legacy code-page detection.
- WebVTT produces cue text with identifier, start/end milliseconds, settings and raw cue payload; header/NOTE/STYLE/REGION blocks are not indexed as speech. Malformed cues fail explicitly instead of silently losing content.
- Native structured syntax failures, row limits and element limits retain terminal input classification. Oversized native markup no longer bypasses native admission by silently being sent to the remote service; explicit OCR/layout/language routes remain available.
- Unstructured accepts a deployment-owned `backendRevision` (bounded to 256 characters). It participates in checkpoint fingerprint, artifact hash and metadata. Client semantic versions advance to native Markdown/MDX 4, HTML 5, structured 4, Unstructured 12. An external provider without a configured revision is explicitly `external-unversioned`, not falsely attested as the pinned image.
- `requiresImages` remains tri-state in fingerprints/hashes: legacy-auto (`undefined`) and explicit text-only (`false`) cannot coalesce or reuse one another's archive-media output. A concurrent parse regression verifies distinct artifacts, not just distinct policy strings.
- Archive fallback honors `requiresImages=false`. Unsupported media (including SVG), count/byte omissions, Office chart/diagram visuals and inspection failures produce bounded `archiveMediaReport` references and `parseCoverage.media` reasons. Reports preserve up to 4,096 resource paths (1,024 characters each), explicitly reporting truncation. Unknown provider text/table/media completeness remains `unknown`; it is never guessed complete.
- Artifact-level coverage/provenance metadata is included in structural output admission, not just element arrays.

## Why

Prevent silent encoding/content corruption, format-policy drift, generic misleading compilation failures, cache reuse across provider semantic upgrades, and silent partial multimodal extraction. Keep byte/pixel/normalization protections from the first hardening phase unchanged.

## Verification

- TDD reproductions failed first for UTF-16, malformed UTF-8, properties, VTT, backend revision hashes, native overflow routing, unsupported/archive image gating, omitted charts/images, missing source MIME aliases, and prototype-key filename admission.
- `pnpm --filter @knowledge/parsers test:coverage`: 489 passed; statements/lines 97.04%, branches 91.34%, functions 97.91%.
- `pnpm --filter @knowledge/parsers typecheck`: passed.
- Correctly scoped upload/source tests: 80 passed. Initial root-directory Vitest invocation omitted the API package's Dify object-storage setup and consequently failed two source imports. The correctly scoped API command loads `packages/api/vitest.config.ts`; this was a test-invocation issue, not a compilation regression. Full API verification belongs to the integration pass.
- Biome formatting/check applied only to owned modified files; full workspace verification belongs to the integration pass.

## Scope and risks

- No live provider, production deploy, migration, commit or push was performed by this slice. Pinned-provider real-file golden execution requires an available Docker/service runtime.
- Parse coverage is a truthful report, not support for rasterizing previously unsupported SVG/EMF/WMF/Office charts. Original document bytes and archive-path provenance remain available; omitted visual content is explicitly partial.
- Existing raw checkpoints correctly invalidate on the new semantic versions. Transport/admission-only limit changes are not misrepresented as provider content revisions.
- Strict malformed text/VTT handling intentionally rejects content that previously appeared to import successfully while indexing corrupt/control text. Normal UTF-8 and existing native format content stay covered by the parser regression suite.

## Grammar references

- [Java Properties character-reader grammar](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/Properties.html#load(java.io.Reader))
- [WebVTT specification](https://www.w3.org/TR/webvtt1/)
