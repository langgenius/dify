import type { SnippetWorkflow } from '@/types/snippet'
import {
  renderHook,
  waitFor,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSnippetInit } from '../use-snippet-init'

const mockWorkflowStoreSetState = vi.fn()
const mockSetPublishedAt = vi.fn()
const mockSetDraftUpdatedAt = vi.fn()
const mockSetSyncWorkflowDraftHash = vi.fn()
const mockUseSnippetApiDetail = vi.fn()
const mockFetchSnippetDraftWorkflow = vi.fn()
const mockUseSnippetDefaultBlockConfigs = vi.fn()
const mockUseSnippetPublishedWorkflow = vi.fn()

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    setState: mockWorkflowStoreSetState,
    getState: () => ({
      setDraftUpdatedAt: mockSetDraftUpdatedAt,
      setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash,
      setPublishedAt: mockSetPublishedAt,
    }),
  }),
}))

vi.mock('@/service/use-snippets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/use-snippets')>()

  return {
    ...actual,
    useSnippetApiDetail: (snippetId: string) => mockUseSnippetApiDetail(snippetId),
  }
})

vi.mock('@/service/use-snippet-workflows', () => ({
  fetchSnippetDraftWorkflow: (snippetId: string) => mockFetchSnippetDraftWorkflow(snippetId),
  useSnippetDefaultBlockConfigs: (snippetId: string, onSuccess?: (data: unknown) => void) => mockUseSnippetDefaultBlockConfigs(snippetId, onSuccess),
  useSnippetPublishedWorkflow: (snippetId: string, onSuccess?: (data: { created_at: number }) => void) => mockUseSnippetPublishedWorkflow(snippetId, onSuccess),
}))

const createDraftWorkflow = (overrides: Partial<SnippetWorkflow> = {}): SnippetWorkflow => ({
  id: 'draft-1',
  graph: {},
  features: {},
  input_fields: [],
  hash: 'draft-hash',
  created_at: 1_712_300_000,
  updated_at: 1_712_345_678,
  ...overrides,
})

