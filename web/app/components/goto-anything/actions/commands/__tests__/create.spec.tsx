import { executeCommand } from '../command-bus'
import { createCommand } from '../create'

// Stub the icon imports — these are React components we don't render here.
vi.mock('@remixicon/react', () => ({
  RiChat3Line: () => null,
  RiNodeTree: () => null,
}))

// We spy on the store at module scope so the `create.open` handler that
// register() pushes into the command bus can be observed by the tests.
const mockOpenGenerator = vi.fn()
vi.mock('@/app/components/workflow/workflow-generator/store', () => ({
  useWorkflowGeneratorStore: {
    getState: () => ({ openGenerator: mockOpenGenerator }),
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
  })

  describe('register() — `create.open` command-bus handler', () => {
    // Register populates the global command bus; tests below rely on it so we
    // run it once per case and clean up via the symmetric unregister().
    beforeEach(() => {
      createCommand.register?.({} as never)
    })

    afterEach(() => {
      createCommand.unregister?.()
    })

    // Default path: when the user is not in a workflow Studio page, the
    // handler must open the modal without a currentAppId so the modal only
    // offers "Create new app".
    it('should open the generator with no current-app context outside Studio', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { pathname: '/apps' },
      })

      await executeCommand('create.open', { mode: 'workflow' })

      expect(mockOpenGenerator).toHaveBeenCalledWith({
        mode: 'workflow',
        currentAppId: null,
        currentAppMode: null,
      })
    })

    // Studio path: the handler must read the app id straight out of the URL
    // and pass it through so the modal can show "Apply to current draft".
    it('should capture the current app id when invoked from a workflow Studio URL', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { pathname: '/app/abc-123/workflow' },
      })

      await executeCommand('create.open', { mode: 'advanced-chat' })

      expect(mockOpenGenerator).toHaveBeenCalledWith({
        mode: 'advanced-chat',
        currentAppId: 'abc-123',
        currentAppMode: 'advanced-chat',
      })
    })

    // Defensive fallback: if a caller forgets to pass a mode (or passes none),
    // the handler must still open the generator with a safe default rather
    // than crashing the goto-anything dialog.
    it('should default to workflow mode when no args are passed', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { pathname: '/apps' },
      })

      await executeCommand('create.open')

      expect(mockOpenGenerator).toHaveBeenCalledWith({
        mode: 'workflow',
        currentAppId: null,
        currentAppMode: null,
      })
    })

    // Studio sub-routes (/app/<id>/workflow/edit, etc.) still need to be
    // treated as Studio context — the regex must anchor only at the start.
    it('should still match Studio context for nested workflow sub-paths', async () => {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { pathname: '/app/xyz/workflow/run-history' },
      })

      await executeCommand('create.open', { mode: 'workflow' })

      expect(mockOpenGenerator).toHaveBeenCalledWith({
        mode: 'workflow',
        currentAppId: 'xyz',
        currentAppMode: 'workflow',
      })
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
