import { executeCommand, registerCommands, unregisterCommands } from '../command-bus'

describe('command-bus', () => {
  afterEach(() => {
    unregisterCommands(['test.a', 'test.b', 'test.c', 'async.cmd', 'noop'])
  })

  describe('registerCommands / executeCommand', () => {
    it('registers and executes a sync command', async () => {
      const handler = vi.fn()
      registerCommands({ 'test.a': handler })

      await executeCommand('test.a', { value: 42 })

      expect(handler).toHaveBeenCalledWith({ value: 42 })
    })

    it('registers and executes an async command', async () => {
      const handler = vi.fn().mockResolvedValue(undefined)
      registerCommands({ 'async.cmd': handler })

      await executeCommand('async.cmd')

      expect(handler).toHaveBeenCalled()
    })

    it('registers multiple commands at once', async () => {
      const handlerA = vi.fn()
      const handlerB = vi.fn()
      registerCommands({ 'test.a': handlerA, 'test.b': handlerB })

      await executeCommand('test.a')
      await executeCommand('test.b')

      expect(handlerA).toHaveBeenCalled()
      expect(handlerB).toHaveBeenCalled()
    })

    it('silently ignores unregistered command names', async () => {
      await expect(executeCommand('nonexistent')).resolves.toBeUndefined()
    })

    it('passes undefined args when not provided', async () => {
      const handler = vi.fn()
      registerCommands({ 'test.c': handler })

      await executeCommand('test.c')

      expect(handler).toHaveBeenCalledWith(undefined)
    })
  })

  describe('unregisterCommands', () => {
    it('removes commands so they can no longer execute', async () => {
      const handler = vi.fn()
      registerCommands({ 'test.a': handler })

      unregisterCommands(['test.a'])
      await executeCommand('test.a')

      expect(handler).not.toHaveBeenCalled()
    })

    it('handles unregistering non-existent commands gracefully', () => {
      expect(() => unregisterCommands(['nope'])).not.toThrow()
    })
  })
})
