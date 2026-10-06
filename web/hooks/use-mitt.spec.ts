import type { Emitter } from 'mitt'
import { act, renderHook } from '@testing-library/react'
import create from 'mitt'
import { useMitt } from './use-mitt'

type Events = {
  [key: string]: unknown
  [key: symbol]: unknown
  message: string
}

function renderMittHook(initialEmitter?: Emitter<Events>) {
  const handler = vi.fn()
  const hook = renderHook(
    ({ emitter }: { emitter?: Emitter<Events> }) => {
      const mitt = useMitt<Events>(emitter)
      mitt.useSubscribe('message', handler)
      return mitt
    },
    { initialProps: { emitter: initialEmitter } },
  )

  return { ...hook, handler }
}

describe('useMitt', () => {
  it('keeps its internal emitter stable across renders', () => {
    const { handler, rerender, result } = renderMittHook()
    const initialEmit = result.current.emit

    act(() => result.current.emit('message', 'before rerender'))
    rerender({ emitter: undefined })
    act(() => result.current.emit('message', 'after rerender'))

    expect(result.current.emit).toBe(initialEmit)
    expect(handler).toHaveBeenNthCalledWith(1, 'before rerender')
    expect(handler).toHaveBeenNthCalledWith(2, 'after rerender')
  })

  it('moves subscriptions to a new external emitter', () => {
    const emitterA = create<Events>()
    const emitterB = create<Events>()
    const { handler, rerender, result } = renderMittHook(emitterA)

    rerender({ emitter: emitterB })
    act(() => {
      emitterA.emit('message', 'old emitter')
      result.current.emit('message', 'new emitter')
    })

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith('new emitter')
  })

  it('keeps the latest external emitter when the optional emitter is removed', () => {
    const emitterA = create<Events>()
    const emitterB = create<Events>()
    const latestEmitterHandler = vi.fn()
    const latestWildcardHandler = vi.fn()
    emitterB.on('message', latestEmitterHandler)
    emitterB.on('*', latestWildcardHandler)
    const { handler, rerender, result } = renderMittHook(emitterA)

    rerender({ emitter: emitterB })
    rerender({ emitter: undefined })
    act(() => result.current.emit('message', 'latest emitter'))

    expect(latestEmitterHandler).toHaveBeenCalledOnce()
    expect(latestEmitterHandler).toHaveBeenCalledWith('latest emitter')
    expect(latestWildcardHandler).toHaveBeenCalledWith('message', 'latest emitter')
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith('latest emitter')
  })
})
