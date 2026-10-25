import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { DeleteAgentDialog } from '../delete-agent-dialog'

const mutateRequest = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: agentV2 } = await import('@/i18n/locales/en-US/agent-roster.json')
  return createReactI18nextMock({
    'roster.deleteDialog.description': agentV2['roster.deleteDialog.description'],
    'roster.deleteDialog.title': agentV2['roster.deleteDialog.title'],
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.delete': mutateRequest,
    }),
  }
})

describe('DeleteAgentDialog', () => {
  it('explains the deletion impact and waits for the request before notifying the list', async () => {
    const user = userEvent.setup()
    const pending = createDeferred<void>()
    mutateRequest.mockReturnValueOnce(pending.promise)
    const onOpenChange = vi.fn()
    const onDeleted = vi.fn()
    render(
      <DeleteAgentDialog
        agentId="agent-1"
        agentName="Research Agent"
        open
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
      />,
    )

    expect(
      screen.getByText(
        'This permanently deletes Research Agent. Its web app, API access, and workflows that use it stop working immediately.',
      ),
    ).toBeInTheDocument()
    expect(mutateRequest).not.toHaveBeenCalled()
    const confirm = screen.getByRole('button', { name: 'common.operation.delete' })
    await user.click(confirm)
    await waitFor(() =>
      expect(mutateRequest).toHaveBeenCalledExactlyOnceWith({
        params: { agent_id: 'agent-1' },
      }),
    )
    await user.click(confirm)
    expect(mutateRequest).toHaveBeenCalledOnce()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
    await act(async () => pending.resolve())
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })
})
