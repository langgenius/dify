# Preserve native Markdown and HTML content while bounding traversal

## Problem

Markdown blockquotes and ordinary HTML blocks were omitted. A paragraph beginning
with an image lost its remaining text, while other mixed paragraphs duplicated
the image syntax and placed all images before the paragraph. HTML traversal
ignored bare container text, returned before finding images in paragraphs/lists,
and selected only the first figure image. Deep HTML could overflow recursive
traversal before a useful input error was returned.

## Changes

- Visit Markdown blockquotes in document order, sharing section context. Keep
  ordinary paragraph/list/table projections; mixed Markdown image/HTML blocks use
  an inert HTML tree to preserve surrounding text and image placement.
- Keep static HTML text for both Markdown and MDX. No JSX evaluation, script
  execution or URL fetch occurs in this parser. Exclude script/style/noscript
  subtrees from text and image discovery, including nested table/heading paths.
- Preserve bare HTML text and ordered inline runs, paragraph/list images, all
  figure images and captions, plus images associated with headings/tables.
  Tables retain the existing normalized matrix element followed by their image
  assets; this is not new cell-level image-anchor support.
- Preserve per-placement captions/titles when the same Markdown URI is repeated.
- Apply the shared maximum DOM depth (128) and node count (250,000) before
  projection; classify violations as non-retryable `ParserResourceLimitError`.
  Budget inspection, title search, image search and text collection use explicit
  stacks. Block projection runs only after that bounded-depth inspection.
- Update the existing regression that deliberately expected ordinary Markdown
  HTML content to be discarded. The parent change owns final parser version and
  fingerprint updates.

## Verification

- TDD: all initial ten regression tests failed before implementation and passed
  after it. Additional tests first exposed and then verified heading/table image
  extraction, repeated-URI placement metadata and excluded-subtree image handling.
- Fifteen new tests pass, including 5,000 nested divs and a shallow 250,001-node
  document; no network/provider was used. Fourteen selected existing markup/image
  regressions also pass. Parser package typecheck passes.
- A broader run of the existing parser file plus the first ten new tests had
  111 passes and one concurrent structured-XML expectation failure (score now
  remains a string); the parent structured-data fix owns that expectation.
- The parent task owns full package coverage/build/lint and contract-lock
  regeneration. Shared index formatting was deliberately left for the parent to
  avoid colliding with concurrent structured/provider changes. The dedicated test
  file is formatted. No commit, deployment or production mutation was performed.

## Remaining boundaries

The DOM budget is enforced after htmlparser2 constructs the DOM, before our
traversal. It prevents projection/stack blowups but does not claim a streaming,
pre-allocation DOM parser; input-byte admission still bounds the input. Marked
lexing precedes token traversal checks. A terminable CPU worker and streaming
parser-admission limits remain part of the broader resource-isolation work.
