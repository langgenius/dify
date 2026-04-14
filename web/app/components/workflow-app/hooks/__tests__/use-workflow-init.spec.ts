import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'

import { useWorkflowInit } from '../use-workflow-init'

const mockSetSyncWorkflowDraftHash = vi.fn()
const mockSetDraftUpdatedAt = vi.fn()
const mockSetToolPublished = vi.fn()
const mockSetPublishedAt = vi.fn()
const mockSetLastPublishedHasUserInput = vi.fn()
const mockSetFileUploadConfig = vi.fn()
const mockWorkflowStoreSetState = vi.fn()
const mockWorkflowStoreGetState = vi.fn()
const mockFetchNodesDefaultConfigs = vi.fn()
const mockFetchPublishedWorkflow = vi.fn()

let appStoreState: {
  appDetail: {
    id: string
    name: string
    mode: string
  }
}

let workflowConfigState: {
  data: Record<string, unknown> | null
  isLoading: boolean
}

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T>(selector: (state: { setSyncWorkflowDraftHash: ReturnType<typeof vi.fn> }) => T): T =>
    selector({ setSyncWorkflowDraftHash: mockSetSyncWorkflowDraftHash }),
  useWorkflowStore: () => ({
    setState: mockWorkflowStoreSetState,
    getState: mockWorkflowStoreGetState,
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: <T>(selector: (state: typeof appStoreState) => T): T =>
    selector(appStoreState),
}))

vi.mock('../use-workflow-template', () => ({
  useWorkflowTemplate: () => ({ nodes: [], edges: [] }),
}))

vi.mock('@/service/use-workflow', () => ({
  useWorkflowConfig: (_url: string, onSuccess: (config: Record<string, unknown>) => void) => {
    if (workflowConfigState.data)
      onSuccess(workflowConfigState.data)
    return workflowConfigState
  },
}))

const mockFetchWorkflowDraft = vi.fn()
const mockSyncWorkflowDraft = vi.fn()

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
  syncWorkflowDraft: (...args: unknown[]) => mockSyncWorkflowDraft(...args),
  fetchNodesDefaultConfigs: (...args: unknown[]) => mockFetchNodesDefaultConfigs(...args),
  fetchPublishedWorkflow: (...args: unknown[]) => mockFetchPublishedWorkflow(...args),
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
    appStoreState = {
      appDetail: { id: 'app-1', name: 'Test', mode: 'workflow' },
    }
    workflowConfigState = { data: null, isLoading: false }
    mockWorkflowStoreGetState.mockReturnValue({
      setDraftUpdatedAt: mockSetDraftUpdatedAt,
      setToolPublished: mockSetToolPublished,
      setPublishedAt: mockSetPublishedAt,
      setLastPublishedHasUserInput: mockSetLastPublishedHasUserInput,
      setFileUploadConfig: mockSetFileUploadConfig,
    })
    mockFetchNodesDefaultConfigs.mockResolvedValue([])
    mockFetchPublishedWorkflow.mockResolvedValue({ created_at: 0, graph: { nodes: [], edges: [] } })
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

  it('should hydrate draft state, preload defaults, and derive published workflow metadata on success', async () => {
    workflowConfigState = {
      data: { enabled: true, sizeLimit: 20 },
      isLoading: false,
    }
    mockFetchWorkflowDraft.mockReset().mockResolvedValue({
      ...draftResponse,
      updated_at: 9,
      tool_published: true,
      environment_variables: [
        { id: 'env-secret', value_type: 'secret', value: 'top-secret', name: 'SECRET' },
        { id: 'env-plain', value_type: 'text', value: 'visible', name: 'PLAIN' },
      ],
      conversation_variables: [{ id: 'conversation-1' }],
    })
    mockFetchNodesDefaultConfigs.mockResolvedValue([
      { type: 'start', config: { title: 'Start Config' } },
      { type: 'start', config: { title: 'Ignored Duplicate' } },
    ])
    mockFetchPublishedWorkflow.mockResolvedValue({
      created_at: 99,
      graph: {
        nodes: [{ id: 'start', data: { type: BlockEnum.Start } }],
        edges: [{ source: 'start', target: 'end' }],
      },
    })

    const { result } = renderHook(() => useWorkflowInit())

    await waitFor(() => {
      expect(result.current.data?.hash).toBe('server-hash')
    })

    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({ appId: 'app-1', appName: 'Test' })
    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith(expect.objectContaining({
      envSecrets: { 'env-secret': 'top-secret' },
      environmentVariables: [
        { id: 'env-secret', value_type: 'secret', value: '[__HIDDEN__]', name: 'SECRET' },
        { id: 'env-plain', value_type: 'text', value: 'visible', name: 'PLAIN' },
      ],
      conversationVariables: [{ id: 'conversation-1' }],
      isWorkflowDataLoaded: true,
    }))
    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith({
      nodesDefaultConfigs: {
        start: { title: 'Start Config' },
      },
    })
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('server-hash')
    expect(mockSetDraftUpdatedAt).toHaveBeenCalledWith(9)
    expect(mockSetToolPublished).toHaveBeenCalledWith(true)
    expect(mockSetPublishedAt).toHaveBeenCalledWith(99)
    expect(mockSetLastPublishedHasUserInput).toHaveBeenCalledWith(true)
    expect(mockSetFileUploadConfig).toHaveBeenCalledWith({ enabled: true, sizeLimit: 20 })
    expect(result.current.fileUploadConfigResponse).toEqual({ enabled: true, sizeLimit: 20 })
    expect(result.current.isLoading).toBe(false)
  })

  it('should fall back to no published user input when preload requests fail', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockFetchWorkflowDraft.mockReset().mockResolvedValue(draftResponse)
    mockFetchNodesDefaultConfigs.mockRejectedValue(new Error('preload failed'))

    renderHook(() => useWorkflowInit())

    await waitFor(() => {
      expect(mockSetLastPublishedHasUserInput).toHaveBeenCalledWith(false)
    })

    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})
