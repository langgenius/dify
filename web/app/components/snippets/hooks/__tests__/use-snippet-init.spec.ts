import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSnippetInit } from '../use-snippet-init'

const mockWorkflowStoreSetState = vi.fn()
const mockSetPublishedAt = vi.fn()
const mockSetDraftUpdatedAt = vi.fn()
const mockSetSyncWorkflowDraftHash = vi.fn()
const mockUseSnippetApiDetail = vi.fn()
const mockUseSnippetDraftWorkflow = vi.fn()
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
  useSnippetDraftWorkflow: (snippetId: string, onSuccess?: (data: { updated_at: number, hash: string }) => void) => mockUseSnippetDraftWorkflow(snippetId, onSuccess),
  useSnippetDefaultBlockConfigs: (snippetId: string, onSuccess?: (data: unknown) => void) => mockUseSnippetDefaultBlockConfigs(snippetId, onSuccess),
  useSnippetPublishedWorkflow: (snippetId: string, onSuccess?: (data: { created_at: number }) => void) => mockUseSnippetPublishedWorkflow(snippetId, onSuccess),
}))

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
    mockUseSnippetDraftWorkflow.mockReturnValue({
      data: undefined,
      isLoading: false,
    })
    mockUseSnippetDefaultBlockConfigs.mockReturnValue({
      data: undefined,
    })
    mockUseSnippetPublishedWorkflow.mockReturnValue({
      data: undefined,
    })
  })

  it('should return snippet detail query result', () => {
    const { result } = renderHook(() => useSnippetInit('snippet-1'))

    expect(mockUseSnippetApiDetail).toHaveBeenCalledWith('snippet-1')
    expect(result.current.data?.snippet.id).toBe('snippet-1')
    expect(result.current.data?.graph.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(result.current.isLoading).toBe(false)
  })

  it('should use draft input_fields for snippet inputs', () => {
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
    mockUseSnippetDraftWorkflow.mockReturnValue({
      data: {
        id: 'draft-1',
        graph: {},
        features: {},
        input_fields: [
          {
            label: 'Draft field',
            variable: 'draft_field',
            type: 'text-input',
            required: true,
          },
        ],
        hash: 'draft-hash',
        created_at: 1_712_300_000,
        updated_at: 1_712_345_678,
      },
      isLoading: false,
    })

    const { result } = renderHook(() => useSnippetInit('snippet-1'))

    expect(result.current.data?.inputFields).toEqual([
      {
        label: 'Draft field',
        variable: 'draft_field',
        type: 'text-input',
        required: true,
      },
    ])
  })

  it('should sync draft metadata into workflow store', () => {
    mockUseSnippetDraftWorkflow.mockImplementation((_snippetId: string, onSuccess?: (data: { updated_at: number, hash: string }) => void) => {
      onSuccess?.({
        updated_at: 1_712_345_678,
        hash: 'draft-hash',
      })
      return { data: undefined, isLoading: false }
    })

    renderHook(() => useSnippetInit('snippet-1'))

    expect(mockSetDraftUpdatedAt).toHaveBeenCalledWith(1_712_345_678)
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('draft-hash')
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

  it('should stay loading while draft workflow is still fetching', () => {
    mockUseSnippetDraftWorkflow.mockReturnValue({
      data: undefined,
      isLoading: true,
    })

    const { result } = renderHook(() => useSnippetInit('snippet-1'))

    expect(result.current.data).toBeUndefined()
    expect(result.current.isLoading).toBe(true)
  })
})
