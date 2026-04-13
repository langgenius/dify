import { registerCommands, unregisterCommands } from '../command-bus'
import { ZEN_TOGGLE_EVENT, zenCommand } from '../zen'

vi.mock('../command-bus')

vi.mock('react-i18next', () => ({
  getI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/workflow/constants', () => ({
  isInWorkflowPage: vi.fn(() => true),
}))

describe('zenCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct metadata', () => {
    expect(zenCommand.name).toBe('zen')
    expect(zenCommand.mode).toBe('direct')
    expect(zenCommand.execute).toBeDefined()
  })

  it('exports ZEN_TOGGLE_EVENT constant', () => {
    expect(ZEN_TOGGLE_EVENT).toBe('zen-toggle-maximize')
  })

  describe('isAvailable', () => {
    it('delegates to isInWorkflowPage', async () => {
      const { isInWorkflowPage } = vi.mocked(
        await import('@/app/components/workflow/constants'),
      )

      isInWorkflowPage.mockReturnValue(true)
      expect(zenCommand.isAvailable?.()).toBe(true)

      isInWorkflowPage.mockReturnValue(false)
      expect(zenCommand.isAvailable?.()).toBe(false)
    })
  })

  describe('execute', () => {
    it('dispatches custom zen-toggle event', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

      zenCommand.execute?.()

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: ZEN_TOGGLE_EVENT }),
      )
      dispatchSpy.mockRestore()
    })
  })

  describe('search', () => {
    it('returns single zen mode result', async () => {
      const results = await zenCommand.search('', 'en')

      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({
        id: 'zen',
        type: 'command',
        data: { command: 'workflow.zen', args: {} },
      })
    })
  })

  describe('register / unregister', () => {
    it('registers workflow.zen command', () => {
      zenCommand.register?.({} as Record<string, never>)

      expect(registerCommands).toHaveBeenCalledWith({ 'workflow.zen': expect.any(Function) })
    })

    it('unregisters workflow.zen command', () => {
      zenCommand.unregister?.()

      expect(unregisterCommands).toHaveBeenCalledWith(['workflow.zen'])
    })
  })
})
