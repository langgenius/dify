import type * as React from 'react'
import { waitFor } from '@testing-library/react'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { usePanelInteractions } from '../use-panel-interactions'

describe('usePanelInteractions', () => {
  let container: HTMLDivElement
  let readTextMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    readTextMock = vi.fn().mockResolvedValue('')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: readTextMock,
      },
    })

    container = document.createElement('div')
    container.id = 'workflow-container'
    container.getBoundingClientRect = vi.fn().mockReturnValue({
      x: 100,
      y: 50,
      width: 800,
      height: 600,
      top: 50,
      right: 900,
      bottom: 650,
      left: 100,
    })
    document.body.appendChild(container)
  })

  afterEach(() => {
    container.remove()
  })

  it('handlePaneContextMenu should set panelMenu with viewport coordinates', () => {
    const { result, store } = renderWorkflowHook(() => usePanelInteractions(), {
      initialStoreState: {
        nodeMenu: { clientX: 40, clientY: 20, nodeId: 'n1' },
        selectionMenu: { clientX: 30, clientY: 50 },
        edgeMenu: { clientX: 320, clientY: 180, edgeId: 'e1' },
      },
    })
    const preventDefault = vi.fn()

    result.current.handlePaneContextMenu({
      preventDefault,
      clientX: 350,
      clientY: 250,
    } as unknown as React.MouseEvent)

    expect(preventDefault).toHaveBeenCalled()
    expect(store.getState().panelMenu).toEqual({
      clientX: 350,
      clientY: 250,
    })
    expect(store.getState().nodeMenu).toBeUndefined()
    expect(store.getState().selectionMenu).toBeUndefined()
    expect(store.getState().edgeMenu).toBeUndefined()
  })

  it('handlePaneContextMenu should sync clipboard from navigator clipboard', async () => {
    const clipboardNode = createNode({ id: 'clipboard-node' })
    const clipboardEdge = createEdge({
      id: 'clipboard-edge',
      source: clipboardNode.id,
      target: 'target-node',
    })
    readTextMock.mockResolvedValue(JSON.stringify({
      kind: 'dify-workflow-clipboard',
      version: '0.6.0',
      nodes: [clipboardNode],
      edges: [clipboardEdge],
    }))

    const { result, store } = renderWorkflowHook(() => usePanelInteractions())

    result.current.handlePaneContextMenu({
      preventDefault: vi.fn(),
      clientX: 350,
      clientY: 250,
    } as unknown as React.MouseEvent)

    await waitFor(() => {
      expect(store.getState().clipboardElements).toEqual([clipboardNode])
      expect(store.getState().clipboardEdges).toEqual([clipboardEdge])
    })
  })

  it('handlePaneContextmenuCancel should clear panelMenu', () => {
    const { result, store } = renderWorkflowHook(() => usePanelInteractions(), {
      initialStoreState: { panelMenu: { clientX: 20, clientY: 10 } },
    })

    result.current.handlePaneContextmenuCancel()

    expect(store.getState().panelMenu).toBeUndefined()
  })

  it('handleNodeContextmenuCancel should clear nodeMenu', () => {
    const { result, store } = renderWorkflowHook(() => usePanelInteractions(), {
      initialStoreState: { nodeMenu: { clientX: 20, clientY: 10, nodeId: 'n1' } },
    })

    result.current.handleNodeContextmenuCancel()

    expect(store.getState().nodeMenu).toBeUndefined()
  })

  it('handleEdgeContextmenuCancel should clear edgeMenu', () => {
    const { result, store } = renderWorkflowHook(() => usePanelInteractions(), {
      initialStoreState: { edgeMenu: { clientX: 300, clientY: 200, edgeId: 'e1' } },
    })

    result.current.handleEdgeContextmenuCancel()

    expect(store.getState().edgeMenu).toBeUndefined()
  })
})
