import type { ComponentProps, ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { CUSTOM_NODE } from '@/app/components/workflow/constants'
import { BlockEnum } from '@/app/components/workflow/types'
import { WorkflowHumanInputNode } from '../../human-input-router'
import Panel from '../../panel'

const panelLoads = vi.hoisted(() => ({ legacy: vi.fn(), v2: vi.fn() }))

vi.mock('../../human-input/node', () => ({
  __esModule: true,
  default: () => <div>v1-node</div>,
}))
vi.mock('../../human-input/panel', () => {
  panelLoads.legacy()
  return { default: () => <div>v1-panel</div> }
})
vi.mock('../node', () => ({
  HumanInputV2Node: () => <div>v2-node</div>,
}))
vi.mock('../panel', () => {
  panelLoads.v2()
  return { HumanInputV2Panel: () => <div>v2-panel</div> }
})
// Keep the registry and lazy loaders real while preserving the shell's prop injection.
vi.mock('../../_base/components/workflow-panel', () => ({
  default: ({ children, ...props }: { children: ReactElement<object> }) =>
    createElement(children.type, { ...children.props, ...props }),
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
  it('loads only the selected Human Input panel after rendering the canvas node', async () => {
    const { rerender } = render(<WorkflowHumanInputNode id="node" data={data()} />)
    expect(screen.getByText('v1-node')).toBeInTheDocument()
    expect(panelLoads.legacy).not.toHaveBeenCalled()
    expect(panelLoads.v2).not.toHaveBeenCalled()

    rerender(<Panel id="node" type={CUSTOM_NODE} data={data()} />)
    expect(await screen.findByText('v1-panel')).toBeInTheDocument()
    expect(panelLoads.legacy).toHaveBeenCalledTimes(1)
    expect(panelLoads.v2).not.toHaveBeenCalled()

    rerender(<Panel id="node" type={CUSTOM_NODE} data={data('2')} />)
    expect(await screen.findByText('v2-panel')).toBeInTheDocument()
    expect(screen.queryByText('v1-panel')).not.toBeInTheDocument()
    expect(panelLoads.v2).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['missing', undefined],
    ['string 1', '1'],
    ['numeric 2', 2],
  ])('keeps %s version on the original implementation', async (_, version) => {
    const { unmount } = render(<WorkflowHumanInputNode id="node" data={data(version)} />)
    expect(screen.getByText('v1-node')).toBeInTheDocument()
    unmount()

    render(<Panel id="node" type={CUSTOM_NODE} data={data(version)} />)
    expect(await screen.findByText('v1-panel')).toBeInTheDocument()
  })

  it('routes exact string version 2 to the new node and panel', async () => {
    const { unmount } = render(<WorkflowHumanInputNode id="node" data={data('2')} />)
    expect(screen.getByText('v2-node')).toBeInTheDocument()
    unmount()

    const panel = render(<Panel id="node" type={CUSTOM_NODE} data={data('2')} />)
    expect(await screen.findByText('v2-panel')).toBeInTheDocument()

    panel.rerender(
      <Panel id="node" type={CUSTOM_NODE} data={{ ...data('2'), type: BlockEnum.HumanInputV2 }} />,
    )
    expect(await screen.findByText('v2-panel')).toBeInTheDocument()
  })
})
