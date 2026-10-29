import type { Node } from '../../types'
import { act } from '@testing-library/react'
import { useReactFlow } from 'reactflow'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowCanvasHook } from '../../__tests__/workflow-test-env'
import { useLocateNode } from '../use-locate-node'
import { useNodesInteractions } from '../use-nodes-interactions'

const { searchParams, success, error } = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/next/navigation', () => ({ useSearchParams: () => searchParams }))
vi.mock('@/app/notifications', () => ({ toast: { success, error } }))

function renderLocate(nodes: Node[]) {
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  seedModelProviderQueries(queryClient)
  return renderWorkflowCanvasHook(
    ({ loadedNodes }) => {
      useLocateNode(loadedNodes)
      return { flow: useReactFlow(), ...useNodesInteractions() }
    },
    { nodes, queryClient, initialProps: { loadedNodes: nodes } },
  )
}

const selectedIds = (view: ReturnType<typeof renderLocate>) =>
  view.result.current.flow
    .getNodes()
    .filter((node) => node.selected)
    .map((node) => node.id)

// The document event is the public boundary consumed by the canvas scroll listener.
let scrollRequests: string[]
const onScroll = (event: Event) => {
  scrollRequests.push((event as CustomEvent<{ nodeId: string }>).detail.nodeId)
}

describe('useLocateNode', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    searchParams.delete('node_id')
    scrollRequests = []
    document.addEventListener('workflow:scroll-to-node', onScroll)
  })
  afterEach(() => {
    document.removeEventListener('workflow:scroll-to-node', onScroll)
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('preserves selection when node_id is absent', () => {
    const view = renderLocate([
      createNode({ id: 'existing', selected: true, data: { selected: true } }),
    ])
    act(() => vi.advanceTimersByTime(500))

    expect(selectedIds(view)).toEqual(['existing'])
    expect(success).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(scrollRequests).toEqual([])
  })

  it('waits for nodes before reporting a missing target', () => {
    searchParams.set('node_id', 'target')
    const view = renderLocate([])
    act(() => vi.advanceTimersByTime(500))

    expect(view.result.current.flow.getNodes()).toEqual([])
    expect(success).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('selects the target instead of the previous node and requests scrolling after the delay', () => {
    searchParams.set('node_id', 'target')
    const view = renderLocate([
      createNode({ id: 'previous', selected: true, data: { selected: true } }),
      createNode({ id: 'target', data: { title: 'My Node' } }),
    ])

    expect(selectedIds(view)).toEqual(['target'])
    expect(view.result.current.flow.getNode('target')?.data.selected).toBe(true)
    expect(view.result.current.flow.getNode('previous')?.data.selected).toBe(false)
    expect(success).toHaveBeenCalledWith('workflow.panel.locateNodeSuccess:{"title":"My Node"}')
    expect(scrollRequests).toEqual([])
    act(() => vi.advanceTimersByTime(200))
    expect(scrollRequests).toEqual(['target'])
  })

  it('reports a missing target after nodes settle without changing selection', () => {
    searchParams.set('node_id', 'missing')
    const view = renderLocate([createNode({ id: 'other', selected: true })])
    expect(error).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(500))

    expect(error).toHaveBeenCalledWith('workflow.panel.locateNodeNotFound:{"nodeId":"missing"}')
    expect(selectedIds(view)).toEqual(['other'])
    expect(scrollRequests).toEqual([])
  })

  it('selects a target that arrives before the not-found debounce expires', () => {
    searchParams.set('node_id', 'target')
    const initial = [createNode({ id: 'other' })]
    const view = renderLocate(initial)
    act(() => vi.advanceTimersByTime(300))
    const loadedNodes = [...initial, createNode({ id: 'target', data: { title: 'Found!' } })]
    act(() => view.setCanvas({ nodes: loadedNodes }))
    view.rerender({ loadedNodes })

    expect(selectedIds(view)).toEqual(['target'])
    expect(success).toHaveBeenCalledWith('workflow.panel.locateNodeSuccess:{"title":"Found!"}')
    act(() => vi.advanceTimersByTime(500))
    expect(error).not.toHaveBeenCalled()
    expect(scrollRequests).toEqual(['target'])
  })

  it('does not steal selection back when nodes update after locating', () => {
    searchParams.set('node_id', 'target')
    const view = renderLocate([createNode({ id: 'target' }), createNode({ id: 'other' })])
    expect(selectedIds(view)).toEqual(['target'])
    act(() => vi.advanceTimersByTime(200))

    act(() => view.result.current.handleNodeSelect('other'))
    view.rerender({ loadedNodes: view.result.current.flow.getNodes() })
    act(() => vi.advanceTimersByTime(500))

    expect(selectedIds(view)).toEqual(['other'])
    expect(success).toHaveBeenCalledTimes(1)
    expect(scrollRequests).toEqual(['target'])
  })

  it('cancels pending scrolling when the editor unmounts', () => {
    searchParams.set('node_id', 'target')
    const view = renderLocate([createNode({ id: 'target' })])
    expect(selectedIds(view)).toEqual(['target'])
    view.unmount()
    act(() => vi.advanceTimersByTime(500))
    expect(scrollRequests).toEqual([])
  })
})
