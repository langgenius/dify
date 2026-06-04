import { executeCommand } from '../command-bus'
import { createCommand } from '../create'

// Stub the icon imports — these are React components we don't render here.
vi.mock('@remixicon/react', () => ({
  RiChat3Line: () => null,
  RiNodeTree: () => null,
}))

// search() localises its labels via getI18n(); echo the key back so the
// filtering/payload assertions stay deterministic without a real i18n init.
vi.mock('react-i18next', () => ({
  getI18n: () => ({ t: (key: string) => key }),
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
    // An empty arg list should surface every option; the submenu uses this to
    // render its initial list when the user types just `/create`.
    it('should surface both workflow and chatflow when args is empty', async () => {
      const results = await createCommand.search('')
      expect(results.map(r => r.id)).toEqual(['create-workflow', 'create-chatflow'])
    })

    // Typing a partial keyword should narrow the list and each result should
    // carry the right command-bus payload so the navigation hook can fire it.
    it('should filter by query and attach the right command payload', async () => {
      const results = await createCommand.search('chat')
      expect(results.map(r => r.id)).toEqual(['create-chatflow'])
      expect(results[0]!.data.command).toBe('create.open')
      expect(results[0]!.data.args).toEqual({ mode: 'advanced-chat' })
    })

    // A non-matching query returns an empty list rather than throwing, so the
    // goto-anything dialog can render an empty-state without special-casing.
    it('should return an empty list when the query matches nothing', async () => {
      const results = await createCommand.search('zzz-no-match')
      expect(results).toEqual([])
    })

    // Labels/descriptions must be localised through i18n (ns: 'app') rather
    // than hardcoded English, so the palette renders in the user's language.
    it('should source titles and descriptions from i18n keys', async () => {
      const results = await createCommand.search('')
      expect(results[0]!.title).toBe('gotoAnything.actions.createWorkflow')
      expect(results[0]!.description).toBe('gotoAnything.actions.createWorkflowDesc')
      expect(results[1]!.title).toBe('gotoAnything.actions.createChatflow')
      expect(results[1]!.description).toBe('gotoAnything.actions.createChatflowDesc')
    })

    // The localised label is also searchable, not just the id — a token that
    // appears only in the (mocked) title key still narrows the list, proving
    // the filter consults the translated label.
    it('should filter by the localised label, not just the id', async () => {
      const results = await createCommand.search('createChatflow')
      expect(results.map(r => r.id)).toEqual(['create-chatflow'])
    })
  })

  describe('register() — `create.open` command-bus handler', () => {
    // Register populates the global command bus; tests below rely on it so we
    // run it once per case and clean up via the symmetric unregister(). Reset
    // the app-store state so each case controls its own Studio context.
    beforeEach(() => {
      mockAppStore.appDetail = undefined
      createCommand.register?.({} as never)
    })

    afterEach(() => {
      createCommand.unregister?.()
    })

    // No Studio app open (e.g. /create from the apps list) — the modal opens
    // for new-app creation only, with just the requested mode.
    it('should open the generator with only the requested mode when no Studio app is open', async () => {
      await executeCommand('create.open', { mode: 'workflow' })

      expect(mockOpenGenerator).toHaveBeenCalledWith({ mode: 'workflow' })
    })

    // In-Studio create-and-apply: when a graph-based app is open and its mode
    // matches the picked mode, the handler threads id + mode through so the
    // modal can offer "Apply to current draft".
    it('should thread the current app context when a matching Studio app is open', async () => {
      mockAppStore.appDetail = { id: 'abc-123', mode: 'workflow' }

      await executeCommand('create.open', { mode: 'workflow' })

      expect(mockOpenGenerator).toHaveBeenCalledWith({
        mode: 'workflow',
        currentAppId: 'abc-123',
        currentAppMode: 'workflow',
      })
    })

    // Mode mismatch (Workflow Studio open, but the user picked Chatflow) must
    // NOT capture currentAppId — applying a chatflow graph onto a workflow
    // draft is the dead-end we explicitly avoid, so it stays new-app only.
    it('should fall back to new-app only when the picked mode differs from the open app', async () => {
      mockAppStore.appDetail = { id: 'abc-123', mode: 'workflow' }

      await executeCommand('create.open', { mode: 'advanced-chat' })

      expect(mockOpenGenerator).toHaveBeenCalledWith({ mode: 'advanced-chat' })
    })

    // Non-graph Studio apps (Chat / Agent / Completion) have no canvas to
    // apply onto, so the handler ignores them and opens new-app only.
    it('should ignore non-graph app modes and open new-app only', async () => {
      mockAppStore.appDetail = { id: 'abc-123', mode: 'chat' }

      await executeCommand('create.open', { mode: 'workflow' })

      expect(mockOpenGenerator).toHaveBeenCalledWith({ mode: 'workflow' })
    })

    // Defensive fallback: if a caller forgets to pass a mode (or passes none),
    // the handler must still open the generator with a safe default rather
    // than crashing the goto-anything dialog.
    it('should default to workflow mode when no args are passed', async () => {
      await executeCommand('create.open')

      expect(mockOpenGenerator).toHaveBeenCalledWith({ mode: 'workflow' })
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
