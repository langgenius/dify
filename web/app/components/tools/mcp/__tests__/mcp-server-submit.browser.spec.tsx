import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import MCPServerModal from '../mcp-server-modal'

// Console routes validate UUID path params and the update payload's server id.
const APP_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
const SERVER_ID = '7a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

const savedServer = {
  id: SERVER_ID,
  name: 'App MCP Server',
  description: 'Draft description',
  parameters: { query: 'Draft query' },
  server_code: 'code',
  status: 'active',
} as const

const fake = setupFakeApi({
  console: {
    apps: { byAppId: { server: { post: () => savedServer, put: () => savedServer } } },
  },
})

function Harness({ edit }: { edit: boolean }) {
  const [open, setOpen] = useState(true)
  return (
    open && (
      <MCPServerModal
        appID={APP_ID}
        show
        onHide={() => setOpen(false)}
        data={
          edit
            ? {
                id: SERVER_ID,
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

it.each([false, true])(
  'protects the submitted draft and allows retry after failure (edit=%s)',
  async (edit) => {
    const server = fake.console.apps.byAppId.server
    const operation = edit ? server.put : server.post
    const pending = hold(operation)
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
    await pending.arrived
    expect(operation).toHaveBeenCalledTimes(1)

    pending.reject(apiError({ status: 500, message: 'Save failed' }))
    await expect.element(submit).not.toHaveAttribute('aria-disabled', 'true')
    await expect.element(description).toHaveValue('Draft description')
    await expect.element(query).toHaveValue('Draft query')
    await submit.click()
    await expect.element(dialog).not.toBeInTheDocument()
    expect(operation).toHaveBeenCalledTimes(2)
    expect(operation).toHaveBeenLastCalledWith({
      params: { app_id: APP_ID },
      body: edit
        ? {
            id: SERVER_ID,
            description: 'Draft description',
            parameters: { query: 'Draft query' },
          }
        : { description: 'Draft description', parameters: { query: 'Draft query' } },
    })
  },
)
