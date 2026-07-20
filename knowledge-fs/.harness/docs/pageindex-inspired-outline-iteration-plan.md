# PageIndex-Inspired Document Outline Iteration Plan

## Objective

KnowledgeFS should compile each document into a first-class, PageIndex-inspired document outline during ingestion. The outline is the trusted structural fact layer for long-document navigation, while leaf paragraphs, tables, images, and chunks continue to feed dense embedding, full-text search, reranking, and graph search.

This keeps fast and deep retrieval hybrid, and adds reasoning tree search as a research-mode retrieval path.

## Target Behavior

During document compilation, the system builds a `DocumentOutline` for every parsed document:

- TOC-like hierarchy with stable outline node ids.
- Section titles, nesting level, and `sectionPath`.
- Start/end page and start/end offset ranges.
- Title location metadata, including matched text, page number, offsets, confidence, and source.
- TOC source metadata: parser heading, native TOC, LLM inferred, or fallback.
- Per-section summary, generated deterministically first and later via an LLM summary provider.
- Links from outline nodes to parse elements and generated `KnowledgeNode` leaf ids.
- Quality metadata for heading coverage, page-range validity, and inferred/fallback structure.

The existing parse elements and generated `KnowledgeNode`s remain the retrieval leaf layer:

- Fast mode: dense + full-text + metadata filters.
- Deep mode: larger hybrid fanout, rerank, table/image paths, and graph expansion when enabled.
- Research mode: outline/tree navigation first, then hybrid retrieval and graph expansion for evidence completion.

## Data Model

Add a first-class `DocumentOutline` model:

```text
DocumentOutline
  id
  knowledgeSpaceId
  documentAssetId
  parseArtifactId
  artifactHash
  version
  outlineVersion
  nodes[]
  metadata
  createdAt
  updatedAt?

DocumentOutlineNode
  id
  title
  level
  sectionPath[]
  startPage?
  endPage?
  startOffset?
  endOffset?
  titleLocation?
  tocSource
  summary?
  sourceElementIds[]
  sourceNodeIds[]
  childNodeIds[]
  children[]
  metadata
```

`DocumentOutline` is separate from `SummaryTree`. The outline is a stable, citeable document-structure fact. Summary trees and other projections may change with models, prompts, and projection versions.

## Compilation Pipeline

Target stage order:

```text
queued
parsed
outline_built
nodes_generated
projection_built
smoke_eval_passed
published
```

Initial iteration can build the outline from `ParseArtifact.elements` after parsing and before node generation. Later iterations should enrich it using PageIndex-style TOC extraction, page offset correction, title verification, and recursive subdivision.

## KnowledgeFS and MCP Surface

Expose outline reads through HTTP, KnowledgeFS, and MCP:

- `GET /knowledge-spaces/{id}/documents/{documentId}/outline`
- `/knowledge/docs/{document}/outline.json`
- `knowledge.get_document_outline`

- `/knowledge/docs/{document}/sections/...`

Agents should be encouraged to inspect document metadata and outline before opening section/page content for long-document or research-mode questions.

## Research Retrieval

Add `DocumentOutlineRetrievalPath` as a deterministic first iteration for `deep` and `research` modes:

- `deep`: enrich retrieved paragraph/table/image evidence with matching outline node metadata.
- `research`: also attach a lightweight `reasoningTreeSearch` trace derived from the inspected outline path.
- Dry-run planning counts the extra reasoning tree search step/tool call for `research`.

Target `OutlineTreeSearchRetrievalPath`:

```text
query
  -> load candidate document/corpus outlines
  -> reason over outline tree
  -> select outline nodes and tight page/section ranges
  -> open selected ranges
  -> run hybrid retrieval for leaf evidence completion
  -> graph expansion / rerank / verification
  -> EvidenceBundle with tree-search trace
```

Trace fields should include inspected outline nodes, selected outline nodes, reasoning, opened ranges, fallback hybrid candidates, and final evidence ids.

## Iteration Slices

1. Add `DocumentOutline` schemas, in-memory repository, and deterministic outline builder from `ParseArtifact`. Done.
2. Persist outline during compilation and expose document outline read API. Done.
3. Materialize outline and section-range paths into KnowledgeFS. Done.
4. Add PageIndex-style quality checks: TOC page detection, page offset correction, title-on-page verification, and large-section recursive subdivision. Partially done with deterministic quality metadata for fallback coverage, page/offset range validity, title-location coverage, and large-section candidates.
5. Add LLM summary provider and structured summary prompt versions. Done as an optional `DocumentOutlineSummaryEnhancer` with provider/model/promptVersion metadata and deterministic fallback when no provider is configured.
6. Add research-mode outline tree search path and trace recording. Done with deterministic outline-guided range selection for research mode: the path selects an outline node from hybrid candidates, opens that section range, retains final evidence inside the selected range, and records `reasoningTreeSearch` metadata with inspected node ids, selected node, opened ranges, fallback hybrid candidate ids, final evidence ids, and reasoning.
7. Add Admin outline browser and tree-search trace viewer. Done with an Admin document outline browser that shows outline hierarchy, section paths, page/offset ranges, title-location metadata, summaries, and quality metadata, plus a Trace Review tree-search panel that surfaces selected sections, inspected nodes, opened ranges, final evidence ids, and reasoning from research-mode trace metadata.
8. Add regression evals for long-document section localization, citation page hit rate, and research-mode answer faithfulness. Partially done with `evaluateDocumentOutlineLocalization` for section and page hit-rate reporting.

## Acceptance Criteria

- Every parsed document can return a deterministic outline, even when the parser only provides weak section paths.
- Outline nodes map back to parse element ids and page/offset ranges.
- Fast/deep retrieval still indexes raw leaf nodes through dense, full-text, and graph paths.
- Research mode can choose outline nodes before opening content.
- Answer traces explain when tree search selected a section and why.
