import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vite-plus/test'
import { createTestQueryClient } from '@/test/query-client'
import WorkspaceOAuthDemo from '../workspace-oauth-demo'

const renderDemo = () =>
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <WorkspaceOAuthDemo />
    </QueryClientProvider>,
  )

const demoRegion = () => screen.getByRole('region', { name: 'Workspace OAuth' })
const connectionTrigger = () =>
  within(demoRegion()).getByRole('button', { name: /^Existing Gmail|^New (OAuth|API Key)/ })
const openCreation = async (
  user: ReturnType<typeof userEvent.setup>,
  method: 'OAuth' | 'API Key',
) => {
  if (method === 'OAuth') {
    await user.click(
      within(demoRegion()).getByRole('button', { name: /plugin.auth.connection.saveWithProvider/ }),
    )
    return screen.findByRole('dialog', { name: /plugin.auth.connection.saveWithProvider/ })
  }
  await user.click(connectionTrigger())
  const picker = await screen.findByRole('dialog', { name: 'plugin.auth.authorization' })
  await user.click(within(picker).getByRole('button', { name: 'plugin.auth.common.addApiKey' }))
  return screen.findByRole('dialog', { name: 'plugin.auth.useApiAuth' })
}
const fillCreation = async (
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  method: 'OAuth' | 'API Key',
) => {
  const name = within(dialog).getByRole('textbox', {
    name: method === 'OAuth' ? 'plugin.auth.connection.name' : 'plugin.auth.authorizationName',
  })
  await user.clear(name)
  await user.type(name, `New ${method}`)
  if (method === 'API Key')
    await user.type(
      within(dialog).getByLabelText('API Key', { exact: false }),
      'demo-api-secret-7A2F',
    )
  return within(dialog).getByRole('button', {
    name: method === 'OAuth' ? 'plugin.auth.connection.save' : 'common.operation.save',
  })
}

describe('Workspace connection creation selection demo', () => {
  // No account data is seeded: the demo must never request a real account profile.
  it.each(['OAuth', 'API Key'] as const)(
    'selects the returned %s identity after successful creation',
    async (method) => {
      const user = userEvent.setup()
      renderDemo()
      expect(connectionTrigger()).toHaveTextContent('Existing Gmail')
      const dialog = await openCreation(user, method)
      await user.click(await fillCreation(user, dialog, method))
      await waitFor(() => expect(dialog).not.toBeInTheDocument())

      expect(connectionTrigger()).toHaveTextContent(`New ${method}`)
      expect(document.body).not.toHaveTextContent('demo-api-secret-7A2F')
      await user.click(connectionTrigger())
      const picker = await screen.findByRole('dialog', { name: 'plugin.auth.authorization' })
      expect(
        within(picker).getByRole('button', { name: new RegExp(`^New ${method}`) }),
      ).toHaveAttribute('aria-pressed', 'true')
      expect(within(picker).getByRole('button', { name: /^Existing Gmail/ })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    },
  )

  it.each(['OAuth', 'API Key'] as const)(
    'keeps the previous selection when %s creation fails and is canceled',
    async (method) => {
      const user = userEvent.setup()
      renderDemo()
      const original = connectionTrigger()
      await user.click(screen.getByRole('checkbox', { name: 'Fail the next save' }))
      const dialog = await openCreation(user, method)
      await user.click(await fillCreation(user, dialog, method))
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('common.api.actionFailed')
      expect(original).toHaveTextContent('Existing Gmail')
      expect(
        within(dialog).getByRole('textbox', {
          name:
            method === 'OAuth' ? 'plugin.auth.connection.name' : 'plugin.auth.authorizationName',
        }),
      ).toHaveValue(`New ${method}`)
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
      await waitFor(() => expect(dialog).not.toBeInTheDocument())

      expect(connectionTrigger()).toHaveTextContent('Existing Gmail')
      await user.click(connectionTrigger())
      const picker = await screen.findByRole('dialog', { name: 'plugin.auth.authorization' })
      expect(
        within(picker).queryByRole('button', { name: new RegExp(`^New ${method}`) }),
      ).not.toBeInTheDocument()
      expect(within(picker).getByRole('button', { name: /^Existing Gmail/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    },
  )
})
