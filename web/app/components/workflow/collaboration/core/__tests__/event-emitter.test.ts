import { EventEmitter } from '../event-emitter'

describe('EventEmitter', () => {
  it('registers and invokes handlers via on/emit', () => {
    const emitter = new EventEmitter()
    const handler = vi.fn()

    emitter.on('test', handler)
    emitter.emit('test', { value: 42 })

    expect(handler).toHaveBeenCalledWith({ value: 42 })
  })

  it('removes specific handler with off', () => {
    const emitter = new EventEmitter()
    const handlerA = vi.fn()
    const handlerB = vi.fn()

    emitter.on('test', handlerA)
    emitter.on('test', handlerB)

    emitter.off('test', handlerA)
    emitter.emit('test', 'payload')

    expect(handlerA).not.toHaveBeenCalled()
    expect(handlerB).toHaveBeenCalledWith('payload')
  })

  it('clears all listeners when off is called without handler', () => {
    const emitter = new EventEmitter()
    const handlerA = vi.fn()
    const handlerB = vi.fn()

    emitter.on('trigger', handlerA)
    emitter.on('trigger', handlerB)

    emitter.off('trigger')
    emitter.emit('trigger', 'payload')

    expect(handlerA).not.toHaveBeenCalled()
    expect(handlerB).not.toHaveBeenCalled()
    expect(emitter.getListenerCount('trigger')).toBe(0)
  })

  it('removeAllListeners clears every registered event', () => {
    const emitter = new EventEmitter()
    emitter.on('one', vi.fn())
    emitter.on('two', vi.fn())

    emitter.removeAllListeners()

    expect(emitter.getListenerCount('one')).toBe(0)
    expect(emitter.getListenerCount('two')).toBe(0)
  })

  it('returns an unsubscribe function from on', () => {
    const emitter = new EventEmitter()
    const handler = vi.fn()

    const unsubscribe = emitter.on('detach', handler)
    unsubscribe()

    emitter.emit('detach', 'value')

    expect(handler).not.toHaveBeenCalled()
  })

  it('continues emitting when a handler throws', () => {
    const emitter = new EventEmitter()
    const errorHandler = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const failingHandler = vi.fn(() => {
      throw new Error('boom')
    })
    const succeedingHandler = vi.fn()

    emitter.on('safe', failingHandler)
    emitter.on('safe', succeedingHandler)

    emitter.emit('safe', 7)

    expect(failingHandler).toHaveBeenCalledWith(7)
    expect(succeedingHandler).toHaveBeenCalledWith(7)
    expect(errorHandler).toHaveBeenCalledWith(
      expect.stringContaining('Error in event handler for safe:'),
      expect.any(Error),
    )

    errorHandler.mockRestore()
  })
})
