import type { consoleClient } from '@/service/console'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import MCPServerModal from '../mcp-server-modal'

const api = vi.hoisted(() => ({
  create: vi.fn<typeof consoleClient.apps.byAppId.server.post>(),
  update: vi.fn<typeof consoleClient.apps.byAppId.server.put>(),
}))

// boundary: generated network responses only; the form, mutations and Dialog remain real.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.server.post': api.create,
      'apps.byAppId.server.put': api.update,
    }),
  }
})

function Harness({ edit }: { edit: boolean }) {
  const [open, setOpen] = useState(true)
  return (
    open && (
      <MCPServerModal
        appID="app-123"
        show
        onHide={() => setOpen(false)}
        data={
          edit
            ? {
                id: 'server-1',
                server_code: 'code',
                status: 'active',
                description: 'Saved description',
                parameters: { query: 'Saved query' },
              }
            : undefined
        }
        latestParams={[{ variable: 'query', label: 'Query', type: 'string' }]}
      />
    )
  )
}

beforeEach(() => {
  api.create.mockReset()
  api.update.mockReset()
  onTestFinished(guardUnexpectedFetch())
})

it.each([false, true])(
  'protects the submitted draft and allows retry after failure (edit=%s)',
  async (edit) => {
    const pending = createDeferred<Awaited<ReturnType<typeof api.create>>>()
    const operation = edit ? api.update : api.create
    operation.mockReturnValueOnce(pending.promise).mockResolvedValue({
      id: 'server-1',
      name: 'App MCP Server',
      description: 'Draft description',
      parameters: { query: 'Draft query' },
      server_code: 'code',
      status: 'active',
    })
    const { wrapper: Wrapper } = createConsoleQueryWrapper()
    await render(
      <Wrapper>
        <Harness edit={edit} />
      </Wrapper>,
    )
    const dialog = page.getByRole('dialog', {
      name: edit ? 'tools.mcp.server.modal.editTitle' : 'tools.mcp.server.modal.addTitle',
    })
    const description = dialog.getByRole('textbox', { name: 'tools.mcp.server.modal.description' })
    const query = dialog.getByRole('textbox', { name: 'Query' })
    await description.fill('Draft description')
    await query.fill('Draft query')
    const submit = dialog.getByRole('button', {
      name: edit ? 'tools.mcp.modal.save' : 'tools.mcp.server.modal.confirm',
    })
    await submit.click()
    await expect.element(submit).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Enter}{Escape}')
    await expect.element(dialog).toBeVisible()
    await expect
      .element(dialog.getByRole('button', { name: 'tools.mcp.modal.cancel' }))
      .toBeDisabled()
    await expect
      .element(dialog.getByRole('button', { name: 'common.operation.close' }))
      .toBeDisabled()
    expect(operation).toHaveBeenCalledTimes(1)

    pending.reject(new Error('Save failed'))
    await expect.element(submit).not.toHaveAttribute('aria-disabled', 'true')
    await expect.element(description).toHaveValue('Draft description')
    await expect.element(query).toHaveValue('Draft query')
    await submit.click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(operation).toHaveBeenCalledTimes(2)
  },
)
