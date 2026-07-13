import { executeCommand } from '../command-bus'
import { refineCommand } from '../refine'

// Stub the icon import — it's a React component we don't render here.
vi.mock('@remixicon/react', () => ({
  RiSparkling2Line: () => null,
}))
// Spy on the generator store so we can observe what /refine opens it with.
const mockOpenGenerator = vi.fn()
vi.mock('@/app/components/workflow/workflow-generator/store', () => ({
  useWorkflowGeneratorStore: {
    getState: () => ({ openGenerator: mockOpenGenerator }),
  },
}))

// Controllable app-store state — /refine reads appDetail to gate availability
// and to pick the mode + id it refines. Mutated per-test; read lazily.
const mockAppStore: { appDetail: { id: string; mode: string } | undefined } = {
  appDetail: undefined,
}
vi.mock('@/app/components/app/store', () => ({
  useStore: {
    getState: () => ({ appDetail: mockAppStore.appDetail }),
  },
}))

describe('/refine slash command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAppStore.appDetail = undefined
  })

  describe('handler metadata', () => {
    it('should be a direct command named refine with the expected alias', () => {
      expect(refineCommand.mode).toBe('direct')
      expect(refineCommand.name).toBe('refine')
      expect(refineCommand.aliases).toEqual(['improve'])
    })
  })

  describe('isAvailable()', () => {
    // /refine only makes sense inside a graph-based Studio — elsewhere there's
    // no draft graph to refine, so the command must hide itself.
    it('should be unavailable when no app is open', () => {
      expect(refineCommand.isAvailable?.()).toBe(false)
    })

    it('should be available in a Workflow Studio', () => {
      mockAppStore.appDetail = { id: 'app-1', mode: 'workflow' }
      expect(refineCommand.isAvailable?.()).toBe(true)
    })

    it('should be available in an Advanced-Chat Studio', () => {
      mockAppStore.appDetail = { id: 'app-1', mode: 'advanced-chat' }
      expect(refineCommand.isAvailable?.()).toBe(true)
    })

    it('should be unavailable for non-graph apps (chat / agent / completion)', () => {
      mockAppStore.appDetail = { id: 'app-1', mode: 'chat' }
      expect(refineCommand.isAvailable?.()).toBe(false)
    })
  })

  describe('execute()', () => {
    // The core behaviour: open the generator in refine intent, threading the
    // current app's id + mode so the modal fetches its draft as context.
    it('should open the generator in refine intent for a Workflow Studio', () => {
      mockAppStore.appDetail = { id: 'app-1', mode: 'workflow' }

      refineCommand.execute?.()

      expect(mockOpenGenerator).toHaveBeenCalledWith({
        intent: 'refine',
        mode: 'workflow',
        currentAppId: 'app-1',
        currentAppMode: 'workflow',
      })
    })

    it('should map advanced-chat apps to the advanced-chat generator mode', () => {
      mockAppStore.appDetail = { id: 'app-2', mode: 'advanced-chat' }

      refineCommand.execute?.()

      expect(mockOpenGenerator).toHaveBeenCalledWith({
        intent: 'refine',
        mode: 'advanced-chat',
        currentAppId: 'app-2',
        currentAppMode: 'advanced-chat',
      })
    })

    it('should be a no-op when no graph-based app is open', () => {
      mockAppStore.appDetail = { id: 'app-3', mode: 'chat' }

      refineCommand.execute?.()

      expect(mockOpenGenerator).not.toHaveBeenCalled()
    })
  })

  describe('search()', () => {
    // The submenu/result list renders one localised entry carrying the
    // refine.open command-bus payload.
    it('should return a single localised refine result', async () => {
      const results = await refineCommand.search('')
      expect(results).toHaveLength(1)
      expect(results[0]!.id).toBe('refine-current')
      expect(results[0]!.title).toBe('gotoAnything.actions.refineTitle')
      expect(results[0]!.data.command).toBe('refine.open')
    })
  })

  describe('register() — `refine.open` command-bus handler', () => {
    beforeEach(() => {
      refineCommand.register?.({} as never)
    })
    afterEach(() => {
      refineCommand.unregister?.()
    })

    it('should open the generator via the command bus too', async () => {
      mockAppStore.appDetail = { id: 'app-1', mode: 'workflow' }

      await executeCommand('refine.open', {})

      expect(mockOpenGenerator).toHaveBeenCalledWith({
        intent: 'refine',
        mode: 'workflow',
        currentAppId: 'app-1',
        currentAppMode: 'workflow',
      })
    })

    it('should stop firing after unregister', async () => {
      mockAppStore.appDetail = { id: 'app-1', mode: 'workflow' }
      refineCommand.unregister?.()

      await executeCommand('refine.open', {})

      expect(mockOpenGenerator).not.toHaveBeenCalled()
    })
  })
})
