import { act, renderHook } from '@testing-library/react'
import { useTriggerStatusStore } from '../trigger-status'

describe('useTriggerStatusStore', () => {
  beforeEach(() => useTriggerStatusStore.getState().clearTriggerStatuses())
  afterEach(() => useTriggerStatusStore.getState().clearTriggerStatuses())

  it('updates one trigger without changing other triggers or previous snapshots', () => {
    const { result } = renderHook(() => useTriggerStatusStore((state) => state.triggerStatuses))
    act(() =>
      useTriggerStatusStore.getState().setTriggerStatuses({ first: 'enabled', second: 'enabled' }),
    )
    const previous = result.current
    act(() => useTriggerStatusStore.getState().setTriggerStatus('first', 'disabled'))
    expect(result.current).toEqual({ first: 'disabled', second: 'enabled' })
    expect(previous).toEqual({ first: 'enabled', second: 'enabled' })
    expect(useTriggerStatusStore.getState().getTriggerStatus('missing')).toBe('disabled')
  })

  it('replaces statuses from a refreshed workflow and clears them when leaving', () => {
    const store = useTriggerStatusStore.getState()
    store.setTriggerStatuses({ old: 'enabled' })
    store.setTriggerStatuses({ current: 'enabled' })
    expect(useTriggerStatusStore.getState().triggerStatuses).toEqual({ current: 'enabled' })
    expect(store.getTriggerStatus('old')).toBe('disabled')
    store.clearTriggerStatuses()
    expect(useTriggerStatusStore.getState().triggerStatuses).toEqual({})
    expect(store.getTriggerStatus('current')).toBe('disabled')
  })
})
