import type {
  AgentLogSourceGroupResponse,
  AgentLogSourceResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
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
  const commonProps = {
    groups,
    isLoading: false,
    isError: false,
    onRetry: vi.fn(),
    onChange: vi.fn(),
  }

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

  it('adds and removes sources across groups while keeping the trigger count in sync', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    function Picker() {
      const [value, setValue] = useState([sources.webapp.id])
      return (
        <AgentLogSourcePicker
          {...commonProps}
          value={value}
          onChange={(next) => {
            setValue(next)
            onChange(next)
          }}
        />
      )
    }
    render(<Picker />)
    const trigger = screen.getByRole('combobox', {
      name: 'agentV2.agentDetail.logs.filters.source.label',
    })
    expect(trigger).toHaveTextContent('Book Translation')
    await user.click(trigger)
    expect(screen.getByRole('option', { name: /Book Translation/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.click(screen.getByRole('option', { name: /SVG Logo Design/ }))
    expect(onChange).toHaveBeenLastCalledWith([sources.webapp.id, sources.workflow.id])
    expect(trigger).toHaveTextContent('common.dynamicSelect.selected:{"count":2}')
    await user.click(screen.getByRole('option', { name: /Book Translation/ }))
    expect(onChange).toHaveBeenLastCalledWith([sources.workflow.id])
    expect(trigger).toHaveTextContent('SVG Logo Design')
  })

  it('should preserve selected source ids that are outside the current result set', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<AgentLogSourcePicker {...commonProps} value={['missing-source']} onChange={onChange} />)

    expect(
      screen.getByRole('combobox', {
        name: 'agentV2.agentDetail.logs.filters.source.label',
      }),
    ).toHaveTextContent('common.dynamicSelect.selected:{"count":1}')

    await user.click(
      screen.getByRole('combobox', {
        name: 'agentV2.agentDetail.logs.filters.source.label',
      }),
    )
    await user.click(screen.getByRole('option', { name: /Book Translation/ }))

    expect(onChange).toHaveBeenCalledWith(['missing-source', sources.webapp.id])
  })

  it('should show one named popup state and keep retry outside the listbox', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()

    render(
      <AgentLogSourcePicker
        value={[]}
        groups={[]}
        isLoading={false}
        isError
        onRetry={onRetry}
        onChange={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'agentV2.agentDetail.logs.filters.source.label',
      }),
    )

    const retryButton = screen.getByRole('button', { name: 'common.operation.retry' })

    expect(
      screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.logs.filters.source.label',
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(
      screen.queryByText('agentV2.agentDetail.logs.filters.source.empty'),
    ).not.toBeInTheDocument()
    await user.click(retryButton)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
