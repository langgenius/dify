import { executeCommand } from '../command-bus'
import { createCommand } from '../create'

// Stub the icon imports — these are React components we don't render here.
vi.mock('@remixicon/react', () => ({
  RiChat3Line: () => null,
  RiNodeTree: () => null,
  RiSparkling2Line: () => null,
}))
// We spy on the store at module scope so the `create.open` handler that
// register() pushes into the command bus can be observed by the tests.
const mockOpenGenerator = vi.fn()
vi.mock('@/app/components/workflow/workflow-generator/store', () => ({
  useWorkflowGeneratorStore: {
    getState: () => ({ openGenerator: mockOpenGenerator }),
  },
}))

// Controllable app-store state — the handler reads `appDetail` to decide
// whether to thread the current Studio app through to the generator. Mutated
// per-test; getState() reads it lazily so updates land after the mock factory.
const mockAppStore: { appDetail: { id: string, mode: string } | undefined } = {
  appDetail: undefined,
}
vi.mock('@/app/components/app/store', () => ({
  useStore: {
    getState: () => ({ appDetail: mockAppStore.appDetail }),
  },
}))

describe('/create slash command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handler metadata', () => {
    // The slash registry relies on this metadata to route /create through the
    // submenu UX rather than executing immediately.
    it('should expose submenu mode with the expected name and aliases', () => {
      expect(createCommand.mode).toBe('submenu')
      expect(createCommand.name).toBe('create')
      expect(createCommand.aliases).toEqual(['new', 'generate'])
    })
  })

  describe('search()', () => {
    // An empty arg list should surface every option (Auto first); the submenu
    // uses this to render its initial list when the user types just `/create`.
    it('should surface auto, workflow and chatflow when args is empty', async () => {
      const results = await createCommand.search('')
      expect(results.map(r => r.id)).toEqual(['create-auto', 'create-workflow', 'create-chatflow'])
    })

    // Typing a partial keyword should narrow the list and each result should
    // carry the right command-bus payload so the navigation hook can fire it.
    it('should filter by query and attach the right command payload', async () => {
      const results = await createCommand.search('chat')
      expect(results.map(r => r.id)).toEqual(['create-chatflow'])
      expect(results[0]!.data.command).toBe('create.open')
      expect(results[0]!.data.args).toEqual({ mode: 'advanced-chat', auto: false, instruction: '' })
    })

    // The Auto option carries the auto flag so the modal opens in auto-mode.
    it('should flag the auto option so the planner picks the app type', async () => {
      const results = await createCommand.search('')
      expect(results[0]!.id).toBe('create-auto')
      expect(results[0]!.data.args).toEqual({ mode: 'advanced-chat', auto: true, instruction: '' })
    })

    // A non-matching single-token query returns an empty list rather than
    // throwing, so the goto-anything dialog can render an empty-state.
    it('should return an empty list when a single-token query matches nothing', async () => {
      const results = await createCommand.search('zzz')
      expect(results).toEqual([])
    })

    // Labels/descriptions must be localised through i18n (ns: 'app') rather
    // than hardcoded English, so the palette renders in the user's language.
    it('should source titles and descriptions from i18n keys', async () => {
      const results = await createCommand.search('')
      expect(results[1]!.title).toBe('gotoAnything.actions.createWorkflow')
      expect(results[1]!.description).toBe('gotoAnything.actions.createWorkflowDesc')
      expect(results[2]!.title).toBe('gotoAnything.actions.createChatflow')
      expect(results[2]!.description).toBe('gotoAnything.actions.createChatflowDesc')
    })

    // The localised label is also searchable, not just the id — a token that
    // appears only in the (mocked) title key still narrows the list.
    it('should filter by the localised label, not just the id', async () => {
      const results = await createCommand.search('createChatflow')
      expect(results.map(r => r.id)).toEqual(['create-chatflow'])
    })

    // Inline capture: a leading mode word selects that option and the rest of
    // the text becomes the pre-filled instruction surfaced as the description.
    it('should capture a trailing instruction when the first word names a mode', async () => {
      const results = await createCommand.search('workflow summarize a URL')
      expect(results.map(r => r.id)).toEqual(['create-workflow'])
      expect(results[0]!.data.args).toEqual({ mode: 'workflow', auto: false, instruction: 'summarize a URL' })
      expect(results[0]!.description).toBe('summarize a URL')
    })

    // Inline capture without a leading mode word keeps every option, each
    // pre-filled with the full text so the user just picks the type.
    it('should keep all options with the full text when no leading mode word', async () => {
      const results = await createCommand.search('summarize a URL')
      expect(results.map(r => r.id)).toEqual(['create-auto', 'create-workflow', 'create-chatflow'])
      results.forEach((r) => {
        expect((r.data.args as { instruction: string }).instruction).toBe('summarize a URL')
      })
    })
  })

  describe('register() — `create.open` command-bus handler', () => {
    beforeEach(() => {
      mockAppStore.appDetail = undefined
      createCommand.register?.({} as never)
    })

    afterEach(() => {
      createCommand.unregister?.()
    })

    // No Studio app open — the modal opens for new-app creation only.
    it('should open the generator with the requested mode when no Studio app is open', async () => {
      await executeCommand('create.open', { mode: 'workflow' })

      expect(mockOpenGenerator).toHaveBeenCalledWith({ mode: 'workflow', autoMode: false, initialInstruction: '' })
    })

    // Inline-captured instruction threads through to the modal.
    it('should thread the captured instruction through to the generator', async () => {
      await executeCommand('create.open', { mode: 'workflow', instruction: 'summarize a URL' })

      expect(mockOpenGenerator).toHaveBeenCalledWith({ mode: 'workflow', autoMode: false, initialInstruction: 'summarize a URL' })
    })

    // Auto-mode always creates a new app, even with a matching Studio open,
    // because the planner may resolve a different type than the open canvas.
    it('should open new-app auto-mode even when a matching Studio app is open', async () => {
      mockAppStore.appDetail = { id: 'abc-123', mode: 'advanced-chat' }

      await executeCommand('create.open', { mode: 'advanced-chat', auto: true })

      expect(mockOpenGenerator).toHaveBeenCalledWith({ mode: 'advanced-chat', autoMode: true, initialInstruction: '' })
    })

    // In-Studio create-and-apply: a matching graph-based app threads id + mode
    // through so the modal can offer "Apply to current draft".
    it('should thread the current app context when a matching Studio app is open', async () => {
      mockAppStore.appDetail = { id: 'abc-123', mode: 'workflow' }

      await executeCommand('create.open', { mode: 'workflow' })

      expect(mockOpenGenerator).toHaveBeenCalledWith({
        mode: 'workflow',
        currentAppId: 'abc-123',
        currentAppMode: 'workflow',
        initialInstruction: '',
      })
    })

    // Mode mismatch must NOT capture currentAppId — applying a chatflow graph
    // onto a workflow draft is the dead-end we explicitly avoid.
    it('should fall back to new-app only when the picked mode differs from the open app', async () => {
      mockAppStore.appDetail = { id: 'abc-123', mode: 'workflow' }

      await executeCommand('create.open', { mode: 'advanced-chat' })

      expect(mockOpenGenerator).toHaveBeenCalledWith({ mode: 'advanced-chat', autoMode: false, initialInstruction: '' })
    })

    // Non-graph Studio apps (Chat / Agent / Completion) have no canvas to apply
    // onto, so the handler ignores them and opens new-app only.
    it('should ignore non-graph app modes and open new-app only', async () => {
      mockAppStore.appDetail = { id: 'abc-123', mode: 'chat' }

      await executeCommand('create.open', { mode: 'workflow' })

      expect(mockOpenGenerator).toHaveBeenCalledWith({ mode: 'workflow', autoMode: false, initialInstruction: '' })
    })

    // Defensive fallback: a missing mode still opens the generator safely.
    it('should default to workflow mode when no args are passed', async () => {
      await executeCommand('create.open')

      expect(mockOpenGenerator).toHaveBeenCalledWith({ mode: 'workflow', autoMode: false, initialInstruction: '' })
    })
  })

  describe('unregister()', () => {
    // After unregister, the bus must drop the handler so a later execute call
    // becomes a silent no-op (prevents stale references between mounts).
    it('should remove the command-bus handler so it stops firing', async () => {
      createCommand.register?.({} as never)
      createCommand.unregister?.()

      Object.defineProperty(window, 'location', {
        writable: true,
        value: { pathname: '/apps' },
      })

      await executeCommand('create.open', { mode: 'workflow' })
      expect(mockOpenGenerator).not.toHaveBeenCalled()
    })
  })
})
