import type { ReactNode } from 'react'
import type { Snippet, SnippetListResponse } from '@/types/snippet'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { consoleQuery } from '@/service/client'
import {
  buildSnippetDetailPayload,
  useConfirmSnippetImportMutation,
  useCreateSnippetMutation,
  useDeleteSnippetMutation,
  useExportSnippetMutation,
  useImportSnippetDSLMutation,
  useIncrementSnippetUseCountMutation,
  useInfiniteSnippetList,
  useSnippetApiDetail,
  useUpdateSnippetMutation,
} from '../use-snippets'

const {
  mutationKey,
  mockConfirmImport,
  mockCreateSnippet,
  mockDeleteSnippet,
  mockExportSnippet,
  mockGetSnippet,
  mockImportSnippet,
  mockIncrementUseCount,
  mockListSnippets,
  mockUpdateSnippet,
  queryKey,
  queryOptions,
} = vi.hoisted(() => {
  const mutationKey = (key: string) => ({
    mutationKey: () => [key],
  })
  const queryKey = (key: string) => ({
    key: () => [key],
  })
  const queryOptions = (key: string, queryFn: (input: unknown) => Promise<unknown>) => ({
    key: () => [key],
    queryOptions: vi.fn((options: { input: unknown, enabled?: boolean }) => ({
      enabled: options.enabled,
      queryKey: [key, options.input],
      queryFn: () => queryFn(options.input),
    })),
  })

  return {
    mutationKey,
    mockConfirmImport: vi.fn(),
    mockCreateSnippet: vi.fn(),
    mockDeleteSnippet: vi.fn(),
    mockExportSnippet: vi.fn(),
    mockGetSnippet: vi.fn(),
    mockImportSnippet: vi.fn(),
    mockIncrementUseCount: vi.fn(),
    mockListSnippets: vi.fn(),
    mockUpdateSnippet: vi.fn(),
    queryKey,
    queryOptions,
  }
})

vi.mock('@/service/client', () => {
  const customizedSnippets = {
    ...queryKey('customized-snippets'),
    bySnippetId: {
      get: queryOptions('customized-snippets.detail', mockGetSnippet),
      patch: mutationKey('customized-snippets.patch'),
      delete: mutationKey('customized-snippets.delete'),
      export: {
        get: mutationKey('customized-snippets.export'),
      },
      useCount: {
        increment: {
          post: mutationKey('customized-snippets.use-count.increment'),
        },
      },
    },
    imports: {
      post: mutationKey('customized-snippets.imports.post'),
      byImportId: {
        confirm: {
          post: mutationKey('customized-snippets.imports.confirm.post'),
        },
      },
    },
    post: mutationKey('customized-snippets.post'),
  }

  return {
    consoleClient: {
      workspaces: {
        current: {
          customizedSnippets: {
            bySnippetId: {
              delete: mockDeleteSnippet,
              export: {
                get: mockExportSnippet,
              },
              patch: mockUpdateSnippet,
              useCount: {
                increment: {
                  post: mockIncrementUseCount,
                },
              },
            },
            get: mockListSnippets,
            imports: {
              byImportId: {
                confirm: {
                  post: mockConfirmImport,
                },
              },
              post: mockImportSnippet,
            },
            post: mockCreateSnippet,
          },
        },
      },
    },
    consoleQuery: {
      snippets: {
        key: () => ['snippets'],
      },
      workspaces: {
        current: {
          customizedSnippets,
        },
      },
    },
  }
})

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    mutations: { retry: false },
    queries: { retry: false },
  },
})