describe('useSnippetInit', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUseSnippetApiDetail.mockReturnValue({
      data: {
        id: 'snippet-1',
        name: 'Tone Rewriter',
        description: 'A static snippet mock.',
        type: 'node',
        is_published: false,
        version: '1',
        use_count: 0,
        icon_info: {
          icon_type: null,
          icon: '🪄',
          icon_background: '#E0EAFF',
        },
        input_fields: [],
        created_at: 1_712_300_000,
        updated_at: 1_712_300_000,
        author: 'Evan',
      },
      error: null,
      isLoading: false,
    })
    mockFetchSnippetDraftWorkflow.mockResolvedValue(undefined)
    mockUseSnippetDefaultBlockConfigs.mockReturnValue({
      data: undefined,
    })
    mockUseSnippetPublishedWorkflow.mockReturnValue({
      data: undefined,
    })
  })

  it('should return snippet detail query result', async () => {
    const { result } = renderHook(() => useSnippetInit('snippet-1'))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(mockUseSnippetApiDetail).toHaveBeenCalledWith('snippet-1')
    expect(mockFetchSnippetDraftWorkflow).toHaveBeenCalledWith('snippet-1')
    expect(result.current.data?.snippet.id).toBe('snippet-1')
    expect(result.current.data?.graph.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  it('should use draft input_fields for snippet inputs', async () => {
    mockUseSnippetApiDetail.mockReturnValue({
      data: {
        id: 'snippet-1',
        name: 'Tone Rewriter',
        description: 'A static snippet mock.',
        type: 'node',
        is_published: false,
        version: '1',
        use_count: 0,
        icon_info: {
          icon_type: null,
          icon: '🪄',
          icon_background: '#E0EAFF',
        },
        input_fields: [
          {
            label: 'Published field',
            variable: 'published_field',
            type: 'text-input',
            required: true,
          },
        ],
        created_at: 1_712_300_000,
        updated_at: 1_712_300_000,
        author: 'Evan',
      },
      error: null,
      isLoading: false,
    })
    mockFetchSnippetDraftWorkflow.mockResolvedValue(createDraftWorkflow({
      input_fields: [
        {
          label: 'Draft field',
          variable: 'draft_field',
          type: 'text-input',
          required: true,
        },
      ],
    }))

    const { result } = renderHook(() => useSnippetInit('snippet-1'))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data?.inputFields).toEqual([
      {
        label: 'Draft field',
        variable: 'draft_field',
        type: 'text-input',
        required: true,
      },
    ])
  })

  it('should sync draft metadata before returning initialized data', async () => {
    mockFetchSnippetDraftWorkflow.mockResolvedValue(createDraftWorkflow({
      hash: 'fetched-draft-hash',
      updated_at: 1_712_345_678,
      graph: {
        nodes: [{ id: 'node-1' }],
        edges: [],
        viewport: { x: 10, y: 20, zoom: 1.2 },
      },
    }))

    const { result } = renderHook(() => useSnippetInit('snippet-1'))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(mockSetDraftUpdatedAt).toHaveBeenCalledWith(1_712_345_678)
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('fetched-draft-hash')
    expect(result.current.data?.graph.viewport).toEqual({ x: 10, y: 20, zoom: 1.2 })
  })

  it('should not return stale draft data while the draft workflow request is pending', () => {
    mockFetchSnippetDraftWorkflow.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useSnippetInit('snippet-1'))

    expect(result.current.data).toBeUndefined()
    expect(result.current.isLoading).toBe(true)
  })

  it('should initialize with empty graph when the draft workflow does not exist', async () => {
    mockFetchSnippetDraftWorkflow.mockResolvedValue(undefined)

    const { result } = renderHook(() => useSnippetInit('snippet-1'))

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data?.graph).toEqual({
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    })
  })

  it('should ignore outdated draft workflow response when snippet changes', async () => {
    let resolveFirstDraft: (workflow: SnippetWorkflow) => void = () => {}
    mockFetchSnippetDraftWorkflow.mockImplementation((snippetId: string) => {
      if (snippetId === 'snippet-1') {
        return new Promise<SnippetWorkflow>((resolve) => {
          resolveFirstDraft = resolve
        })
      }

      return Promise.resolve(createDraftWorkflow({
        id: 'draft-2',
        hash: 'snippet-2-hash',
        graph: {
          nodes: [{ id: 'snippet-2-node' }],
          edges: [],
          viewport: { x: 2, y: 2, zoom: 1 },
        },
      }))
    })

    const { result, rerender } = renderHook(({ snippetId }) => useSnippetInit(snippetId), {
      initialProps: { snippetId: 'snippet-1' },
    })

    rerender({ snippetId: 'snippet-2' })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    resolveFirstDraft(createDraftWorkflow({
      hash: 'stale-snippet-1-hash',
      graph: {
        nodes: [{ id: 'stale-node' }],
        edges: [],
        viewport: { x: 1, y: 1, zoom: 1 },
      },
    }))
    await Promise.resolve()

    expect(result.current.data?.graph.nodes).toEqual([{ id: 'snippet-2-node' }])
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('snippet-2-hash')
    expect(mockSetSyncWorkflowDraftHash).not.toHaveBeenCalledWith('stale-snippet-1-hash')
  })

  it('should normalize array default block configs into workflow store state', () => {
    mockUseSnippetDefaultBlockConfigs.mockImplementation((_snippetId: string, onSuccess?: (data: unknown) => void) => {
      onSuccess?.([
        { type: 'llm', config: { model: 'gpt-4.1' } },
        { type: 'code', config: { language: 'python3' } },
      ])
      return { data: undefined, isLoading: false }
    })

    renderHook(() => useSnippetInit('snippet-1'))

    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({
      nodesDefaultConfigs: {
        llm: { model: 'gpt-4.1' },
        code: { language: 'python3' },
      },
    })
  })

  it('should keep object default block configs as-is', () => {
    mockUseSnippetDefaultBlockConfigs.mockImplementation((_snippetId: string, onSuccess?: (data: unknown) => void) => {
      onSuccess?.({
        llm: { model: 'gpt-4.1' },
      })
      return { data: undefined, isLoading: false }
    })

    renderHook(() => useSnippetInit('snippet-1'))

    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({
      nodesDefaultConfigs: {
        llm: { model: 'gpt-4.1' },
      },
    })
  })

  it('should sync published created_at into workflow store', () => {
    mockUseSnippetPublishedWorkflow.mockImplementation((_snippetId: string, onSuccess?: (data: { created_at: number }) => void) => {
      onSuccess?.({
        created_at: 1_712_345_678,
      })
      return { data: { created_at: 1_712_345_678 }, isLoading: false }
    })

    renderHook(() => useSnippetInit('snippet-1'))

    expect(mockSetPublishedAt).toHaveBeenCalledWith(1_712_345_678)
  })

  it('should reset published metadata when the published workflow is unavailable', () => {
    mockUseSnippetPublishedWorkflow.mockReturnValue({
      data: undefined,
      isLoading: false,
    })

    renderHook(() => useSnippetInit('snippet-1'))

    expect(mockSetPublishedAt).toHaveBeenCalledWith(0)
  })
})
