import type { Snippet, SnippetDSLImportResponse, SnippetListItem } from '@/types/snippet'

export const createSnippetListItemFixture = (
  overrides: Partial<SnippetListItem> = {},
): SnippetListItem => ({
  id: 'snippet-1',
  name: 'Tone Rewriter',
  description: 'Rewrites rough drafts.',
  type: 'node',
  is_published: true,
  version: 1,
  use_count: 19,
  tags: [],
  created_at: 1704067200,
  created_by: 'creator-id',
  updated_at: 1704153600,
  updated_by: 'updater-id',
  ...overrides,
})

export const createSnippetFixture = (overrides: Partial<Snippet> = {}): Snippet => ({
  ...createSnippetListItemFixture(),
  graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  input_fields: [],
  created_by: null,
  updated_by: null,
  ...overrides,
})

export const createSnippetImportResponseFixture = (
  overrides: Partial<SnippetDSLImportResponse> = {},
): SnippetDSLImportResponse => ({
  id: 'import-1',
  status: 'completed',
  snippet_id: 'snippet-1',
  current_dsl_version: '1.0.0',
  imported_dsl_version: '1.0.0',
  error: '',
  ...overrides,
})
