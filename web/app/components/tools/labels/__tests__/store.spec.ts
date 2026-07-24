import type { Label } from '../constant'
import { beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../store'

describe('labels/store', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useStore.setState({ labelList: [] })
  })

  it('initializes with empty labelList', () => {
    const state = useStore.getState()
    expect(state.labelList).toEqual([])
  })

  it('sets labelList via setLabelList', () => {
    const labels: Label[] = [
      { name: 'search', label: 'Search' },
      { name: 'agent', label: { en_US: 'Agent', zh_Hans: '代理' } },
    ]
    useStore.getState().setLabelList(labels)
    expect(useStore.getState().labelList).toEqual(labels)
  })

  it('replaces existing labels with new list', () => {
    const initial: Label[] = [{ name: 'old', label: 'Old' }]
    useStore.getState().setLabelList(initial)
    expect(useStore.getState().labelList).toEqual(initial)

    const updated: Label[] = [{ name: 'new', label: 'New' }]
    useStore.getState().setLabelList(updated)
    expect(useStore.getState().labelList).toEqual(updated)
  })

  it('handles undefined argument (sets labelList to undefined)', () => {
    const labels: Label[] = [{ name: 'test', label: 'Test' }]
    useStore.getState().setLabelList(labels)
    useStore.getState().setLabelList(undefined)
    expect(useStore.getState().labelList).toBeUndefined()
  })
})
