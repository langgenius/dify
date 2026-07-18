import type { ComponentProps } from 'react'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { WorkflowHumanInputNode, WorkflowHumanInputPanel } from '../../human-input-router'

vi.mock('../../human-input/node', () => ({
  __esModule: true,
  default: () => <div>v1-node</div>,
}))
vi.mock('../../human-input/panel', () => ({
  __esModule: true,
  default: () => <div>v1-panel</div>,
}))
vi.mock('../node', () => ({
  HumanInputV2Node: () => <div>v2-node</div>,
}))
vi.mock('../panel', () => ({
  HumanInputV2Panel: () => <div>v2-panel</div>,
}))

type RoutedNodeData = ComponentProps<typeof WorkflowHumanInputNode>['data']

const data = (version?: unknown): RoutedNodeData =>
  ({
    type: BlockEnum.HumanInput,
    title: 'Human Input',
    desc: '',
    form_content: '',
    inputs: [],
    user_actions: [],
    timeout: 36,
    timeout_unit: 'hour',
    delivery_methods: [],
    ...(version === undefined ? {} : { version }),
  }) as RoutedNodeData

describe('Human Input component routers', () => {
  it.each([
    ['missing', undefined],
    ['string 1', '1'],
    ['numeric 2', 2],
  ])('keeps %s version on the original implementation', (_, version) => {
    const { unmount } = render(<WorkflowHumanInputNode id="node" data={data(version)} />)
    expect(screen.getByText('v1-node')).toBeInTheDocument()
    unmount()

    render(
      <WorkflowHumanInputPanel
        id="node"
        data={data(version)}
        panelProps={{} as NodePanelProps<unknown>['panelProps']}
      />,
    )
    expect(screen.getByText('v1-panel')).toBeInTheDocument()
  })

  it('routes exact string version 2 to the new node and panel', () => {
    const { unmount } = render(<WorkflowHumanInputNode id="node" data={data('2')} />)
    expect(screen.getByText('v2-node')).toBeInTheDocument()
    unmount()

    render(
      <WorkflowHumanInputPanel
        id="node"
        data={data('2')}
        panelProps={{} as NodePanelProps<unknown>['panelProps']}
      />,
    )
    expect(screen.getByText('v2-panel')).toBeInTheDocument()
  })
})
