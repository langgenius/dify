import {
  scrollToWorkflowNode,
  selectWorkflowNode,
  setupNodeSelectionListener,
  setupScrollToNodeListener,
} from '../node-navigation'

it('cancels queued automatic scrolling when the user takes over before it starts', () => {
  vi.useFakeTimers()
  const select = vi.fn()
  const setCenter = vi.fn<Parameters<typeof setupScrollToNodeListener>[1]['setCenter']>()
  const removeSelection = setupNodeSelectionListener(select)
  const removeScroll = setupScrollToNodeListener([{ id: 'node', position: { x: 100, y: 200 } }], {
    setCenter,
  })
  let shouldFocus = true
  try {
    selectWorkflowNode('node', true, () => shouldFocus)
    shouldFocus = false
    vi.advanceTimersByTime(100)
    expect(select).toHaveBeenCalledWith('node')
    expect(setCenter).not.toHaveBeenCalled()
    scrollToWorkflowNode('node')
    expect(setCenter).toHaveBeenCalledOnce()
  } finally {
    removeSelection()
    removeScroll()
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

it('selects without moving the viewport by default, and focuses a requested node after selection', () => {
  vi.useFakeTimers()
  const handleSelect = vi.fn()
  const setCenter = vi.fn<Parameters<typeof setupScrollToNodeListener>[1]['setCenter']>()
  const removeSelection = setupNodeSelectionListener(handleSelect)
  const removeScroll = setupScrollToNodeListener([{ id: 'node', position: { x: 100, y: 200 } }], {
    setCenter,
  })
  try {
    selectWorkflowNode('node')
    expect(handleSelect).toHaveBeenCalledExactlyOnceWith('node')
    vi.advanceTimersByTime(100)
    expect(setCenter).not.toHaveBeenCalled()
    selectWorkflowNode('node', true)
    expect(handleSelect).toHaveBeenCalledTimes(2)
    expect(setCenter).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(setCenter).toHaveBeenCalledExactlyOnceWith(
      100 + window.innerWidth * 0.25,
      200 + window.innerHeight * 0.25,
      { zoom: 1, duration: 800 },
    )
    removeSelection()
    removeScroll()
    selectWorkflowNode('node', true)
    scrollToWorkflowNode('node')
    vi.advanceTimersByTime(100)
    expect(handleSelect).toHaveBeenCalledTimes(2)
    expect(setCenter).toHaveBeenCalledTimes(1)
  } finally {
    removeSelection()
    removeScroll()
    vi.clearAllTimers()
    vi.useRealTimers()
  }
})

it('ignores empty selection ids and scroll targets absent from the current graph', () => {
  const handleSelect = vi.fn()
  const setCenter = vi.fn<Parameters<typeof setupScrollToNodeListener>[1]['setCenter']>()
  const removeSelection = setupNodeSelectionListener(handleSelect)
  const removeScroll = setupScrollToNodeListener([{ id: 'node', position: { x: 0, y: 0 } }], {
    setCenter,
  })
  try {
    selectWorkflowNode('')
    scrollToWorkflowNode('')
    scrollToWorkflowNode('deleted')
    expect(handleSelect).not.toHaveBeenCalled()
    expect(setCenter).not.toHaveBeenCalled()
  } finally {
    removeSelection()
    removeScroll()
  }
})
