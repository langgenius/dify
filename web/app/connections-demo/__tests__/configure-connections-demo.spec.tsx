import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vite-plus/test'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import ConfigureConnectionsDemo from '../configure-connections-demo'

describe('Connections configuration demo', () => {
  it.each(['add', 'replace'] as const)(
    'retains a rejected draft and selects a corrected API Key after %s',
    async (mode) => {
      const user = userEvent.setup()
      render(<ConfigureConnectionsDemo />)
      await user.click(screen.getByRole('button', { name: /share.connections.configure.title/ }))
      const configuration = await screen.findByRole('dialog', {
        name: 'share.connections.configure.title',
      })
      const serviceTrigger = within(configuration).getByRole('button', { name: 'Google Search' })
      await user.click(serviceTrigger)
      const picker = await screen.findByRole('dialog', {
        name: 'share.connections.apiKeys.title:{"provider":"Google Search"}',
      })
      const actionOwner =
        mode === 'replace' ? within(picker).getByRole('listitem', { name: 'Personal key' }) : picker
      await user.click(
        within(actionOwner).getByRole('button', {
          name:
            mode === 'add'
              ? 'share.connections.setup.addApiKey'
              : 'share.connections.apiKeys.replace',
        }),
      )
      const editor = await screen.findByRole('dialog', {
        name:
          mode === 'add'
            ? 'share.connections.setup.addApiKey'
            : 'share.connections.apiKeys.replaceTitle',
      })
      const name = within(editor).getByRole('textbox', { name: 'plugin.auth.authorizationName' })
      await user.clear(name)
      await user.type(name, '  Research demo key  ')
      const apiKey = within(editor).getByLabelText('API Key')
      await user.type(apiKey, 'provider-secret')
      const save = within(editor).getByRole('button', { name: 'common.operation.save' })
      expect(save).toBeEnabled()
      await user.click(save)

      expect(await within(editor).findByRole('alert')).toHaveTextContent(
        'share.connections.apiKeys.validationError',
      )
      expect(name).toHaveValue('  Research demo key  ')
      expect(apiKey).toHaveValue('provider-secret')
      expect(serviceTrigger).not.toHaveTextContent('Research demo key')
      await user.clear(apiKey)
      await user.type(apiKey, 'sk-corrected-secret')
      expect(within(editor).queryByRole('alert')).not.toBeInTheDocument()
      await user.click(save)

      await waitFor(() => expect(editor).not.toBeInTheDocument())
      const resumed = await screen.findByRole('dialog', {
        name: 'share.connections.configure.title',
      })
      const trigger = within(resumed).getByRole('button', { name: 'Google Search' })
      expect(trigger).toHaveTextContent('Research demo key')
      expect(trigger).not.toHaveAccessibleDescription(/share.connections.apiKeys.warning/)
      expect(document.body).not.toHaveTextContent('provider-secret')
      expect(document.body).not.toHaveTextContent('sk-corrected-secret')
    },
  )
})
