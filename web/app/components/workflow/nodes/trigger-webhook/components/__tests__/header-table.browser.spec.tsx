import type { WebhookHeader } from '../../types'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import HeaderTable from '../header-table'

function Editor() {
  const [headers, setHeaders] = useState<WebhookHeader[]>([
    { name: 'x-request-id', required: false },
  ])
  return <HeaderTable headers={headers} onChange={setHeaders} />
}

it('keeps the edited header and required flag together in the real table', async () => {
  const screen = await render(<Editor />)
  const names = screen.getByRole('textbox', {
    name: 'workflowIntegrations.nodes.triggerWebhook.varName',
  })
  const name = names.first()
  await name.fill('Auth Token')
  await expect.element(name).toHaveValue('Auth_Token')
  await userEvent.tab()
  const required = screen
    .getByRole('checkbox', {
      name: 'workflowIntegrations.nodes.triggerWebhook.required',
    })
    .first()
  await expect.element(required).toHaveFocus()
  await userEvent.keyboard(' ')
  await expect.element(required).toBeChecked()
  await expect.element(name).toHaveValue('Auth_Token')
  await expect.element(names.nth(1)).toHaveValue('')
})

it('keeps readonly headers disabled without a trailing editor or delete action', async () => {
  const screen = await render(
    <HeaderTable
      readonly
      headers={[{ name: 'authorization', required: true }]}
      onChange={vi.fn()}
    />,
  )
  const name = screen.getByRole('textbox')
  await expect.element(name).toHaveValue('authorization')
  await expect.element(name).toBeDisabled()
  const required = screen.getByRole('checkbox')
  await expect.element(required).toBeChecked()
  await expect.element(required).toBeDisabled()
  await expect.element(screen.getByRole('button', { name: 'Delete row' })).not.toBeInTheDocument()
})
