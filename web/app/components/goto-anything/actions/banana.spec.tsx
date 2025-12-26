import type { CommandSearchResult, SearchResult } from './types'
import { isInWorkflowPage } from '@/app/components/workflow/constants'
import i18n from '@/i18n-config/i18next-config'
import { bananaAction } from './banana'

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

const mockedIsInWorkflowPage = vi.mocked(isInWorkflowPage)
const mockedT = vi.mocked(i18n.t)

const getCommandResult = (item: SearchResult): CommandSearchResult => {
  expect(item.type).toBe('command')
  return item as CommandSearchResult
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Search behavior for the banana action.
describe('bananaAction', () => {
  // Search results depend on workflow context and input content.
  describe('search', () => {
    it('should return no results when not on workflow page', async () => {
      // Arrange
      mockedIsInWorkflowPage.mockReturnValue(false)

      // Act
      const result = await bananaAction.search('', '', 'en')

      // Assert
      expect(result).toEqual([])
    })

    it('should return hint description when input is blank', async () => {
      // Arrange
      mockedIsInWorkflowPage.mockReturnValue(true)

      // Act
      const result = await bananaAction.search('', '   ', 'en')

      // Assert
      expect(result).toHaveLength(1)
      const [item] = result
      const commandItem = getCommandResult(item)
      expect(item.description).toContain('app.gotoAnything.actions.vibeHint')
      expect(commandItem.data.args?.dsl).toBe('')
      expect(mockedT).toHaveBeenCalledWith(
        'app.gotoAnything.actions.vibeHint',
        expect.objectContaining({ prompt: expect.any(String), lng: 'en' }),
      )
    })

    it('should return default description when input is provided', async () => {
      // Arrange
      mockedIsInWorkflowPage.mockReturnValue(true)

      // Act
      const result = await bananaAction.search('', ' build a flow ', 'en')

      // Assert
      expect(result).toHaveLength(1)
      const [item] = result
      const commandItem = getCommandResult(item)
      expect(item.description).toContain('app.gotoAnything.actions.vibeDesc')
      expect(commandItem.data.args?.dsl).toBe('build a flow')
    })
  })
})
