import { isInWorkflowPage, VIBE_COMMAND_EVENT } from '@/app/components/workflow/constants'
import i18n from '@/i18n-config/i18next-config'
import { bananaCommand } from './banana'
import { registerCommands, unregisterCommands } from './command-bus'

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

// Command availability, search, and registration behavior for banana command.
describe('bananaCommand', () => {
  // Command metadata mirrors the static definition.
  describe('metadata', () => {
    it('should expose name, mode, and description', () => {
      // Assert
      expect(bananaCommand.name).toBe('banana')
      expect(bananaCommand.mode).toBe('submenu')
      expect(bananaCommand.description).toContain('gotoAnything.actions.vibeDesc')
    })
  })

  // Availability mirrors workflow page detection.
  describe('availability', () => {
    it('should return true when on workflow page', () => {
      // Arrange
      mockedIsInWorkflowPage.mockReturnValue(true)

      // Act
      const available = bananaCommand.isAvailable?.()

      // Assert
      expect(available).toBe(true)
      expect(mockedIsInWorkflowPage).toHaveBeenCalledTimes(1)
    })

    it('should return false when not on workflow page', () => {
      // Arrange
      mockedIsInWorkflowPage.mockReturnValue(false)

      // Act
      const available = bananaCommand.isAvailable?.()

      // Assert
      expect(available).toBe(false)
      expect(mockedIsInWorkflowPage).toHaveBeenCalledTimes(1)
    })
  })

  // Search results depend on provided arguments.
  describe('search', () => {
    it('should return hint description when args are empty', async () => {
      // Arrange
      mockedIsInWorkflowPage.mockReturnValue(true)

      // Act
      const result = await bananaCommand.search('   ')

      // Assert
      expect(result).toHaveLength(1)
      const [item] = result
      expect(item.description).toContain('gotoAnything.actions.vibeHint')
      expect(item.data?.args?.dsl).toBe('')
      expect(item.data?.command).toBe('workflow.vibe')
      expect(mockedT).toHaveBeenCalledWith(
        'gotoAnything.actions.vibeTitle',
        expect.objectContaining({ lng: 'en', ns: 'app' }),
      )
      expect(mockedT).toHaveBeenCalledWith(
        'gotoAnything.actions.vibeHint',
        expect.objectContaining({ prompt: expect.any(String), lng: 'en', ns: 'app' }),
      )
    })

    it('should return default description when args are provided', async () => {
      // Arrange
      mockedIsInWorkflowPage.mockReturnValue(true)

      // Act
      const result = await bananaCommand.search(' make a flow ', 'fr')

      // Assert
      expect(result).toHaveLength(1)
      const [item] = result
      expect(item.description).toContain('gotoAnything.actions.vibeDesc')
      expect(item.data?.args?.dsl).toBe('make a flow')
      expect(item.data?.command).toBe('workflow.vibe')
      expect(mockedT).toHaveBeenCalledWith(
        'gotoAnything.actions.vibeTitle',
        expect.objectContaining({ lng: 'fr', ns: 'app' }),
      )
      expect(mockedT).toHaveBeenCalledWith(
        'gotoAnything.actions.vibeDesc',
        expect.objectContaining({ lng: 'fr', ns: 'app' }),
      )
    })

    it('should fall back to Banana when title translation is empty', async () => {
      // Arrange
      mockedIsInWorkflowPage.mockReturnValue(true)
      mockedT.mockImplementationOnce(() => '')

      // Act
      const result = await bananaCommand.search('make a plan')

      // Assert
      expect(result).toHaveLength(1)
      expect(result[0]?.title).toBe('Banana')
    })
  })

  // Command registration and event dispatching.
  describe('registration', () => {
    it('should register the workflow vibe command', () => {
      // Act
      expect(bananaCommand.register).toBeDefined()
      bananaCommand.register?.({})

      // Assert
      expect(mockedRegisterCommands).toHaveBeenCalledTimes(1)
      const commands = mockedRegisterCommands.mock.calls[0]?.[0] as CommandMap
      expect(commands['workflow.vibe']).toEqual(expect.any(Function))
    })

    it('should dispatch vibe event when command handler runs', async () => {
      // Arrange
      const dispatchSpy = vi.spyOn(document, 'dispatchEvent')
      expect(bananaCommand.register).toBeDefined()
      bananaCommand.register?.({})
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
      expect(bananaCommand.unregister).toBeDefined()
      bananaCommand.unregister?.()

      // Assert
      expect(mockedUnregisterCommands).toHaveBeenCalledWith(['workflow.vibe'])
    })
  })
})