const createWrapper = (queryClient = createQueryClient()) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const createSnippet = (overrides: Partial<Snippet> = {}): Snippet => ({
  created_at: 1_704_067_200,
  created_by: {
    email: 'creator@example.com',
    id: 'creator-1',
    name: 'Creator',
  },
  description: 'Description',
  graph: {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  icon_info: null,
  id: 'snippet-1',
  input_fields: [],
  is_published: false,
  name: 'Snippet',
  tags: [],
  type: 'node',
  updated_at: 1_704_153_600,
  updated_by: null,
  use_count: 0,
  version: 1,
  ...overrides,
})

const createSnippetListResponse = (overrides: Partial<SnippetListResponse> = {}): SnippetListResponse => ({
  data: [
    {
      author_name: 'Creator',
      created_at: 1_704_067_200,
      created_by: 'creator-1',
      description: 'Description',
      icon_info: null,
      id: 'snippet-1',
      is_published: true,
      name: 'Snippet',
      tags: [],
      type: 'node',
      updated_at: 1_704_153_600,
      updated_by: null,
      use_count: 2,
      version: 1,
    },
  ],
  has_more: false,
  limit: 30,
  page: 1,
  total: 1,
  ...overrides,
})

describe('use-snippets service hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfirmImport.mockResolvedValue({
      current_dsl_version: '0.1.0',
      error: '',
      id: 'import-1',
      imported_dsl_version: '0.1.0',
      snippet_id: 'snippet-1',
      status: 'completed',
    })
    mockCreateSnippet.mockResolvedValue(createSnippet())
    mockDeleteSnippet.mockResolvedValue({})
    mockExportSnippet.mockResolvedValue('kind: snippet')
    mockGetSnippet.mockResolvedValue(createSnippet())
    mockImportSnippet.mockResolvedValue({
      current_dsl_version: '0.1.0',
      error: '',
      id: 'import-1',
      imported_dsl_version: '0.1.0',
      snippet_id: null,
      status: 'pending',
    })
    mockIncrementUseCount.mockResolvedValue({ result: 'success', use_count: 3 })
    mockListSnippets.mockResolvedValue(createSnippetListResponse())
    mockUpdateSnippet.mockResolvedValue(createSnippet({ name: 'Renamed' }))
  })

  describe('buildSnippetDetailPayload', () => {
    it('should build the UI detail payload with safe graph defaults', () => {
      const payload = buildSnippetDetailPayload(
        createSnippet({
          graph: {},
          input_fields: [{ variable: 'name' }],
        }),
        {
          created_at: 1_704_067_200,
          features: {},
          graph: {
            nodes: [{ id: 'node-1' }],
            edges: [],
            viewport: { x: 10, y: 20, zoom: 1.5 },
          },
          hash: 'hash-1',
          id: 'workflow-1',
          input_fields: [{ variable: 'workflow_input' }],
          updated_at: 1_704_153_600,
        },
      )

      expect(payload).toEqual(expect.objectContaining({
        graph: {
          nodes: [{ id: 'node-1' }],
          edges: [],
          viewport: { x: 10, y: 20, zoom: 1.5 },
        },
        inputFields: [{ variable: 'workflow_input' }],
        uiMeta: expect.objectContaining({
          autoSavedAt: expect.any(String),
          inputFieldCount: 1,
        }),
      }))
    })
  })

  describe('queries', () => {
    it('should map list filters to the generated customized snippets query params', async () => {
      const { result } = renderHook(
        () => useInfiniteSnippetList({
          creator_ids: ['account-1'],
          is_published: true,
          keyword: 'sales',
          tag_ids: ['tag-1'],
        }),
        { wrapper: createWrapper() },
      )

      await waitFor(() => {
        expect(result.current.data?.pages[0]).toEqual(createSnippetListResponse())
      })
      expect(mockListSnippets).toHaveBeenCalledWith({
        query: {
          creators: ['account-1'],
          is_published: true,
          keyword: 'sales',
          limit: 30,
          page: 1,
          tag_ids: ['tag-1'],
        },
      })
    })

    it('should query snippet detail with generated snippet_id params', async () => {
      const { result } = renderHook(() => useSnippetApiDetail('snippet-1'), { wrapper: createWrapper() })

      await waitFor(() => {
        expect(result.current.data?.id).toBe('snippet-1')
      })
      expect(consoleQuery.workspaces.current.customizedSnippets.bySnippetId.get.queryOptions).toHaveBeenCalledWith({
        input: {
          params: { snippet_id: 'snippet-1' },
        },
      })
    })
  })

  describe('mutations', () => {
    it('should create snippets through the generated customized snippets client', async () => {
      const { result } = renderHook(() => useCreateSnippetMutation(), { wrapper: createWrapper() })

      await result.current.mutateAsync({
        body: {
          description: 'Description',
          name: 'Snippet',
          type: 'node',
        },
      })

      expect(mockCreateSnippet).toHaveBeenCalledWith({
        body: {
          description: 'Description',
          name: 'Snippet',
          type: 'node',
        },
      })
    })

    it('should update snippets with generated snippet_id params', async () => {
      const { result } = renderHook(() => useUpdateSnippetMutation(), { wrapper: createWrapper() })

      await result.current.mutateAsync({
        body: { name: 'Renamed' },
        params: { snippetId: 'snippet-1' },
      })

      expect(mockUpdateSnippet).toHaveBeenCalledWith({
        body: { name: 'Renamed' },
        params: { snippet_id: 'snippet-1' },
      })
    })

    it('should delete and increment snippets with generated snippet_id params', async () => {
      const { result: deleteResult } = renderHook(() => useDeleteSnippetMutation(), { wrapper: createWrapper() })
      const { result: incrementResult } = renderHook(() => useIncrementSnippetUseCountMutation(), { wrapper: createWrapper() })

      await deleteResult.current.mutateAsync({ params: { snippetId: 'snippet-1' } })
      await incrementResult.current.mutateAsync({ params: { snippetId: 'snippet-1' } })

      expect(mockDeleteSnippet).toHaveBeenCalledWith({
        params: { snippet_id: 'snippet-1' },
      })
      expect(mockIncrementUseCount).toHaveBeenCalledWith({
        params: { snippet_id: 'snippet-1' },
      })
    })

    it('should export snippets with generated include_secret query params', async () => {
      const { result } = renderHook(() => useExportSnippetMutation(), { wrapper: createWrapper() })

      await result.current.mutateAsync({ include: true, snippetId: 'snippet-1' })

      expect(mockExportSnippet).toHaveBeenCalledWith({
        params: { snippet_id: 'snippet-1' },
        query: { include_secret: 'true' },
      })
    })

    it('should import and confirm snippets through generated import endpoints', async () => {
      const { result: importResult } = renderHook(() => useImportSnippetDSLMutation(), { wrapper: createWrapper() })
      const { result: confirmResult } = renderHook(() => useConfirmSnippetImportMutation(), { wrapper: createWrapper() })

      await importResult.current.mutateAsync({
        mode: 'yaml-content',
        yamlContent: 'kind: snippet',
        yamlUrl: undefined,
      })
      await confirmResult.current.mutateAsync({ importId: 'import-1' })

      expect(mockImportSnippet).toHaveBeenCalledWith({
        body: {
          mode: 'yaml-content',
          yaml_content: 'kind: snippet',
          yaml_url: undefined,
        },
      })
      expect(mockConfirmImport).toHaveBeenCalledWith({
        params: { import_id: 'import-1' },
      })
    })
  })
})
