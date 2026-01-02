import { isInWorkflowPage, VIBE_COMMAND_EVENT } from '@/app/components/workflow/constants'
import i18n from '@/i18n-config/i18next-config'
import { registerCommands, unregisterCommands } from './command-bus'
import { vibeCommand } from './vibe'

vi.mock('@/i18n-config/i18next-config', () => ({
  default: {
    t: vi.fn((key: string, options?: Record<string, unknown>) => {
      if (!options)
        return key
      return `${key}:${JSON.stringify(options)}`
    }),
  },
}))

vi.mock('@/app/components/workflow/constants', async () => {
  const actual = await vi.importActual<typeof import('@/app/components/workflow/constants')>(
    '@/app/components/workflow/constants',
  )
  return {
    ...actual,
    isInWorkflowPage: vi.fn(),
  }
})

vi.mock('./command-bus', () => ({
  registerCommands: vi.fn(),
  unregisterCommands: vi.fn(),
}))

const mockedIsInWorkflowPage = vi.mocked(isInWorkflowPage)
const mockedRegisterCommands = vi.mocked(registerCommands)
const mockedUnregisterCommands = vi.mocked(unregisterCommands)
const mockedT = vi.mocked(i18n.t)

type CommandArgs = { dsl?: string }
type CommandMap = Record<string, (args?: CommandArgs) => void | Promise<void>>

beforeEach(() => {
  vi.clearAllMocks()
})

// Command availability, search, and registration behavior for workflow vibe.
describe('vibeCommand', () => {
  // Availability mirrors workflow page detection.
  describe('availability', () => {
    it('should return true when on workflow page', () => {
      // Arrange
      mockedIsInWorkflowPage.mockReturnValue(true)

      // Act
      const available = vibeCommand.isAvailable?.()

      // Assert
      expect(available).toBe(true)
    })

    it('should return false when not on workflow page', () => {
      // Arrange
      mockedIsInWorkflowPage.mockReturnValue(false)

      // Act
      const available = vibeCommand.isAvailable?.()

      // Assert
      expect(available).toBe(false)
    })
  })

  // Search results depend on provided arguments.
  describe('search', () => {
    it('should return hint description when args are empty', async () => {
      // Arrange
      mockedIsInWorkflowPage.mockReturnValue(true)

      // Act
      const result = await vibeCommand.search('   ', 'en')

      // Assert
      expect(result).toHaveLength(1)
      const [item] = result
      expect(item.description).toContain('gotoAnything.actions.vibeHint')
      expect(item.data?.args?.dsl).toBe('')
      expect(mockedT).toHaveBeenCalledWith(
        'gotoAnything.actions.vibeHint',
        expect.objectContaining({ prompt: expect.any(String), lng: 'en', ns: 'app' }),
      )
    })

    it('should return default description when args are provided', async () => {
      // Arrange
      mockedIsInWorkflowPage.mockReturnValue(true)

      // Act
      const result = await vibeCommand.search(' make a flow ', 'en')

      // Assert
      expect(result).toHaveLength(1)
      const [item] = result
      expect(item.description).toContain('gotoAnything.actions.vibeDesc')
      expect(item.data?.args?.dsl).toBe('make a flow')
    })
  })

  // Command registration and event dispatching.
  describe('registration', () => {
    it('should register the workflow vibe command', () => {
      // Act
      expect(vibeCommand.register).toBeDefined()
      vibeCommand.register?.({})

      // Assert
      expect(mockedRegisterCommands).toHaveBeenCalledTimes(1)
      const commands = mockedRegisterCommands.mock.calls[0]?.[0] as CommandMap
      expect(commands['workflow.vibe']).toEqual(expect.any(Function))
    })

    it('should dispatch vibe event when command handler runs', async () => {
      // Arrange
      const dispatchSpy = vi.spyOn(document, 'dispatchEvent')
      expect(vibeCommand.register).toBeDefined()
      vibeCommand.register?.({})
      expect(mockedRegisterCommands).toHaveBeenCalledTimes(1)
      const commands = mockedRegisterCommands.mock.calls[0]?.[0] as CommandMap

      try {
        // Act
        await commands['workflow.vibe']?.({ dsl: 'hello' })

        // Assert
        expect(dispatchSpy).toHaveBeenCalledTimes(1)
        const event = dispatchSpy.mock.calls[0][0] as CustomEvent
        expect(event.type).toBe(VIBE_COMMAND_EVENT)
        expect(event.detail).toEqual({ dsl: 'hello' })
      }
      finally {
        dispatchSpy.mockRestore()
      }
    })

    it('should unregister workflow vibe command', () => {
      // Act
      expect(vibeCommand.unregister).toBeDefined()
      vibeCommand.unregister?.()

      // Assert
      expect(mockedUnregisterCommands).toHaveBeenCalledWith(['workflow.vibe'])
    })
  })
})
