import type * as React from 'react'
import { act, waitFor } from '@testing-library/react'
import { createEdge, createNode } from '../../__tests__/fixtures'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { usePanelInteractions } from '../use-panel-interactions'

it('replaces the node menu with the pane menu, imports clipboard data, and clears the target on cancel', async () => {
  const clipboardNode = createNode({ id: 'clipboard-node' })
  const clipboardEdge = createEdge({
    id: 'clipboard-edge',
    source: clipboardNode.id,
    target: 'target-node',
  })
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      readText: vi.fn().mockResolvedValue(
        JSON.stringify({
          kind: 'dify-workflow-clipboard',
          version: '0.6.0',
          nodes: [clipboardNode],
          edges: [clipboardEdge],
        }),
      ),
    },
  })
  try {
    const { result, store } = renderWorkflowHook(() => usePanelInteractions(), {
      initialStoreState: { contextMenuTarget: { type: 'node', nodeId: 'n1' } },
    })
    const preventDefault = vi.fn()
    act(() =>
      result.current.handlePaneContextMenu({ preventDefault } as unknown as React.MouseEvent),
    )
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(store.getState().contextMenuTarget).toEqual({ type: 'panel' })
    await waitFor(() => {
      expect(store.getState().clipboardElements).toEqual([clipboardNode])
      expect(store.getState().clipboardEdges).toEqual([clipboardEdge])
    })
    act(() => result.current.handlePaneContextmenuCancel())
    expect(store.getState().contextMenuTarget).toBeUndefined()
  } finally {
    if (original) Object.defineProperty(navigator, 'clipboard', original)
    else Reflect.deleteProperty(navigator, 'clipboard')
  }
})
