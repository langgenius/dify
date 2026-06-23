describe('zendesk/utils', () => {
  // Create mock for window.zE
  const mockZE = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    // Set up window.zE mock before each test
    window.zE = mockZE
  })

  afterEach(() => {
    vi.useRealTimers()
    // Clean up window.zE after each test
    window.zE = mockZE
  })

  describe('setZendeskConversationFields', () => {
    it('should call window.zE with correct arguments when not CE edition and zE exists', async () => {
      vi.doMock('@/config', () => ({ IS_CE_EDITION: false }))
      const { setZendeskConversationFields } = await import('../utils')

      const fields = [
        { id: 'field1', value: 'value1' },
        { id: 'field2', value: 'value2' },
      ]
      const callback = vi.fn()

      setZendeskConversationFields(fields, callback)

      expect(window.zE).toHaveBeenCalledWith(
        'messenger:set',
        'conversationFields',
        fields,
        callback,
      )
    })

    it('should not call window.zE when IS_CE_EDITION is true', async () => {
      vi.doMock('@/config', () => ({ IS_CE_EDITION: true }))
      const { setZendeskConversationFields } = await import('../utils')

      const fields = [{ id: 'field1', value: 'value1' }]

      setZendeskConversationFields(fields)

      expect(window.zE).not.toHaveBeenCalled()
    })

    it('should work without callback', async () => {
      vi.doMock('@/config', () => ({ IS_CE_EDITION: false }))
      const { setZendeskConversationFields } = await import('../utils')

      const fields = [{ id: 'field1', value: 'value1' }]

      setZendeskConversationFields(fields)

      expect(window.zE).toHaveBeenCalledWith(
        'messenger:set',
        'conversationFields',
        fields,
        undefined,
      )
    })
  })

  describe('setZendeskWidgetVisibility', () => {
    it('should call window.zE to show widget when visible is true', async () => {
      vi.doMock('@/config', () => ({ IS_CE_EDITION: false }))
      const { setZendeskWidgetVisibility } = await import('../utils')

      setZendeskWidgetVisibility(true)

      expect(window.zE).toHaveBeenCalledWith('messenger', 'show')
    })

    it('should call window.zE to hide widget when visible is false', async () => {
      vi.doMock('@/config', () => ({ IS_CE_EDITION: false }))
      const { setZendeskWidgetVisibility } = await import('../utils')

      setZendeskWidgetVisibility(false)

      expect(window.zE).toHaveBeenCalledWith('messenger', 'hide')
    })

    it('should not call window.zE when IS_CE_EDITION is true', async () => {
      vi.doMock('@/config', () => ({ IS_CE_EDITION: true }))
      const { setZendeskWidgetVisibility } = await import('../utils')

      setZendeskWidgetVisibility(true)

      expect(window.zE).not.toHaveBeenCalled()
    })
  })

  describe('toggleZendeskWindow', () => {
    it('should call window.zE to open messenger when open is true', async () => {
      vi.doMock('@/config', () => ({ IS_CE_EDITION: false }))
      const { toggleZendeskWindow } = await import('../utils')

      toggleZendeskWindow(true)

      expect(window.zE).toHaveBeenCalledWith('messenger', 'open')
    })

    it('should call window.zE to close messenger when open is false', async () => {
      vi.doMock('@/config', () => ({ IS_CE_EDITION: false }))
      const { toggleZendeskWindow } = await import('../utils')

      toggleZendeskWindow(false)

      expect(window.zE).toHaveBeenCalledWith('messenger', 'close')
    })

    it('should not call window.zE when IS_CE_EDITION is true', async () => {
      vi.doMock('@/config', () => ({ IS_CE_EDITION: true }))
      const { toggleZendeskWindow } = await import('../utils')

      toggleZendeskWindow(true)

      expect(window.zE).not.toHaveBeenCalled()
    })
  })

  describe('openZendeskWindow', () => {
    it('should show and open messenger when zE exists', async () => {
      vi.doMock('@/config', () => ({ IS_CE_EDITION: false }))
      const { openZendeskWindow } = await import('../utils')

      openZendeskWindow()

      expect(window.zE).toHaveBeenCalledWith('messenger', 'show')
      expect(window.zE).toHaveBeenCalledWith('messenger', 'open')
    })

    it('should retry opening until zE is ready', async () => {
      vi.useFakeTimers()
      vi.doMock('@/config', () => ({ IS_CE_EDITION: false }))
      const { openZendeskWindow } = await import('../utils')

      window.zE = undefined
      openZendeskWindow({ interval: 10, retries: 2 })
      window.zE = mockZE
      vi.advanceTimersByTime(10)

      expect(window.zE).toHaveBeenCalledWith('messenger', 'show')
      expect(window.zE).toHaveBeenCalledWith('messenger', 'open')
      vi.useRealTimers()
    })

    it('should not call window.zE when IS_CE_EDITION is true', async () => {
      vi.doMock('@/config', () => ({ IS_CE_EDITION: true }))
      const { openZendeskWindow } = await import('../utils')

      openZendeskWindow()

      expect(window.zE).not.toHaveBeenCalled()
    })
  })
})
