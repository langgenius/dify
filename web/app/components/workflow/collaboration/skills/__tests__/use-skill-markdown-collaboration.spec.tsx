import { renderHook, waitFor } from '@testing-library/react'
import { useSkillMarkdownCollaboration } from '../use-skill-markdown-collaboration'

const mocks = vi.hoisted(() => ({
  openFile: vi.fn<(appId: string, fileId: string, initialContent: string) => void>(),
  setActiveFile: vi.fn<(appId: string, fileId: string, isActive: boolean) => void>(),
  subscribe: vi.fn<(fileId: string, callback: (text: string, source: 'remote') => void) => () => void>(() => vi.fn()),
  onSyncRequest: vi.fn<(fileId: string, callback: () => void) => () => void>(() => vi.fn()),
  updateText: vi.fn<(fileId: string, text: string) => void>(),
  isLeader: vi.fn<(fileId: string) => boolean>(() => false),
  getState: vi.fn(() => ({
    clearDraftContent: vi.fn(),
    setDraftContent: vi.fn(),
    pinTab: vi.fn(),
  })),
  emit: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: mocks.getState,
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: mocks.emit,
    },
  }),
}))

vi.mock('../skill-collaboration-manager', () => ({
  skillCollaborationManager: {
    openFile: (appId: string, fileId: string, initialContent: string) => mocks.openFile(appId, fileId, initialContent),
    setActiveFile: (appId: string, fileId: string, isActive: boolean) => mocks.setActiveFile(appId, fileId, isActive),
    subscribe: (fileId: string, callback: (text: string, source: 'remote') => void) => mocks.subscribe(fileId, callback),
    onSyncRequest: (fileId: string, callback: () => void) => mocks.onSyncRequest(fileId, callback),
    updateText: (fileId: string, text: string) => mocks.updateText(fileId, text),
    isLeader: (fileId: string) => mocks.isLeader(fileId),
  },
}))

describe('useSkillMarkdownCollaboration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should degrade gracefully when collaboration initialization fails', async () => {
    const error = new TypeError('Cannot read properties of undefined (reading "lorodoc_new")')
    mocks.openFile.mockImplementation(() => {
      throw error
    })
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    renderHook(() => useSkillMarkdownCollaboration({
      appId: 'app-1',
      fileId: 'file-1',
      enabled: true,
      initialContent: 'hello',
      baselineContent: 'hello',
      onLocalChange: vi.fn(),
      onLeaderSync: vi.fn(),
    }))

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to initialize skill collaboration:', error)
    })
    expect(mocks.setActiveFile).not.toHaveBeenCalled()
    expect(mocks.subscribe).not.toHaveBeenCalled()
    expect(mocks.onSyncRequest).not.toHaveBeenCalled()

    consoleErrorSpy.mockRestore()
  })
})
