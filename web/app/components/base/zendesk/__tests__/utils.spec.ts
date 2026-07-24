import { openZendeskWindow, setZendeskConversationFields } from '../utils'

describe('zendesk/utils', () => {
  const mockZE = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    window.zE = mockZE
  })

  afterEach(() => {
    vi.useRealTimers()
    window.zE = mockZE
  })

  describe('setZendeskConversationFields', () => {
    it('sets conversation fields in Cloud when zE exists', () => {
      const fields = [
        { id: 'field1', value: 'value1' },
        { id: 'field2', value: 'value2' },
      ]
      const callback = vi.fn()

      setZendeskConversationFields(fields, 'CLOUD', callback)

      expect(window.zE).toHaveBeenCalledWith(
        'messenger:set',
        'conversationFields',
        fields,
        callback,
      )
    })

    it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
      'does not set fields when deployment edition is %s',
      (deploymentEdition) => {
        setZendeskConversationFields([{ id: 'field1', value: 'value1' }], deploymentEdition)

        expect(window.zE).not.toHaveBeenCalled()
      },
    )

    it('works without a callback', () => {
      const fields = [{ id: 'field1', value: 'value1' }]

      setZendeskConversationFields(fields, 'CLOUD')

      expect(window.zE).toHaveBeenCalledWith(
        'messenger:set',
        'conversationFields',
        fields,
        undefined,
      )
    })
  })

  describe('openZendeskWindow', () => {
    it('shows and opens the messenger in Cloud when zE exists', () => {
      openZendeskWindow('CLOUD')

      expect(window.zE).toHaveBeenCalledWith('messenger', 'show')
      expect(window.zE).toHaveBeenCalledWith('messenger', 'open')
    })

    it('retries opening until zE is ready', () => {
      vi.useFakeTimers()
      window.zE = undefined

      openZendeskWindow('CLOUD', { interval: 10, retries: 2 })
      window.zE = mockZE
      vi.advanceTimersByTime(10)

      expect(window.zE).toHaveBeenCalledWith('messenger', 'show')
      expect(window.zE).toHaveBeenCalledWith('messenger', 'open')
    })

    it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
      'does not open when deployment edition is %s',
      (deploymentEdition) => {
        openZendeskWindow(deploymentEdition)

        expect(window.zE).not.toHaveBeenCalled()
      },
    )
  })
})
