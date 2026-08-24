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

  it('should keep selected item state and checkbox icon DOM in sync', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <AgentLogSourcePicker {...commonProps} value={[sources.webapp.id]} />,
    )

    await user.click(
      screen.getByRole('combobox', {
        name: 'agentV2.agentDetail.logs.filters.source.label',
      }),
    )

    const webappOption = screen.getByRole('option', { name: /Book Translation/ })
    const workflowOption = screen.getByRole('option', { name: /SVG Logo Design/ })
    expect(webappOption).toHaveClass('min-h-7', 'grid-cols-[1fr]', 'px-1', 'py-1')
    expect(webappOption).toHaveAttribute('data-selected')
    expect(webappOption.querySelector('.i-ri-check-line')).toBeInTheDocument()
    expect(workflowOption).not.toHaveAttribute('data-selected')
    expect(workflowOption.querySelector('.i-ri-check-line')).not.toBeInTheDocument()

    rerender(<AgentLogSourcePicker {...commonProps} value={[sources.workflow.id]} />)

    expect(webappOption).not.toHaveAttribute('data-selected')
    expect(webappOption.querySelector('.i-ri-check-line')).not.toBeInTheDocument()
    expect(workflowOption).toHaveAttribute('data-selected')
    expect(workflowOption.querySelector('.i-ri-check-line')).toBeInTheDocument()
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

    const searchInput = screen.getByRole('combobox', {
      name: 'agentV2.agentDetail.logs.filters.source.searchLabel',
    })
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
    searchInput.focus()
    expect(searchInput).toHaveFocus()

    await user.tab()
    expect(retryButton).toHaveFocus()
    await user.click(retryButton)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
