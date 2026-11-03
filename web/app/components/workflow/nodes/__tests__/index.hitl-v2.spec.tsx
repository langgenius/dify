import type { ReactElement } from 'react'
import type { Node as WorkflowNode } from '../../types'
import { render, screen } from '@testing-library/react'
import { CUSTOM_NODE } from '../../constants'
import { BlockEnum } from '../../types'
import Panel from '../panel'

vi.mock('../components', () => ({
  NodeComponentMap: {
    [BlockEnum.Start]: () => <div>start-node-component</div>,
    [BlockEnum.StartPlaceholder]: () => <div>start-placeholder-node-component</div>,
  },
}))

vi.mock('../panel-components', () => ({
  PanelComponentMap: {
    [BlockEnum.Start]: () => <div>start-panel-component</div>,
    [BlockEnum.StartPlaceholder]: () => <div>start-placeholder-panel-component</div>,
    [BlockEnum.HumanInput]: () => <div>human-input-panel-component</div>,
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

vi.mock('../_base/components/workflow-panel', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  const MockWorkflowPanel = ({
    id,
    data,
    children,
  }: {
    id: string
    data: { type: BlockEnum; version?: string }
    children: ReactElement
  }) => {
    const [initialType] = React.useState(data.type)
    const [initialVersion] = React.useState(data.version ?? '1')

    return (
      <div>
        <div>{`base-panel:${id}:${data.type}`}</div>
        <div>{`base-panel-initial:${initialType}`}</div>
        <div>{`base-panel-initial-version:${initialVersion}`}</div>
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

describe('workflow nodes index', () => {
  it('remounts the open panel when HITL migration or undo changes only the version', () => {
    const legacy = { ...createNodeData(), type: BlockEnum.HumanInput }
    const migrated = { ...legacy, version: '2' }
    const { rerender } = render(<Panel type={CUSTOM_NODE} id="hitl" data={legacy} />)
    expect(screen.getByText('base-panel-initial-version:1')).toBeInTheDocument()

    rerender(<Panel type={CUSTOM_NODE} id="hitl" data={migrated} />)
    expect(screen.getByText('base-panel-initial-version:2')).toBeInTheDocument()

    rerender(<Panel type={CUSTOM_NODE} id="hitl" data={legacy} />)
    expect(screen.getByText('base-panel-initial-version:1')).toBeInTheDocument()
  })
})
