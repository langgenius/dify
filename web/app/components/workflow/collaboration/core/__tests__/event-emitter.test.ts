import { EventEmitter } from '../event-emitter'

describe('EventEmitter', () => {
  it('delivers payloads only to active subscriptions of the emitted event', () => {
    const emitter = new EventEmitter()
    const first = vi.fn()
    const second = vi.fn()
    const other = vi.fn()
    const unsubscribe = emitter.on('message', first)
    emitter.on('message', second)
    emitter.on('other', other)
    emitter.emit('message', { value: 42 })
    expect(first).toHaveBeenCalledExactlyOnceWith({ value: 42 })
    expect(second).toHaveBeenCalledExactlyOnceWith({ value: 42 })
    expect(other).not.toHaveBeenCalled()
    unsubscribe()
    emitter.emit('message', 'next')
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenLastCalledWith('next')
    emitter.off('message', second)
    emitter.emit('message', 'ignored')
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('removes all handlers for one event without clearing another, then supports global cleanup', () => {
    const emitter = new EventEmitter()
    const first = vi.fn()
    const second = vi.fn()
    const other = vi.fn()
    emitter.on('message', first)
    emitter.on('message', second)
    emitter.on('other', other)
    emitter.off('message')
    emitter.emit('message', 'ignored')
    emitter.emit('other', 'retained')
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    expect(other).toHaveBeenCalledExactlyOnceWith('retained')
    expect(emitter.getListenerCount('message')).toBe(0)
    expect(emitter.getListenerCount('other')).toBe(1)
    emitter.removeAllListeners()
    emitter.emit('other', 'ignored')
    expect(other).toHaveBeenCalledOnce()
    expect(emitter.getListenerCount('other')).toBe(0)
  })

  it('continues emitting when a handler throws', () => {
    const emitter = new EventEmitter()
    const errorHandler = vi.spyOn(console, 'error').mockImplementation(() => undefined)

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
