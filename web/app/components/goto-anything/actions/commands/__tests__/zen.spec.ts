import { subscribeWorkflowCommand, WorkflowCommand } from '@/app/components/workflow/shortcuts/commands'
import { registerCommands, unregisterCommands } from '../command-bus'
import { zenCommand } from '../zen'

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
    it('emits the workflow canvas maximize command', () => {
      const listener = vi.fn()
      const unsubscribe = subscribeWorkflowCommand(WorkflowCommand.ToggleCanvasMaximize, listener)

      zenCommand.execute?.()

      expect(listener).toHaveBeenCalledTimes(1)
      unsubscribe()
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
