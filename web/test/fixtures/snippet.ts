import type {
  SnippetImportResponse,
  SnippetListItemResponse,
  SnippetResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { TEST_SNIPPET_ID } from '@/test/console/ids'

export const createSnippetListItemFixture = (
  overrides: Partial<SnippetListItemResponse> = {},
): SnippetListItemResponse => ({
  id: TEST_SNIPPET_ID,
  name: 'Tone Rewriter',
  description: 'Rewrites rough drafts.',
  type: 'node',
  is_published: true,
  version: 1,
  use_count: 19,
  icon_info: null,
  tags: [],
  author_name: null,
  created_at: 1704067200,
  created_by: 'creator-id',
  updated_at: 1704153600,
  updated_by: 'updater-id',
  ...overrides,
})

export const createSnippetFixture = (overrides: Partial<SnippetResponse> = {}): SnippetResponse => {
  const { author_name: _, ...listItem } = createSnippetListItemFixture()
  return {
    ...listItem,
    graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    input_fields: [],
    created_by: null,
    updated_by: null,
    ...overrides,
  }
}

export const createSnippetImportResponseFixture = (
  overrides: Partial<SnippetImportResponse> = {},
): SnippetImportResponse => ({
  id: 'import-1',
  status: 'completed',
  snippet_id: TEST_SNIPPET_ID,
  current_dsl_version: '1.0.0',
  imported_dsl_version: '1.0.0',
  error: '',
  warnings: [],
  ...overrides,
})
