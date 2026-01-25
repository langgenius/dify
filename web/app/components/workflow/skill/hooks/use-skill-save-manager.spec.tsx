import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { WorkflowContext } from '@/app/components/workflow/context'
import { createWorkflowStore } from '@/app/components/workflow/store'
import { consoleQuery } from '@/service/client'
import { START_TAB_ID } from '../constants'
import { SkillSaveProvider, useSkillSaveManager } from './use-skill-save-manager'

const { mockMutateAsync } = vi.hoisted(() => ({
  mockMutateAsync: vi.fn(),
}))

vi.mock('@/service/use-app-asset', () => ({
  useUpdateAppAssetFileContent: () => ({
    mutateAsync: mockMutateAsync,
  }),
}))

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const createWrapper = (params: { appId: string, store: ReturnType<typeof createWorkflowStore>, queryClient: QueryClient }) => {
  const { appId, store, queryClient } = params
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WorkflowContext.Provider value={store}>
        <SkillSaveProvider appId={appId}>
          {children}
        </SkillSaveProvider>
      </WorkflowContext.Provider>
    </QueryClientProvider>
  )
}

const setCachedContent = (queryClient: QueryClient, appId: string, fileId: string, content: string, extra: Record<string, unknown> = {}) => {
  const queryKey = consoleQuery.appAsset.getFileContent.queryKey({
    input: { params: { appId, nodeId: fileId } },
  })
  queryClient.setQueryData(queryKey, { ...extra, content })
  return queryKey
}

const getCachedPayload = (queryClient: QueryClient, appId: string, fileId: string) => {
  const queryKey = consoleQuery.appAsset.getFileContent.queryKey({
    input: { params: { appId, nodeId: fileId } },
  })
  const cached = queryClient.getQueryData<{ content?: string }>(queryKey)
  if (!cached?.content)
    return null
  return JSON.parse(cached.content) as Record<string, unknown>
}

