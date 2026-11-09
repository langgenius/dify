import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentPermission } from '@/features/agent-v2/acl'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createAgentFixture } from '@/test/fixtures/agent'
import { AgentRosterList } from '../roster/components/agent-roster-list'

const service = vi.hoisted(() => ({ deleteAgent: vi.fn() }))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: agentRoster } = await import('@/i18n/locales/en-US/agent-roster.json')
  const { default: common } = await import('@/i18n/locales/en-US/common.json')
  return createReactI18nextMock({ ...agentRoster, ...common })
})
vi.mock('@/features/agent-v2/permissions', () => ({ useCanCreateAgents: () => false }))
vi.mock('@/hooks/use-timestamp', () => ({ default: () => ({ formatTime: () => '' }) }))
vi.mock('@/app/components/app/use-export-app-dsl', () => ({
  useExportAppDsl: () => ({ exportAppDsl: vi.fn(), isExporting: false }),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.delete': service.deleteAgent,
    }),
  }
})

const agent = createAgentFixture({
  id: 'agent-1',
  name: 'Research Agent',
  permission_keys: [AgentPermission.Delete],
})

async function openDeletion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More actions for Research Agent' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
  return screen.findByRole('alertdialog')
}

describe('roster agent deletion', () => {
  beforeEach(() => {
    service.deleteAgent.mockReset().mockResolvedValue(undefined)
    render(
      <>
        <h1 id="agent-roster-title">Agents</h1>
        <AgentRosterList
          aria-labelledby="agent-roster-title"
          state={{
            status: 'ready',
            agents: [agent],
            emptyState: 'roster',
            footer: { status: 'none' },
            isFetching: false,
          }}
        />
      </>,
    )
  })

  it('requires the exact name, offers autofill without submitting, and submits with Enter', async () => {
    const user = userEvent.setup()
    await openDeletion(user)
    expect(screen.getByText(/Its web app, API access, and workflows/)).toBeInTheDocument()
    const input = screen.getByRole('textbox', { name: /Type .* to confirm/ })
    expect(input).toHaveAttribute('placeholder', 'Enter agent name')
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    expect(confirm).toBeDisabled()
    await user.type(input, 'research Agent{Enter}')
    expect(service.deleteAgent).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, 'Research Agent {Enter}')
    expect(confirm).toBeDisabled()
    expect(service.deleteAgent).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Autofill' }))
    expect(input).toHaveValue(agent.name)
    expect(confirm).toBeEnabled()
    expect(service.deleteAgent).not.toHaveBeenCalled()
    await user.click(input)
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(service.deleteAgent).toHaveBeenCalledExactlyOnceWith({
        params: { agent_id: agent.id },
      }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('blocks Escape, cancel, edits and duplicate submission until the deletion settles', async () => {
    const user = userEvent.setup()
    const pending = createDeferred<void>()
    service.deleteAgent.mockReturnValueOnce(pending.promise)
    await openDeletion(user)
    await user.click(screen.getByRole('button', { name: 'Autofill' }))
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    await user.click(confirm)
    await waitFor(() => expect(confirm).toHaveAttribute('aria-disabled', 'true'))
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Autofill' })).toBeDisabled()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(cancel).toBeDisabled()
    await user.click(cancel)
    await user.keyboard('{Escape}')
    await user.click(confirm)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(service.deleteAgent).toHaveBeenCalledOnce()
    await act(async () => pending.resolve())
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('keeps the confirmed name after failure and allows retry', async () => {
    const user = userEvent.setup()
    service.deleteAgent.mockRejectedValueOnce(new Error('Deletion failed'))
    await openDeletion(user)
    await user.click(screen.getByRole('button', { name: 'Autofill' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to delete agent')
    expect(screen.getByRole('textbox')).toHaveValue(agent.name)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(service.deleteAgent).toHaveBeenCalledTimes(2)
  })

  it('starts a fresh confirmation session after cancelling a failed deletion', async () => {
    const user = userEvent.setup()
    service.deleteAgent.mockRejectedValueOnce(new Error('Deletion failed'))
    await openDeletion(user)
    await user.click(screen.getByRole('button', { name: 'Autofill' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await openDeletion(user)
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
