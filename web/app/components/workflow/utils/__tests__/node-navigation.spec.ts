import {
  scrollToWorkflowNode,
  selectWorkflowNode,
  setupNodeSelectionListener,
  setupScrollToNodeListener,
} from '../node-navigation'

describe('selectWorkflowNode', () => {
  it('should dispatch workflow:select-node event with correct detail', () => {
    const handler = vi.fn()
    document.addEventListener('workflow:select-node', handler)

    selectWorkflowNode('node-1', true)

    expect(handler).toHaveBeenCalledTimes(1)
    const event = handler.mock.calls[0][0] as CustomEvent
    expect(event.detail).toEqual({ nodeId: 'node-1', focus: true })

    document.removeEventListener('workflow:select-node', handler)
  })

  it('should default focus to false', () => {
    const handler = vi.fn()
    document.addEventListener('workflow:select-node', handler)

    selectWorkflowNode('node-2')

    const event = handler.mock.calls[0][0] as CustomEvent
    expect(event.detail.focus).toBe(false)

    document.removeEventListener('workflow:select-node', handler)
  })
})

describe('scrollToWorkflowNode', () => {
  it('should dispatch workflow:scroll-to-node event', () => {
    const handler = vi.fn()
    document.addEventListener('workflow:scroll-to-node', handler)

    scrollToWorkflowNode('node-5')

    expect(handler).toHaveBeenCalledTimes(1)
    const event = handler.mock.calls[0][0] as CustomEvent
    expect(event.detail).toEqual({ nodeId: 'node-5' })

    document.removeEventListener('workflow:scroll-to-node', handler)
  })
})

describe('setupNodeSelectionListener', () => {
  it('should call handleNodeSelect when event is dispatched', () => {
    const handleNodeSelect = vi.fn()
    const cleanup = setupNodeSelectionListener(handleNodeSelect)

    selectWorkflowNode('node-10')

    expect(handleNodeSelect).toHaveBeenCalledWith('node-10')

    cleanup()
  })

  it('should also scroll to node when focus is true', () => {
    vi.useFakeTimers()
    const handleNodeSelect = vi.fn()
    const scrollHandler = vi.fn()
    document.addEventListener('workflow:scroll-to-node', scrollHandler)

    const cleanup = setupNodeSelectionListener(handleNodeSelect)
    selectWorkflowNode('node-11', true)

    expect(handleNodeSelect).toHaveBeenCalledWith('node-11')

    vi.advanceTimersByTime(150)
    expect(scrollHandler).toHaveBeenCalledTimes(1)

    cleanup()
    document.removeEventListener('workflow:scroll-to-node', scrollHandler)
    vi.useRealTimers()
  })

  it('should not call handler after cleanup', () => {
    const handleNodeSelect = vi.fn()
    const cleanup = setupNodeSelectionListener(handleNodeSelect)

    cleanup()
    selectWorkflowNode('node-12')

    expect(handleNodeSelect).not.toHaveBeenCalled()
  })

  it('should ignore events with empty nodeId', () => {
    const handleNodeSelect = vi.fn()
    const cleanup = setupNodeSelectionListener(handleNodeSelect)

    const event = new CustomEvent('workflow:select-node', {
      detail: { nodeId: '', focus: false },
    })
    document.dispatchEvent(event)

    expect(handleNodeSelect).not.toHaveBeenCalled()

    cleanup()
  })
})

describe('setupScrollToNodeListener', () => {
  it('should call reactflow.setCenter when scroll event targets an existing node', () => {
    const nodes = [{ id: 'n1', position: { x: 100, y: 200 } }]
    const reactflow = { setCenter: vi.fn() }

    const cleanup = setupScrollToNodeListener(nodes, reactflow)
    scrollToWorkflowNode('n1')

    expect(reactflow.setCenter).toHaveBeenCalledTimes(1)
    const [targetX, targetY, options] = reactflow.setCenter.mock.calls[0]
    expect(targetX).toBeGreaterThan(100)
    expect(targetY).toBeGreaterThan(200)
    expect(options).toEqual({ zoom: 1, duration: 800 })

    cleanup()
  })

  it('should not call setCenter when node is not found', () => {
    const nodes = [{ id: 'n1', position: { x: 0, y: 0 } }]
    const reactflow = { setCenter: vi.fn() }

    const cleanup = setupScrollToNodeListener(nodes, reactflow)
    scrollToWorkflowNode('non-existent')

    expect(reactflow.setCenter).not.toHaveBeenCalled()

    cleanup()
  })

  it('should not react after cleanup', () => {
    const nodes = [{ id: 'n1', position: { x: 0, y: 0 } }]
    const reactflow = { setCenter: vi.fn() }

    const cleanup = setupScrollToNodeListener(nodes, reactflow)
    cleanup()

    scrollToWorkflowNode('n1')
    expect(reactflow.setCenter).not.toHaveBeenCalled()
  })

  it('should ignore events with empty nodeId', () => {
    const nodes = [{ id: 'n1', position: { x: 0, y: 0 } }]
    const reactflow = { setCenter: vi.fn() }

    const cleanup = setupScrollToNodeListener(nodes, reactflow)

    const event = new CustomEvent('workflow:scroll-to-node', {
      detail: { nodeId: '' },
    })
    document.dispatchEvent(event)

    expect(reactflow.setCenter).not.toHaveBeenCalled()

    cleanup()
  })
})
