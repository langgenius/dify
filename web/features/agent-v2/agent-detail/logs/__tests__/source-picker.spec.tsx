import type {
  AgentLogSourceGroupResponse,
  AgentLogSourceResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentLogSourcePicker } from '../components/source-picker'

const sources = {
  webapp: {
    app_id: 'webapp-app-id',
    app_name: 'Book Translation',
    id: 'webapp:webapp-app-id',
    type: 'webapp',
  },
  workflow: {
    app_id: 'workflow-app-id',
    app_name: 'SVG Logo Design',
    id: 'workflow:workflow-app-id:workflow-id:v3:agent-node-id',
    node_id: 'agent-node-id',
    type: 'workflow',
    workflow_id: 'workflow-id',
    workflow_version: 'v3',
  },
} satisfies Record<string, AgentLogSourceResponse>

const groups: AgentLogSourceGroupResponse[] = [
  {
    label: 'Webapp',
    type: 'webapp',
    sources: [sources.webapp],
  },
  {
    label: 'Workflow',
    type: 'workflow',
    sources: [sources.workflow],
  },
]

describe('AgentLogSourcePicker', () => {
  it('should filter sources across groups and only show empty when no source matches', async () => {
    const user = userEvent.setup()

    render(
      <AgentLogSourcePicker
        value={[]}
        groups={groups}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onChange={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'agentV2.agentDetail.logs.filters.source.label',
      }),
    )
    const searchInput = screen.getByRole('combobox', {
      name: 'agentV2.agentDetail.logs.filters.source.searchLabel',
    })
    await user.type(searchInput, 'Book')

    expect(screen.getByRole('option', { name: /Book Translation/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /SVG Logo Design/ })).not.toBeInTheDocument()
    expect(
      screen.queryByText('agentV2.agentDetail.logs.filters.source.empty'),
    ).not.toBeInTheDocument()

    await user.clear(searchInput)
    await user.type(searchInput, 'Missing source')

    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.logs.filters.source.empty')).toBeInTheDocument()
  })
})
