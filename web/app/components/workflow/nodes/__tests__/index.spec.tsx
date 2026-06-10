import type { ReactElement } from 'react'
import type { Node as WorkflowNode } from '../../types'
import { render, screen } from '@testing-library/react'
import { CUSTOM_NODE } from '../../constants'
import { BlockEnum } from '../../types'
import CustomNode, { Panel } from '../index'

vi.mock('../components', () => ({
  NodeComponentMap: {
    [BlockEnum.Start]: () => <div>start-node-component</div>,
  },
  PanelComponentMap: {
    [BlockEnum.Start]: () => <div>start-panel-component</div>,
  },
}))

vi.mock('../_base/node', () => ({
  __esModule: true,
  default: ({
    id,
    data,
    children,
  }: {
    id: string
    data: { type: BlockEnum }
    children: ReactElement
  }) => (
    <div>
      <div>{`base-node:${id}:${data.type}`}</div>
      {children}
    </div>
  ),
}))

vi.mock('../_base/components/workflow-panel', () => ({
  __esModule: true,
  default: ({
    id,
    data,
    children,
  }: {
    id: string
    data: { type: BlockEnum }
    children: ReactElement
  }) => (
    <div>
      <div>{`base-panel:${id}:${data.type}`}</div>
      {children}
    </div>
  ),
}))

const createNodeData = (): WorkflowNode['data'] => ({
  title: 'Start',
  desc: '',
  type: BlockEnum.Start,
})

const baseNodeProps = {
  type: CUSTOM_NODE,
  selected: false,
  zIndex: 1,
  xPos: 0,
  yPos: 0,
  dragging: false,
  isConnectable: true,
}

describe('workflow nodes index', () => {
  it('should render the mapped node inside the base node shell', () => {
    render(
      <CustomNode
        id="node-1"
        data={createNodeData()}
        {...baseNodeProps}
      />,
    )

    expect(screen.getByText('base-node:node-1:start')).toBeInTheDocument()
    expect(screen.getByText('start-node-component')).toBeInTheDocument()
  })

  it('should render the mapped panel inside the base panel shell for custom nodes', () => {
    render(
      <Panel
        type={CUSTOM_NODE}
        id="node-1"
        data={createNodeData()}
      />,
    )

    expect(screen.getByText('base-panel:node-1:start')).toBeInTheDocument()
    expect(screen.getByText('start-panel-component')).toBeInTheDocument()
  })

  it('should return null for non-custom panel types', () => {
    const { container } = render(
      <Panel
        type="default"
        id="node-1"
        data={createNodeData()}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
