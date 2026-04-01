import { SkillCollaborationManager } from '../skill-collaboration-manager'

type SocketHandler = (...args: unknown[]) => void

const mocks = vi.hoisted(() => {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  class MockLoroText {
    private readonly getValue: () => string
    private readonly setValue: (nextValue: string) => void

    constructor(getValue: () => string, setValue: (nextValue: string) => void) {
      this.getValue = getValue
      this.setValue = setValue
    }

    update(nextValue: string) {
      this.setValue(nextValue)
    }

    toString() {
      return this.getValue()
    }
  }

  class MockLoroDoc {
    private value = ''
    private subscribers = new Set<(event: { by?: string }) => void>()
    static nextImportError: Error | null = null

    getText() {
      return new MockLoroText(
        () => this.value,
        (nextValue: string) => {
          this.value = nextValue
        },
      )
    }

    subscribe(callback: (event: { by?: string }) => void) {
      this.subscribers.add(callback)
    }

    commit() {
      this.subscribers.forEach(callback => callback({ by: 'local' }))
    }

    export() {
      return encoder.encode(this.value)
    }

    import(data: Uint8Array) {
      if (MockLoroDoc.nextImportError) {
        const error = MockLoroDoc.nextImportError
        MockLoroDoc.nextImportError = null
        throw error
      }

      this.value = decoder.decode(data)
      this.subscribers.forEach(callback => callback({ by: 'remote' }))
    }
  }

  type MockSocket = {
    connected: boolean
    emit: ReturnType<typeof vi.fn>
    id: string
    off: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
  }

  const handlerStore = new Map<string, Map<string, SocketHandler>>()
  const socketStore = new Map<string, MockSocket>()

  const getOrCreateSocket = (appId: string): MockSocket => {
    const existing = socketStore.get(appId)
    if (existing)
      return existing

    const handlers = new Map<string, SocketHandler>()
    const socket: MockSocket = {
      connected: false,
      emit: vi.fn(),
      id: `socket-${appId}`,
      off: vi.fn((event: string, handler?: SocketHandler) => {
        if (!handler) {
          handlers.delete(event)
          return
        }

        const current = handlers.get(event)
        if (current === handler)
          handlers.delete(event)
      }),
      on: vi.fn((event: string, handler: SocketHandler) => {
        handlers.set(event, handler)
      }),
    }

    socketStore.set(appId, socket)
    handlerStore.set(appId, handlers)
    return socket
  }

  return {
    MockLoroDoc,
    connectSocket: vi.fn((appId: string) => getOrCreateSocket(appId)),
    emitSocketEvent: (appId: string, event: string, ...args: unknown[]) => {
      const handler = handlerStore.get(appId)?.get(event)
      handler?.(...args)
    },
    emitWithAuthGuard: vi.fn(),
    getSocket: (appId: string) => getOrCreateSocket(appId),
    reset: () => {
      socketStore.clear()
      handlerStore.clear()
      MockLoroDoc.nextImportError = null
    },
    setNextImportError: (error: Error) => {
      MockLoroDoc.nextImportError = error
    },
  }
})

vi.mock('loro-crdt', () => ({
  LoroDoc: mocks.MockLoroDoc,
}))

vi.mock('@/app/components/workflow/collaboration/core/websocket-manager', () => ({
  emitWithAuthGuard: (...args: Parameters<typeof mocks.emitWithAuthGuard>) => mocks.emitWithAuthGuard(...args),
  webSocketClient: {
    connect: (appId: string) => mocks.connectSocket(appId),
  },
}))

const decodePayload = (data: Uint8Array) => new TextDecoder().decode(data)

