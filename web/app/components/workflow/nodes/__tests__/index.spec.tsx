import type { ReactElement } from 'react'
import type { Node as WorkflowNode } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CUSTOM_NODE } from '../../constants'
import { BlockEnum } from '../../types'
import CustomNode from '../index'
import Panel from '../panel'

const nodeFailure = vi.hoisted(() => ({ throwing: false }))

vi.mock('../components', () => ({
  NodeComponentMap: {
    [BlockEnum.Start]: () => {
      if (nodeFailure.throwing) throw new Error('Private node configuration')
      return <div>start-node-component</div>
    },
    [BlockEnum.StartPlaceholder]: () => <div>start-placeholder-node-component</div>,
  },
}))

vi.mock('../panel-components', () => ({
  PanelComponentMap: {
    [BlockEnum.Start]: () => <div>start-panel-component</div>,
    [BlockEnum.StartPlaceholder]: () => <div>start-placeholder-panel-component</div>,
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
    data: { type: BlockEnum; desc?: string }
    children: ReactElement
  }) => {
    if (data.desc === 'broken-shell') throw new Error('Private shell configuration')
    return (
      <div>
        <div>{`base-node:${id}:${data.type}`}</div>
        {children}
      </div>
    )
  },
}))

vi.mock('../_base/components/workflow-panel', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  const MockWorkflowPanel = ({
    id,
    data,
    children,
  }: {
    id: string
    data: { type: BlockEnum }
    children: ReactElement
  }) => {
    const [initialType] = React.useState(data.type)

    return (
      <div>
        <div>{`base-panel:${id}:${data.type}`}</div>
        <div>{`base-panel-initial:${initialType}`}</div>
        {children}
      </div>
    )
  }

  return {
    __esModule: true,
    default: MockWorkflowPanel,
  }
})

const createNodeData = (): WorkflowNode['data'] => ({
  title: 'Start',
  desc: '',
  type: BlockEnum.Start,
})

const createStartPlaceholderData = (): WorkflowNode['data'] => ({
  title: 'Pick a start node',
  desc: '',
  type: BlockEnum.StartPlaceholder,
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
  beforeEach(() => {
    nodeFailure.throwing = false
  })

  it('contains a failing node and retries it without removing a healthy canvas sibling', async () => {
    const user = userEvent.setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    nodeFailure.throwing = true
    try {
      render(
        <>
          <CustomNode id="failed-node" data={createNodeData()} {...baseNodeProps} />
          <CustomNode id="healthy-node" data={createStartPlaceholderData()} {...baseNodeProps} />
        </>,
      )
      expect(screen.getByText('start-placeholder-node-component')).toBeInTheDocument()
      expect(screen.queryByText('Private node configuration')).not.toBeInTheDocument()
      nodeFailure.throwing = false
      await user.click(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' }))
      expect(screen.getByText('start-node-component')).toBeInTheDocument()
      expect(screen.getByText('start-placeholder-node-component')).toBeInTheDocument()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('contains a base node shell failure and retries after its configuration is repaired', async () => {
    const user = userEvent.setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { rerender } = render(
        <CustomNode
          id="node-1"
          data={{ ...createNodeData(), desc: 'broken-shell' }}
          {...baseNodeProps}
        />,
      )
      expect(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' })).toBeEnabled()
      rerender(<CustomNode id="node-1" data={createNodeData()} {...baseNodeProps} />)
      await user.click(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' }))
      expect(screen.getByText('start-node-component')).toBeInTheDocument()
    } finally {
      consoleError.mockRestore()
    }
  })

  it.each([{ ...createNodeData(), type: 'unknown-node' }, null, { ...createNodeData(), type: {} }])(
    'contains malformed graph data and recovers when the node type is repaired: %j',
    (data) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const { rerender } = render(<CustomNode id="node-1" data={data} {...baseNodeProps} />)
        expect(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' })).toBeEnabled()
        rerender(<CustomNode id="node-1" data={createNodeData()} {...baseNodeProps} />)
        expect(screen.getByText('start-node-component')).toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: 'common.errorBoundary.tryAgain' }),
        ).not.toBeInTheDocument()
      } finally {
        consoleError.mockRestore()
      }
    },
  )

  it('should render the mapped node inside the base node shell', () => {
    render(<CustomNode id="node-1" data={createNodeData()} {...baseNodeProps} />)

    expect(screen.getByText('base-node:node-1:start')).toBeInTheDocument()
    expect(screen.getByText('start-node-component')).toBeInTheDocument()
  })

  it('should render the mapped panel inside the base panel shell for custom nodes', () => {
    render(<Panel type={CUSTOM_NODE} id="node-1" data={createNodeData()} />)

    expect(screen.getByText('base-panel:node-1:start')).toBeInTheDocument()
    expect(screen.getByText('start-panel-component')).toBeInTheDocument()
  })

  it('should remount the base panel when a node keeps its id but changes type', () => {
    const { rerender } = render(
      <Panel type={CUSTOM_NODE} id="node-1" data={createStartPlaceholderData()} />,
    )

    expect(screen.getByText('base-panel-initial:start-placeholder')).toBeInTheDocument()

    rerender(<Panel type={CUSTOM_NODE} id="node-1" data={createNodeData()} />)

    expect(screen.getByText('base-panel:node-1:start')).toBeInTheDocument()
    expect(screen.getByText('base-panel-initial:start')).toBeInTheDocument()
  })

  it('should return null for non-custom panel types', () => {
    const { container } = render(<Panel type="default" id="node-1" data={createNodeData()} />)

    expect(container).toBeEmptyDOMElement()
  })
})