// Scenario: skill save manager coordinates store state, cache, and mutations.
describe('useSkillSaveManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMutateAsync.mockResolvedValue(undefined)
  })

  it('should throw when used outside provider', () => {
    expect(() => renderHook(() => useSkillSaveManager())).toThrow('Missing SkillSaveProvider in the tree')
  })

  // Scenario: save guard clauses block invalid saves.
  describe('Guards', () => {
    it('should return unsaved when app id is missing', async () => {
      // Arrange
      const store = createWorkflowStore({})
      const queryClient = createQueryClient()
      const wrapper = createWrapper({ appId: '', store, queryClient })
      const { result } = renderHook(() => useSkillSaveManager(), { wrapper })

      // Act
      const response = await result.current.saveFile('file-1')

      // Assert
      expect(response.saved).toBe(false)
      expect(mockMutateAsync).not.toHaveBeenCalled()
    })

    it('should return unsaved when no dirty content or metadata exists', async () => {
      // Arrange
      const store = createWorkflowStore({})
      const queryClient = createQueryClient()
      const wrapper = createWrapper({ appId: 'app-1', store, queryClient })
      const { result } = renderHook(() => useSkillSaveManager(), { wrapper })

      // Act
      const response = await result.current.saveFile('file-1')

      // Assert
      expect(response.saved).toBe(false)
      expect(mockMutateAsync).not.toHaveBeenCalled()
    })

    it('should skip saves for the start tab', async () => {
      // Arrange
      const store = createWorkflowStore({})
      const queryClient = createQueryClient()
      const wrapper = createWrapper({ appId: 'app-1', store, queryClient })
      const { result } = renderHook(() => useSkillSaveManager(), { wrapper })

      // Act
      const response = await result.current.saveFile(START_TAB_ID)

      // Assert
      expect(response.saved).toBe(false)
      expect(mockMutateAsync).not.toHaveBeenCalled()
    })
  })

  // Scenario: successful saves update cache and clear draft state.
  describe('Saving', () => {
    it('should save draft content, update cache, and clear draft content', async () => {
      // Arrange
      const appId = 'app-1'
      const fileId = 'file-1'
      const store = createWorkflowStore({})
      const queryClient = createQueryClient()
      const wrapper = createWrapper({ appId, store, queryClient })
      store.getState().setDraftContent(fileId, 'draft-content')
      store.getState().setFileMetadata(fileId, { author: 'test' })
      const queryKey = setCachedContent(queryClient, appId, fileId, JSON.stringify({ content: 'old' }), { extra: 'keep' })
      const { result } = renderHook(() => useSkillSaveManager(), { wrapper })

      // Act
      const response = await result.current.saveFile(fileId)

      // Assert
      expect(response.saved).toBe(true)
      expect(mockMutateAsync).toHaveBeenCalledWith({
        appId,
        nodeId: fileId,
        payload: { content: 'draft-content', metadata: { author: 'test' } },
      })
      expect(store.getState().dirtyContents.has(fileId)).toBe(false)
      expect(queryClient.getQueryData<{ extra?: string }>(queryKey)?.extra).toBe('keep')
      expect(getCachedPayload(queryClient, appId, fileId)).toEqual({
        content: 'draft-content',
        metadata: { author: 'test' },
      })
    })

    it('should save metadata-only changes using cached json content', async () => {
      // Arrange
      const appId = 'app-1'
      const fileId = 'file-1'
      const store = createWorkflowStore({})
      const queryClient = createQueryClient()
      const wrapper = createWrapper({ appId, store, queryClient })
      store.getState().setDraftMetadata(fileId, { version: 2 })
      setCachedContent(queryClient, appId, fileId, JSON.stringify({ content: 'cached-content' }))
      const { result } = renderHook(() => useSkillSaveManager(), { wrapper })

      // Act
      const response = await result.current.saveFile(fileId)

      // Assert
      expect(response.saved).toBe(true)
      expect(mockMutateAsync).toHaveBeenCalledWith({
        appId,
        nodeId: fileId,
        payload: { content: 'cached-content', metadata: { version: 2 } },
      })
      expect(store.getState().dirtyMetadataIds.has(fileId)).toBe(false)
    })

    it('should fall back to raw cached content when json parsing fails', async () => {
      // Arrange
      const appId = 'app-1'
      const fileId = 'file-1'
      const store = createWorkflowStore({})
      const queryClient = createQueryClient()
      const wrapper = createWrapper({ appId, store, queryClient })
      store.getState().setDraftMetadata(fileId, { version: 3 })
      setCachedContent(queryClient, appId, fileId, 'raw-content')
      const { result } = renderHook(() => useSkillSaveManager(), { wrapper })

      // Act
      const response = await result.current.saveFile(fileId)

      // Assert
      expect(response.saved).toBe(true)
      expect(mockMutateAsync).toHaveBeenCalledWith({
        appId,
        nodeId: fileId,
        payload: { content: 'raw-content', metadata: { version: 3 } },
      })
    })

    it('should return unsaved when metadata is dirty but no content is available', async () => {
      // Arrange
      const appId = 'app-1'
      const fileId = 'file-1'
      const store = createWorkflowStore({})
      const queryClient = createQueryClient()
      const wrapper = createWrapper({ appId, store, queryClient })
      store.getState().setDraftMetadata(fileId, { version: 4 })
      const { result } = renderHook(() => useSkillSaveManager(), { wrapper })

      // Act
      const response = await result.current.saveFile(fileId)

      // Assert
      expect(response.saved).toBe(false)
      expect(mockMutateAsync).not.toHaveBeenCalled()
    })

    it('should keep drafts when mutation fails', async () => {
      // Arrange
      const appId = 'app-1'
      const fileId = 'file-1'
      const store = createWorkflowStore({})
      const queryClient = createQueryClient()
      const wrapper = createWrapper({ appId, store, queryClient })
      store.getState().setDraftContent(fileId, 'draft-content')
      mockMutateAsync.mockRejectedValueOnce(new Error('failed'))
      const { result } = renderHook(() => useSkillSaveManager(), { wrapper })

      // Act
      const response = await result.current.saveFile(fileId)

      // Assert
      expect(response.saved).toBe(false)
      expect(response.error).toBeInstanceOf(Error)
      expect(store.getState().dirtyContents.has(fileId)).toBe(true)
    })
  })

  // Scenario: fallback registry supplies content/metadata when other sources are empty.
  describe('Fallback Registry', () => {
    it('should use registered fallback when cache and options are missing', async () => {
      // Arrange
      const appId = 'app-1'
      const fileId = 'file-1'
      const store = createWorkflowStore({})
      const queryClient = createQueryClient()
      const wrapper = createWrapper({ appId, store, queryClient })
      store.setState({
        fileMetadata: new Map<string, Record<string, unknown>>(),
        dirtyMetadataIds: new Set([fileId]),
      })
      const { result } = renderHook(() => useSkillSaveManager(), { wrapper })

      // Act
      result.current.registerFallback(fileId, { content: 'fallback-content', metadata: { source: 'registry' } })
      const response = await result.current.saveFile(fileId)

      // Assert
      expect(response.saved).toBe(true)
      expect(mockMutateAsync).toHaveBeenCalledWith({
        appId,
        nodeId: fileId,
        payload: { content: 'fallback-content', metadata: { source: 'registry' } },
      })
    })

    it('should return unsaved after fallback is unregistered', async () => {
      // Arrange
      const appId = 'app-1'
      const fileId = 'file-1'
      const store = createWorkflowStore({})
      const queryClient = createQueryClient()
      const wrapper = createWrapper({ appId, store, queryClient })
      store.setState({
        fileMetadata: new Map<string, Record<string, unknown>>(),
        dirtyMetadataIds: new Set([fileId]),
      })
      const { result } = renderHook(() => useSkillSaveManager(), { wrapper })

      // Act
      result.current.registerFallback(fileId, { content: 'fallback-content', metadata: { source: 'registry' } })
      result.current.unregisterFallback(fileId)
      const response = await result.current.saveFile(fileId)

      // Assert
      expect(response.saved).toBe(false)
      expect(mockMutateAsync).not.toHaveBeenCalled()
    })
  })

  // Scenario: multiple saves for the same file are queued.
  describe('Queueing', () => {
    it('should serialize save requests for the same file', async () => {
      // Arrange
      const appId = 'app-1'
      const fileId = 'file-1'
      const store = createWorkflowStore({})
      const queryClient = createQueryClient()
      const wrapper = createWrapper({ appId, store, queryClient })
      store.getState().setDraftContent(fileId, 'draft-1')
      let resolveFirst: (() => void) | undefined
      mockMutateAsync.mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveFirst = resolve
      }))
      const { result } = renderHook(() => useSkillSaveManager(), { wrapper })

      // Act
      const first = result.current.saveFile(fileId)
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledTimes(1)
      })
      store.getState().setDraftContent(fileId, 'draft-2')
      const second = result.current.saveFile(fileId)

      // Assert
      resolveFirst?.()
      await first
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledTimes(2)
      })
      await second
    })
  })

  // Scenario: saveAllDirty saves all relevant dirty files once.
  describe('saveAllDirty', () => {
    it('should save all dirty files except the start tab', async () => {
      // Arrange
      const appId = 'app-1'
      const store = createWorkflowStore({})
      const queryClient = createQueryClient()
      const wrapper = createWrapper({ appId, store, queryClient })
      store.getState().setDraftContent('file-1', 'draft-1')
      store.getState().setDraftMetadata('file-2', { tag: 'meta' })
      store.getState().setDraftContent(START_TAB_ID, 'start-draft')
      setCachedContent(queryClient, appId, 'file-2', JSON.stringify({ content: 'meta-content' }))
      const { result } = renderHook(() => useSkillSaveManager(), { wrapper })

      // Act
      result.current.saveAllDirty()

      // Assert
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledTimes(2)
      })
      const nodeIds = mockMutateAsync.mock.calls.map(call => call[0].nodeId)
      expect(nodeIds.sort()).toEqual(['file-1', 'file-2'])
    })

    it('should ignore dirty start tab when no other files are dirty', async () => {
      // Arrange
      const appId = 'app-1'
      const store = createWorkflowStore({})
      const queryClient = createQueryClient()
      const wrapper = createWrapper({ appId, store, queryClient })
      store.getState().setDraftContent(START_TAB_ID, 'start-draft')
      const { result } = renderHook(() => useSkillSaveManager(), { wrapper })

      // Act
      result.current.saveAllDirty()

      // Assert
      await waitFor(() => {
        expect(mockMutateAsync).not.toHaveBeenCalled()
      })
    })
  })
})
