import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import { AppACLPermission } from '@/utils/permission'

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
const mockSyncWorkflowDraft = vi.fn()

let appStoreState: {
  appDetail: {
    id: string
    name: string
    mode: string
    permission_keys?: string[]
    maintainer?: string
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

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['app.create_and_management'],
  }))
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['app.create_and_management'],
  }))
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['app.create_and_management'],
  }))
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['app.create_and_management'],
  }))
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: { id: 'user-1' },
    workspacePermissionKeys: ['app.create_and_management'],
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('../use-workflow-template', () => ({
  useWorkflowTemplate: () => ({
    nodes: appStoreState.appDetail.mode === 'workflow'
      ? [{ id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } }]
      : [{ id: 'start', data: { type: BlockEnum.Start } }],
    edges: [],
  }),
}))

vi.mock('@/service/use-workflow', () => ({
  useWorkflowConfig: (_url: string, onSuccess: (config: Record<string, unknown>) => void) => {
    if (workflowConfigState.data)
      onSuccess(workflowConfigState.data)
    return workflowConfigState
  },
}))

const mockFetchWorkflowDraft = vi.fn()

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
  graph: {
    nodes: [{ id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } }],
    edges: [],
  },
  hash: 'server-hash',
  created_at: 0,
  created_by: { id: '', name: '', email: '' },
  updated_at: 1,
  updated_by: { id: '', name: '', email: '' },
  tool_published: false,
  features: { retriever_resource: { enabled: true } },
  environment_variables: [],
  conversation_variables: [],
  version: '1',
  marked_name: '',
  marked_comment: '',
}

describe('useWorkflowInit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appStoreState = {
      appDetail: { id: 'app-1', name: 'Test', mode: 'workflow', permission_keys: [AppACLPermission.Edit] },
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
    mockSyncWorkflowDraft.mockReset()
  })

  it('should create an empty backend draft and restore a local start placeholder when the workflow draft does not exist', async () => {
    mockFetchWorkflowDraft
      .mockReset()
      .mockRejectedValueOnce(notExistError())
      .mockResolvedValueOnce({
        ...draftResponse,
        graph: { nodes: [], edges: [] },
        hash: 'new-workflow-hash',
      })
    mockSyncWorkflowDraft.mockResolvedValue({ hash: 'new-hash', updated_at: 1 })

    const { result } = renderHook(() => useWorkflowInit())

    await waitFor(() => {
      expect(result.current.data?.graph.nodes).toEqual([
        { id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } },
      ])
    })

    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith(expect.objectContaining({
      showOnboarding: false,
      shouldAutoOpenStartNodeSelector: false,
      hasSelectedStartNode: false,
      hasShownOnboarding: true,
    }))
    expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        graph: {
          nodes: [],
          edges: [],
        },
      }),
    }))
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-hash')
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-workflow-hash')
  })

  it('should keep creating the first backend draft for advanced chat apps', async () => {
    appStoreState = {
      appDetail: { id: 'app-1', name: 'Test', mode: 'advanced-chat', permission_keys: [AppACLPermission.Edit] },
    }
    mockFetchWorkflowDraft
      .mockReset()
      .mockRejectedValueOnce(notExistError())
      .mockResolvedValueOnce(draftResponse)
    mockSyncWorkflowDraft.mockResolvedValue({ hash: 'new-hash', updated_at: 1 })

    renderHook(() => useWorkflowInit())

    await waitFor(() => expect(mockSyncWorkflowDraft).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        graph: {
          nodes: [{ id: 'start', data: { type: BlockEnum.Start } }],
          edges: [],
        },
      }),
    })))
    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith(expect.objectContaining({
      showOnboarding: false,
      shouldAutoOpenStartNodeSelector: false,
      hasShownOnboarding: false,
    }))
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('new-hash')
  })

  it('should keep readonly users local when the first workflow draft does not exist', async () => {
    appStoreState = {
      appDetail: { id: 'app-1', name: 'Test', mode: 'workflow', permission_keys: [AppACLPermission.ViewLayout] },
    }
    mockFetchWorkflowDraft
      .mockReset()
      .mockRejectedValueOnce(notExistError())

    const { result } = renderHook(() => useWorkflowInit())

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    expect(result.current.data?.graph.nodes).toEqual([
      { id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } },
    ])
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockWorkflowStoreSetState).toHaveBeenCalledWith(expect.objectContaining({
      envSecrets: {},
      environmentVariables: [],
      conversationVariables: [],
      isWorkflowDataLoaded: true,
    }))
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('')
  })

  it('should restore a local start placeholder when an existing workflow draft has an empty graph', async () => {
    mockFetchWorkflowDraft.mockReset().mockResolvedValue({
      ...draftResponse,
      graph: { nodes: [], edges: [] },
      hash: 'empty-draft-hash',
    })

    const { result } = renderHook(() => useWorkflowInit())

    await waitFor(() => {
      expect(result.current.data?.graph.nodes).toEqual([
        { id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } },
      ])
    })

    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
    expect(mockSetSyncWorkflowDraftHash).toHaveBeenCalledWith('empty-draft-hash')
  })

  it('should preserve existing draft nodes when restoring the local start placeholder', async () => {
    const existingNode = { id: 'llm', data: { type: BlockEnum.LLM } }
    const existingEdge = { source: 'llm', target: 'answer' }
    mockFetchWorkflowDraft.mockReset().mockResolvedValue({
      ...draftResponse,
      graph: {
        nodes: [existingNode],
        edges: [existingEdge],
      },
    })

    const { result } = renderHook(() => useWorkflowInit())

    await waitFor(() => {
      expect(result.current.data?.graph.nodes).toEqual([
        { id: 'start-placeholder', data: { type: BlockEnum.StartPlaceholder } },
        existingNode,
      ])
    })

    expect(result.current.data?.graph.edges).toEqual([existingEdge])
    expect(mockSyncWorkflowDraft).not.toHaveBeenCalled()
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
