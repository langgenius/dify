import type { MCPServerDetail } from '@/app/components/tools/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import MCPServerModal from '../mcp-server-modal'

const createServer = vi.fn()
const updateServer = vi.fn()
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.server.post': (input) => createServer(input),
      'apps.byAppId.server.put': (input) => updateServer(input),
    }),
  }
})
const existing: MCPServerDetail = {
  id: 'server-1',
  server_code: 'code',
  status: 'active',
  description: 'Saved description',
  parameters: { query: 'saved query', obsolete: 'removed parameter' },
}

it.each([false, true])(
  'submits current parameters with the correct create/update request (edit=%s)',
  async (edit) => {
    const user = userEvent.setup()
    const onHide = vi.fn()
    const queryClient = createConsoleQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    let resolve!: (value: { result: string }) => void
    const request = new Promise<{ result: string }>((done) => {
      resolve = done
    })
    ;(edit ? updateServer : createServer).mockReturnValueOnce(request)
    renderWithConsoleQuery(
      <MCPServerModal
        appID="app-123"
        show
        onHide={onHide}
        data={edit ? existing : undefined}
        appInfo={{ description: 'App description' }}
        latestParams={[
          { variable: 'query', label: 'Query', type: 'string' },
          { label: 'Missing variable', type: 'string' },
        ]}
      />,
      { queryClient },
    )
    expect(
      screen.getByRole('dialog', {
        name: edit ? 'tools.mcp.server.modal.editTitle' : 'tools.mcp.server.modal.addTitle',
      }),
    ).toBeVisible()
    const description = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
    const query = screen.getByRole('textbox', { name: 'Query' })
    expect(description).toHaveValue(edit ? 'Saved description' : 'App description')
    expect(query).toHaveValue(edit ? 'saved query' : '')
    expect(screen.queryByRole('textbox', { name: 'Missing variable' })).not.toBeInTheDocument()
    await user.clear(description)
    const submit = screen.getByRole('button', {
      name: edit ? 'tools.mcp.modal.save' : 'tools.mcp.server.modal.confirm',
    })
    expect(submit).toBeDisabled()
    await user.click(submit)
    expect(createServer).not.toHaveBeenCalled()
    expect(updateServer).not.toHaveBeenCalled()
    await user.type(description, 'Updated description')
    await user.clear(query)
    await user.type(query, 'updated query')
    await user.click(submit)
    await waitFor(() => expect(submit).toHaveAttribute('aria-disabled', 'true'))
    await user.click(submit)
    expect(edit ? updateServer : createServer).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'app-123' },
      body: {
        ...(edit ? { id: 'server-1' } : {}),
        description: 'Updated description',
        parameters: { query: 'updated query' },
      },
    })
    expect(edit ? createServer : updateServer).not.toHaveBeenCalled()
    expect(onHide).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
    await act(async () => resolve({ result: 'success' }))
    await waitFor(() => expect(onHide).toHaveBeenCalledOnce())
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: consoleQuery.apps.byAppId.server.get.queryKey({
        input: { params: { app_id: 'app-123' } },
      }),
    })
  },
)

it('focuses description and parameter fields through their visible labels', async () => {
  const user = userEvent.setup()
  renderWithConsoleQuery(
    <MCPServerModal
      appID="app-123"
      show
      onHide={vi.fn()}
      latestParams={[{ variable: 'query', label: 'Query', type: 'string' }]}
    />,
  )

  await user.click(screen.getByText('tools.mcp.server.modal.description'))
  const description = screen.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
  expect(description).toHaveFocus()
  expect(description).toBeRequired()
  await user.click(screen.getByText('Query'))
  expect(screen.getByRole('textbox', { name: 'Query' })).toHaveFocus()
})

it.each(['tools.mcp.modal.cancel', 'common.operation.close'])(
  'dismisses via %s without sending a request',
  async (name) => {
    const user = userEvent.setup()
    const onHide = vi.fn()
    renderWithConsoleQuery(<MCPServerModal appID="app-123" show onHide={onHide} />)
    await user.click(screen.getByRole('button', { name }))
    expect(onHide).toHaveBeenCalledOnce()
    expect(createServer).not.toHaveBeenCalled()
    expect(updateServer).not.toHaveBeenCalled()
  },
)
