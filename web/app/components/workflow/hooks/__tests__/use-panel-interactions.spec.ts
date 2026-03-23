import type * as React from 'react'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { usePanelInteractions } from '../use-panel-interactions'

describe('usePanelInteractions', () => {
  let container: HTMLDivElement

  beforeEach(() => {
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

  it('handlePaneContextMenu should set panelMenu with computed coordinates when container exists', () => {
    const { result, store } = renderWorkflowHook(() => usePanelInteractions())
    const preventDefault = vi.fn()

    result.current.handlePaneContextMenu({
      preventDefault,
      clientX: 350,
      clientY: 250,
    } as unknown as React.MouseEvent)

    expect(preventDefault).toHaveBeenCalled()
    expect(store.getState().panelMenu).toEqual({
      top: 200,
      left: 250,
    })
  })

  it('handlePaneContextMenu should throw when container does not exist', () => {
    container.remove()

    const { result } = renderWorkflowHook(() => usePanelInteractions())

    expect(() => {
      result.current.handlePaneContextMenu({
        preventDefault: vi.fn(),
        clientX: 350,
        clientY: 250,
      } as unknown as React.MouseEvent)
    }).toThrow()
  })

  it('handlePaneContextmenuCancel should clear panelMenu', () => {
    const { result, store } = renderWorkflowHook(() => usePanelInteractions(), {
      initialStoreState: { panelMenu: { top: 10, left: 20 } },
    })

    result.current.handlePaneContextmenuCancel()

    expect(store.getState().panelMenu).toBeUndefined()
  })

  it('handleNodeContextmenuCancel should clear nodeMenu', () => {
    const { result, store } = renderWorkflowHook(() => usePanelInteractions(), {
      initialStoreState: { nodeMenu: { top: 10, left: 20, nodeId: 'n1' } },
    })

    result.current.handleNodeContextmenuCancel()

    expect(store.getState().nodeMenu).toBeUndefined()
  })
})
