import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useWorkflowInit } from '../use-workflow-init'

const mockSetSyncWorkflowDraftHash = vi.fn()
const mockSetDraftUpdatedAt = vi.fn()
const mockSetToolPublished = vi.fn()
const mockSetPublishedAt = vi.fn()
const mockSetLastPublishedHasUserInput = vi.fn()
const mockSetFileUploadConfig = vi.fn()
const mockWorkflowStoreSetState = vi.fn()
const mockWorkflowStoreGetState = vi.fn()

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T>(selector: (state: { setSyncWorkflowDraftHash: ReturnType<typeof vi.fn> }) => T): T =>
    selector({ setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash }),
  useWorkflowStore: () => ({
    setState: mockWorkflowStoreSetState,
    getState: mockWorkflowStoreGetState,
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: <T>(selector: (state: { appDetail: { id: string, name: string, mode: string } }) => T): T =>
    selector({ appDetail: { id: 'app-1', name: 'Test', mode: 'workflow' } }),
}))

vi.mock('../use-workflow-template', () => ({
  useWorkflowTemplate: () => ({ nodes: [], edges: [] }),
}))

vi.mock('@/service/use-workflow', () => ({
  useWorkflowConfig: () => ({ data: null, isLoading: false }),
}))

const mockFetchWorkflowDraft = vi.fn()
const mockSyncWorkflowDraft = vi.fn()

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
  syncWorkflowDraft: (...args: unknown[]) => mockSyncWorkflowDraft(...args),
  fetchNodesDefaultConfigs: () => Promise.resolve([]),
  fetchPublishedWorkflow: () => Promise.resolve({ created_at: 0, graph: { nodes: [], edges: [] } }),
}))

const notExistError = () => ({
  json: vi.fn().mockResolvedValue({ code: 'draft_workflow_not_exist' }),
  bodyUsed: false,
})

const draftResponse = {
  id: 'draft-id',
  graph: { nodes: [], edges: [] },
  hash: 'server-hash',
  created_at: 0,
  created_by: { id: '', name: '', email: '' },
  updated_at: 1,
  updated_by: { id: '', name: '', email: '' },
  tool_published: false,
  environment_variables: [],
  conversation_variables: [],
  version: '1',
  marked_name: '',
  marked_comment: '',
}

describe('useWorkflowInit — hash fix (draft_workflow_not_exist)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowStoreGetState.mockReturnValue({
      setDraftUpdatedAt: mockSetDraftUpdatedAt,
      setToolPublished: mockSetToolPublished,
      setPublishedAt: mockSetPublishedAt,
      setLastPublishedHasUserInput: mockSetLastPublishedHasUserInput,
      setFileUploadConfig: mockSetFileUploadConfig,
    })
    mockFetchWorkflowDraft
      .mockRejectedValueOnce(notExistError())
      .mockResolvedValueOnce(draftResponse)
    mockSyncWorkflowDraft.mockResolvedValue({ hash: 'new-hash', updated_at: 1 })
  })

  it('should call setSyncWorkflowDraftHash with hash returned by syncWorkflowDraft', async () => {
    renderHook(() => useWorkflowInit())
    await waitFor(() => expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-hash'))
  })

  it('should store hash BEFORE making the recursive fetchWorkflowDraft call', async () => {
    const order: string[] = []
    mockSetSyncWorkflowDraftHash.mockImplementation((h: string) => order.push(`hash:${h}`))
    mockFetchWorkflowDraft
      .mockReset()
      .mockRejectedValueOnce(notExistError())
      .mockImplementationOnce(async () => {
        order.push('fetch:2')
        return draftResponse
      })
    mockSyncWorkflowDraft.mockResolvedValue({ hash: 'new-hash', updated_at: 1 })

    renderHook(() => useWorkflowInit())

    await waitFor(() => expect(order).toContain('fetch:2'))
    expect(order).toContain('hash:new-hash')
    expect(order.indexOf('hash:new-hash')).toBeLessThan(order.indexOf('fetch:2'))
  })
})
