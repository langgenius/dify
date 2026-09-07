# Incremental structured-text admission

## Changes and rationale

- JSONL scans one line slice at a time instead of allocating a document-wide `split()` array. Its existing record bound now stops the scan before the tail is materialized; scalar/null/array records, exact numeric lexemes, blank lines and CRLF behavior are preserved.
- Native XML receives a SAX-only structure admission pass before the authoritative `fast-xml-parser` object projection. Tag depth, element/attribute/text nodes and processing instructions are bounded without building a DOM, with 64 KiB cooperative scan chunks. Existing post-projection byte/node limits remain defense in depth. No new dependency or XML semantic projection change is introduced.
- CSV already used `csv-parse`'s `on_record` callback, kept no duplicate parser result array, and stopped when `maxRows` was exceeded. A regression verifies that this limit wins before an invalid later record; no unnecessary CSV rewrite was made.

## Verification

- New helper tests were introduced before implementation. Integration verifies over-deep XML never invokes `XMLParser.parse`; line/row guards preserve values and prevent later invalid records being decoded. Comments, CDATA, namespaces, self-closing elements and chunk-boundary text are covered.
- Full parser package before the final indentation regression: 520 passed (including contemporaneous sandbox protocol tests). Coverage: 97.13% statements/lines, 91.48% branches, 97.97% functions; new SAX/line helper is 100% lines/functions and 92.3% branches.
- The final XML regression verifies indentation-only whitespace does not consume semantic nodes, matching the authoritative parser's trimming behavior. RED→GREEN confirmed; the focused structural-admission suite passed all 16 tests afterward.
- Parser typecheck and Biome formatting passed.

## Limits

Input bytes are still loaded through the existing explicit upload/parser byte caps; this change is bounded structural/record admission, not a claim of arbitrary-size file streaming. Process isolation provides external interruption of synchronous library work. SAX admission is not a substitute for the authoritative projection or the post-projection expansion limits.
