import type { ReactNode } from 'react'
import { act } from '@testing-library/react'
import { useState } from 'react'
import { ReactFlowProvider, useStoreApi } from 'reactflow'
import { renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import HelpLine from '../index'

// Seeds the real ReactFlow viewport (x, y, zoom) without mounting a canvas.
const Viewport = ({ children }: { children: ReactNode }) => {
  const flowStore = useStoreApi()
  useState(() => flowStore.setState({ transform: [10, 20, 2] }))
  return children
}

const renderHelpLine = (initialStoreState = {}) =>
  renderWorkflowComponent(
    <ReactFlowProvider>
      <Viewport>
        <HelpLine />
      </Viewport>
    </ReactFlowProvider>,
    { initialStoreState },
  )

describe('HelpLine', () => {
  it('renders nothing when no node is being aligned', () => {
    const { container } = renderHelpLine()

    expect(container).toBeEmptyDOMElement()
  })

  it('draws both guide lines in screen space using the viewport offset and zoom', () => {
    const { container } = renderHelpLine({
      helpLineHorizontal: { top: 30, left: 40, width: 50 },
      helpLineVertical: { top: 60, left: 70, height: 80 },
    })
    const [horizontal, vertical] = Array.from(container.querySelectorAll('div'))

    expect(horizontal).toHaveStyle({ top: '80px', left: '90px', width: '100px' })
    expect(vertical).toHaveStyle({ top: '140px', left: '150px', height: '160px' })
  })

  it('removes the guides once alignment ends', () => {
    const { container, store } = renderHelpLine({
      helpLineHorizontal: { top: 30, left: 40, width: 50 },
    })
    expect(container.querySelectorAll('div')).toHaveLength(1)

    act(() => store.setState({ helpLineHorizontal: undefined }))

    expect(container).toBeEmptyDOMElement()
  })
})
