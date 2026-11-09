import type { ReactElement } from 'react'
import type { Node } from '../../types'
import { render, screen } from '@testing-library/react'
import { cloneElement } from 'react'
import { CUSTOM_NODE } from '../../constants'
import { BlockEnum } from '../../types'
import Panel from '../panel'

type InjectedProps = { id: string; data: Node['data'] }
const loads = vi.hoisted(() => ({ legacy: vi.fn(), v2: vi.fn() }))
vi.mock('../agent/panel', () => {
  loads.legacy()
  return {
    default: ({ id, data }: InjectedProps) => (
      <div>
        Legacy: {id} {data.title}
      </div>
    ),
  }
})
vi.mock('../agent-v2/panel', () => {
  loads.v2()
  return {
    AgentV2Panel: ({ id, data }: InjectedProps) => (
      <div>
        V2: {id} {data.title}
      </div>
    ),
  }
})
// The shell owns running and resizing. Preserve its node-prop injection contract
// while exercising the real registry, lazy loaders, and Agent discriminator.
vi.mock('../_base/components/workflow-panel', () => ({
  default: ({ children, ...props }: InjectedProps & { children: ReactElement<InjectedProps> }) =>
    cloneElement(children, props),
}))

it('loads the correct Agent variant for legacy and explicit V2 node types', async () => {
  const data: Node['data'] = { title: 'Agent', desc: '', type: BlockEnum.Agent }
  expect(loads.legacy).not.toHaveBeenCalled()
  expect(loads.v2).not.toHaveBeenCalled()
  const { rerender } = render(<Panel id="agent-1" type={CUSTOM_NODE} data={data} />)
  expect(await screen.findByText('Legacy: agent-1 Agent')).toBeInTheDocument()
  expect(loads.v2).not.toHaveBeenCalled()

  const v2Data = { ...data, agent_node_kind: 'dify_agent', version: '2' }
  rerender(<Panel id="agent-1" type={CUSTOM_NODE} data={v2Data} />)
  expect(await screen.findByText('V2: agent-1 Agent')).toBeInTheDocument()
  expect(screen.queryByText('Legacy: agent-1 Agent')).not.toBeInTheDocument()

  rerender(<Panel id="agent-2" type={CUSTOM_NODE} data={{ ...v2Data, type: BlockEnum.AgentV2 }} />)
  expect(await screen.findByText('V2: agent-2 Agent')).toBeInTheDocument()
  expect(loads.legacy).toHaveBeenCalledTimes(1)
  expect(loads.v2).toHaveBeenCalledTimes(1)
})