// Scenario: manager-level collaboration state should stay correct across open/close, socket updates, and reconnects.
describe('SkillCollaborationManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reset()
  })

  // Scenario: lifecycle guards and ref-counted close should avoid leaking state.
  describe('Lifecycle', () => {
    it('should ignore invalid open and close requests', () => {
      // Arrange
      const manager = new SkillCollaborationManager()

      // Act
      manager.openFile('', 'file-1', 'alpha')
      manager.openFile('app-1', '', 'alpha')
      manager.closeFile('')

      // Assert
      expect(mocks.connectSocket).not.toHaveBeenCalled()
      expect(manager.isFileCollaborative('file-1')).toBe(false)
    })

    it('should keep state until the last open handle is closed', () => {
      // Arrange
      const manager = new SkillCollaborationManager()

      // Act
      manager.openFile('app-1', 'file-1', 'alpha')
      manager.openFile('app-1', 'file-1', 'beta')
      manager.closeFile('file-1')

      // Assert
      expect(manager.isFileCollaborative('file-1')).toBe(true)
      expect(manager.getText('file-1')).toBe('alpha')
    })

    it('should release file state after the final close and allow a clean reopen', () => {
      // Arrange
      const manager = new SkillCollaborationManager()
      manager.openFile('app-1', 'file-1', 'alpha')

      // Act
      manager.closeFile('file-1')

      // Assert
      expect(manager.isFileCollaborative('file-1')).toBe(false)
      expect(manager.getText('file-1')).toBeNull()

      // Act
      manager.openFile('app-1', 'file-1', 'beta')

      // Assert
      expect(manager.isFileCollaborative('file-1')).toBe(true)
      expect(manager.getText('file-1')).toBe('beta')
    })

    it('should clear previous app state and detach old socket listeners when switching apps', () => {
      // Arrange
      const manager = new SkillCollaborationManager()
      const savedCallback = vi.fn()
      const treeCallback = vi.fn()
      manager.openFile('app-1', 'file-1', 'alpha')
      manager.onAnyFileSaved(savedCallback)
      manager.onTreeUpdate('app-1', treeCallback)
      const app1Socket = mocks.getSocket('app-1')

      // Act
      manager.openFile('app-2', 'file-2', 'beta')
      mocks.emitSocketEvent('app-2', 'collaboration_update', {
        type: 'skill_file_saved',
        data: { file_id: 'file-2', content: 'beta' },
      })
      mocks.emitSocketEvent('app-2', 'collaboration_update', {
        type: 'skill_tree_update',
        data: { kind: 'refresh' },
      })

      // Assert
      expect(manager.isFileCollaborative('file-1')).toBe(false)
      expect(manager.getText('file-1')).toBeNull()
      expect(app1Socket.off).toHaveBeenCalledTimes(4)
      expect(savedCallback).not.toHaveBeenCalled()
      expect(treeCallback).not.toHaveBeenCalled()
    })
  })

  // Scenario: local edits and remote document events should stay in sync with subscribers.
  describe('Document Sync', () => {
    it('should emit updates for local text changes and skip unchanged content', () => {
      // Arrange
      const manager = new SkillCollaborationManager()
      const socket = mocks.getSocket('app-1')
      socket.connected = true
      manager.openFile('app-1', 'file-1', 'alpha')
      vi.clearAllMocks()

      // Act
      manager.updateText('missing-file', 'ignored')
      manager.updateText('file-1', 'alpha')
      manager.updateText('file-1', 'beta')

      // Assert
      expect(mocks.emitWithAuthGuard).toHaveBeenCalledTimes(1)
      const [emittedSocket, emittedEvent, payload] = mocks.emitWithAuthGuard.mock.calls[0] as [
        typeof socket,
        string,
        { file_id: string, update: Uint8Array },
      ]
      expect(emittedSocket).toBe(socket)
      expect(emittedEvent).toBe('skill_event')
      expect(payload.file_id).toBe('file-1')
      expect(ArrayBuffer.isView(payload.update)).toBe(true)
      expect(decodePayload(payload.update)).toBe('beta')
    })

    it('should deliver remote updates to subscribers and preserve them across snapshot replacement', () => {
      // Arrange
      const manager = new SkillCollaborationManager()
      manager.openFile('app-1', 'file-1', 'alpha')
      const callback = vi.fn()
      manager.subscribe('file-1', callback)

      // Act
      mocks.emitSocketEvent('app-1', 'skill_update', {
        file_id: 'file-1',
        update: new TextEncoder().encode('gamma'),
      })
      mocks.emitSocketEvent('app-1', 'skill_update', {
        file_id: 'file-1',
        update: new TextEncoder().encode('delta'),
        is_snapshot: true,
      })

      // Assert
      expect(callback).toHaveBeenNthCalledWith(1, 'gamma', 'remote')
      expect(callback).toHaveBeenNthCalledWith(2, 'delta', 'remote')
      expect(manager.getText('file-1')).toBe('delta')
    })

    it('should log import failures for malformed updates and snapshots', () => {
      // Arrange
      const manager = new SkillCollaborationManager()
      manager.openFile('app-1', 'file-1', 'alpha')
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const updateError = new Error('update import failed')
      const snapshotError = new Error('snapshot import failed')

      // Act
      mocks.setNextImportError(updateError)
      mocks.emitSocketEvent('app-1', 'skill_update', {
        file_id: 'file-1',
        update: new TextEncoder().encode('gamma'),
      })
      mocks.setNextImportError(snapshotError)
      mocks.emitSocketEvent('app-1', 'skill_update', {
        file_id: 'file-1',
        update: new TextEncoder().encode('delta'),
        is_snapshot: true,
      })

      // Assert
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(1, 'Failed to import skill update:', updateError)
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(2, 'Failed to import skill snapshot:', snapshotError)

      consoleErrorSpy.mockRestore()
    })
  })

  // Scenario: collaboration socket events should update leader state, cursors, and sync hooks.
  describe('Socket Events', () => {
    it('should process leader, file saved, tree update, and cursor events', () => {
      // Arrange
      const manager = new SkillCollaborationManager()
      manager.openFile('app-1', 'file-1', 'alpha')
      const savedCallback = vi.fn()
      const treeCallback = vi.fn()
      const cursorCallback = vi.fn()
      const unsubscribeCursor = manager.onCursorUpdate('file-1', cursorCallback)
      manager.onAnyFileSaved(savedCallback)
      manager.onTreeUpdate('app-1', treeCallback)

      // Act
      mocks.emitSocketEvent('app-1', 'skill_status', { file_id: 'file-1', isLeader: true })
      mocks.emitSocketEvent('app-1', 'collaboration_update', {
        type: 'skill_file_saved',
        data: { file_id: 'file-1', content: 'saved' },
      })
      mocks.emitSocketEvent('app-1', 'collaboration_update', {
        type: 'skill_tree_update',
        data: { kind: 'refresh' },
      })
      mocks.emitSocketEvent('app-1', 'collaboration_update', {
        type: 'skill_cursor',
        userId: 'user-1',
        timestamp: 123,
        data: { file_id: 'file-1', start: 1, end: 4 },
      })
      mocks.emitSocketEvent('app-1', 'collaboration_update', {
        type: 'skill_cursor',
        userId: 'user-1',
        timestamp: 124,
        data: { file_id: 'file-1', start: null, end: null },
      })
      unsubscribeCursor()
      mocks.emitSocketEvent('app-1', 'collaboration_update', {
        type: 'skill_cursor',
        userId: 'user-1',
        timestamp: 125,
        data: { file_id: 'file-1', start: 2, end: 5 },
      })

      // Assert
      expect(manager.isLeader('file-1')).toBe(true)
      expect(savedCallback).toHaveBeenCalledWith({ file_id: 'file-1', content: 'saved' })
      expect(treeCallback).toHaveBeenCalledWith({ kind: 'refresh' })
      expect(cursorCallback).toHaveBeenNthCalledWith(1, {})
      expect(cursorCallback).toHaveBeenNthCalledWith(2, {
        'user-1': { userId: 'user-1', start: 1, end: 4, timestamp: 123 },
      })
      expect(cursorCallback).toHaveBeenNthCalledWith(3, {})
      expect(cursorCallback).toHaveBeenCalledTimes(3)
    })

    it('should invoke sync and resync handling only for leaders', () => {
      // Arrange
      const manager = new SkillCollaborationManager()
      const socket = mocks.getSocket('app-1')
      socket.connected = true
      manager.openFile('app-1', 'file-1', 'alpha')
      vi.clearAllMocks()
      const syncCallback = vi.fn()
      const unsubscribeSync = manager.onSyncRequest('file-1', syncCallback)

      // Act
      mocks.emitSocketEvent('app-1', 'collaboration_update', {
        type: 'skill_sync_request',
        data: { file_id: 'file-1' },
      })
      mocks.emitSocketEvent('app-1', 'collaboration_update', {
        type: 'skill_resync_request',
        data: { file_id: 'file-1' },
      })
      mocks.emitSocketEvent('app-1', 'skill_status', { file_id: 'file-1', isLeader: true })
      mocks.emitSocketEvent('app-1', 'collaboration_update', {
        type: 'skill_sync_request',
        data: { file_id: 'file-1' },
      })
      mocks.emitSocketEvent('app-1', 'collaboration_update', {
        type: 'skill_resync_request',
        data: { file_id: 'file-1' },
      })
      unsubscribeSync()
      mocks.emitSocketEvent('app-1', 'collaboration_update', {
        type: 'skill_sync_request',
        data: { file_id: 'file-1' },
      })

      // Assert
      expect(syncCallback).toHaveBeenCalledTimes(1)
      const [emittedSocket, emittedEvent, payload] = mocks.emitWithAuthGuard.mock.calls[0] as [
        typeof socket,
        string,
        { file_id: string, is_snapshot: boolean, update: Uint8Array },
      ]
      expect(emittedSocket).toBe(socket)
      expect(emittedEvent).toBe('skill_event')
      expect(payload.file_id).toBe('file-1')
      expect(payload.is_snapshot).toBe(true)
      expect(ArrayBuffer.isView(payload.update)).toBe(true)
    })

    it('should ignore malformed socket payloads', () => {
      // Arrange
      const manager = new SkillCollaborationManager()
      manager.openFile('app-1', 'file-1', 'alpha')
      const cursorCallback = vi.fn()
      manager.onCursorUpdate('', cursorCallback)

      // Act
      mocks.emitSocketEvent('app-1', 'skill_update', null)
      mocks.emitSocketEvent('app-1', 'skill_status', { isLeader: true })
      mocks.emitSocketEvent('app-1', 'collaboration_update', { data: { file_id: 'file-1' } })
      mocks.emitSocketEvent('app-1', 'collaboration_update', {
        type: 'skill_file_saved',
        data: {},
      })
      mocks.emitSocketEvent('app-1', 'collaboration_update', {
        type: 'skill_cursor',
        timestamp: 123,
        data: { file_id: 'file-1', start: 1, end: 2 },
      })

      // Assert
      expect(manager.isLeader('file-1')).toBe(false)
      expect(cursorCallback).not.toHaveBeenCalled()
    })

    it('should ignore cursor removals when no cursor exists yet', () => {
      // Arrange
      const manager = new SkillCollaborationManager()
      manager.openFile('app-1', 'file-1', 'alpha')
      const cursorCallback = vi.fn()
      manager.onCursorUpdate('file-1', cursorCallback)

      // Act
      mocks.emitSocketEvent('app-1', 'collaboration_update', {
        type: 'skill_cursor',
        userId: 'user-1',
        timestamp: 123,
        data: { file_id: 'file-1', start: null, end: null },
      })

      // Assert
      expect(cursorCallback).toHaveBeenCalledTimes(1)
      expect(cursorCallback).toHaveBeenCalledWith({})
    })
  })

  // Scenario: public emitters should respect connection state and reconnect behavior.
  describe('Public Emitters', () => {
    it('should emit cursor, file saved, tree, sync, and active events only when connected', () => {
      // Arrange
      const manager = new SkillCollaborationManager()
      const socket = mocks.getSocket('app-1')
      manager.setActiveFile('app-1', 'file-1', true)

      // Act
      expect(manager.requestSync('file-1')).toBe(false)
      manager.emitCursorUpdate('file-1', { start: 1, end: 2 })
      manager.emitFileSaved('file-1', 'alpha')
      manager.emitTreeUpdate('', { ignored: true })
      expect(mocks.emitWithAuthGuard).not.toHaveBeenCalled()

      socket.connected = true
      vi.clearAllMocks()

      // Act
      expect(manager.requestSync('file-1')).toBe(true)
      manager.emitCursorUpdate('file-1', { start: 1, end: 2 })
      manager.emitCursorUpdate('file-1', null)
      manager.emitFileSaved('file-1', 'alpha', { author: 'bot' })
      manager.emitTreeUpdate('app-1', { kind: 'refresh' })
      manager.setActiveFile('app-1', 'file-1', false)

      // Assert
      expect(mocks.emitWithAuthGuard).toHaveBeenCalledWith(
        socket,
        'collaboration_event',
        expect.objectContaining({
          type: 'skill_sync_request',
          data: { file_id: 'file-1' },
        }),
      )
      expect(mocks.emitWithAuthGuard).toHaveBeenCalledWith(
        socket,
        'collaboration_event',
        expect.objectContaining({
          type: 'skill_cursor',
          data: { file_id: 'file-1', start: 1, end: 2 },
        }),
      )
      expect(mocks.emitWithAuthGuard).toHaveBeenCalledWith(
        socket,
        'collaboration_event',
        expect.objectContaining({
          type: 'skill_cursor',
          data: { file_id: 'file-1', start: null, end: null },
        }),
      )
      expect(mocks.emitWithAuthGuard).toHaveBeenCalledWith(
        socket,
        'collaboration_event',
        expect.objectContaining({
          type: 'skill_file_saved',
          data: { file_id: 'file-1', content: 'alpha', metadata: { author: 'bot' } },
        }),
      )
      expect(mocks.emitWithAuthGuard).toHaveBeenCalledWith(
        socket,
        'collaboration_event',
        expect.objectContaining({
          type: 'skill_tree_update',
          data: { kind: 'refresh' },
        }),
      )
      expect(mocks.emitWithAuthGuard).toHaveBeenCalledWith(
        socket,
        'collaboration_event',
        expect.objectContaining({
          type: 'skill_file_active',
          data: { file_id: 'file-1', active: false },
        }),
      )
    })

    it('should replay active file and pending resync requests after reconnect', () => {
      // Arrange
      const manager = new SkillCollaborationManager()
      manager.openFile('app-1', 'file-1', 'alpha')
      manager.setActiveFile('app-1', 'file-1', true)
      const socket = mocks.getSocket('app-1')

      // Act
      socket.connected = true
      mocks.emitSocketEvent('app-1', 'connect')
      vi.clearAllMocks()
      mocks.emitSocketEvent('app-1', 'connect')

      // Assert
      expect(mocks.emitWithAuthGuard).toHaveBeenCalledOnce()
      expect(mocks.emitWithAuthGuard).toHaveBeenCalledWith(
        socket,
        'collaboration_event',
        expect.objectContaining({
          type: 'skill_file_active',
          data: { file_id: 'file-1', active: true },
        }),
      )
    })

    it('should clear cursor state on final close', () => {
      // Arrange
      const manager = new SkillCollaborationManager()
      manager.openFile('app-1', 'file-1', 'alpha')
      const cursorCallback = vi.fn()
      manager.onCursorUpdate('file-1', cursorCallback)
      mocks.emitSocketEvent('app-1', 'collaboration_update', {
        type: 'skill_cursor',
        userId: 'user-1',
        timestamp: 123,
        data: { file_id: 'file-1', start: 1, end: 4 },
      })

      // Act
      manager.closeFile('file-1')

      // Assert
      expect(cursorCallback).toHaveBeenNthCalledWith(3, {})
      expect(manager.isFileCollaborative('file-1')).toBe(false)
    })

    it('should return noop unsubscribe handlers for missing files or cleared sync registrations', () => {
      // Arrange
      const manager = new SkillCollaborationManager()
      const missingSubscriberOff = manager.subscribe('missing-file', vi.fn())
      const emptyCursorOff = manager.onCursorUpdate('', vi.fn())
      const syncOff = manager.onSyncRequest('file-1', vi.fn())
      manager.openFile('app-1', 'file-1', 'alpha')
      manager.openFile('app-2', 'file-2', 'beta')

      // Act
      missingSubscriberOff()
      emptyCursorOff()
      syncOff()

      // Assert
      expect(manager.isFileCollaborative('file-1')).toBe(false)
      expect(manager.isFileCollaborative('file-2')).toBe(true)
    })

    it('should not emit reconnect side effects when there is no active file or pending sync', () => {
      // Arrange
      const manager = new SkillCollaborationManager()
      mocks.getSocket('app-1').connected = true
      manager.onTreeUpdate('app-1', vi.fn())
      vi.clearAllMocks()

      // Act
      mocks.emitSocketEvent('app-1', 'connect')

      // Assert
      expect(mocks.emitWithAuthGuard).not.toHaveBeenCalled()
    })
  })
})
