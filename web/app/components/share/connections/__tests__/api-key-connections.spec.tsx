import type { RequiredConnectionService } from '../required-services'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import ConfigureConnections from '../configure-connections'
import RequiredServices from '../required-services'

const service: RequiredConnectionService = {
  id: 'google-search',
  name: 'Google Search',
  description: 'Search the web for relevant information.',
  methods: ['oauth', 'api-key'],
  availableConnections: [
    { id: 'invalid-key', name: 'Personal key', method: 'api-key', status: 'invalid' },
    { id: 'backup-key', name: 'Backup key', method: 'api-key', status: 'active' },
  ],
  selectedConnectionId: 'invalid-key',
}

const popoverName = 'share.connections.apiKeys.title:{"provider":"Google Search"}'
const moreActions = (account: string) =>
  `share.connections.accounts.moreActions:${JSON.stringify({ account })}`

describe('API Key connection management', () => {
  it('saves a replacement for the exact invalid key and clears its warning after selecting a valid backup', async () => {
    const user = userEvent.setup()
    const onConnectionChange = vi.fn()
    const onReplace = vi.fn()
    const onReconnect = vi.fn()
    const props = { onConnect: vi.fn(), onConnectionChange, onReplace, onReconnect }
    const { rerender } = render(<RequiredServices services={[service]} {...props} />)

    const trigger = screen.getByRole('button', { name: 'Google Search' })
    expect(trigger).toHaveAccessibleDescription(/share.connections.apiKeys.warning/)
    expect(within(trigger).getByText('share.connections.setup.apiKey')).toBeVisible()
    await user.click(trigger)
    const popover = await screen.findByRole('dialog', { name: popoverName })
    const invalidKey = within(popover).getByRole('listitem', { name: 'Personal key' })
    expect(within(invalidKey).getByText('share.connections.apiKeys.invalid')).toBeVisible()
    expect(
      within(invalidKey).queryByRole('button', { name: 'Personal key' }),
    ).not.toBeInTheDocument()
    await user.click(
      within(invalidKey).getByRole('button', { name: 'share.connections.apiKeys.replace' }),
    )
    const replacement = await screen.findByRole('dialog', {
      name: 'share.connections.apiKeys.replaceTitle',
    })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: popoverName })).not.toBeInTheDocument(),
    )
    expect(onReplace).not.toHaveBeenCalled()
    const name = within(replacement).getByRole('textbox', { name: 'plugin.auth.authorizationName' })
    const apiKey = within(replacement).getByLabelText(/share\.connections\.setup\.apiKey/)
    const save = within(replacement).getByRole('button', { name: 'common.operation.save' })
    expect(name).toHaveValue('Personal key')
    expect(apiKey).toHaveValue('')
    expect(apiKey).toHaveAttribute('type', 'password')
    expect(apiKey).toHaveAttribute('placeholder', 'share.connections.apiKeys.newKeyPlaceholder')
    expect(save).toBeDisabled()
    await user.type(apiKey, '   ')
    expect(save).toBeDisabled()
    await user.clear(apiKey)
    await user.type(apiKey, 'sk-new-api-key')
    await user.clear(name)
    await user.type(name, 'Replacement key')
    await user.click(save)
    expect(onReplace).toHaveBeenCalledExactlyOnceWith('google-search', 'invalid-key', {
      name: 'Replacement key',
      apiKey: 'sk-new-api-key',
    })
    await waitFor(() => expect(replacement).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(onConnectionChange).not.toHaveBeenCalled()
    expect(onReconnect).not.toHaveBeenCalled()
    expect(trigger).toHaveTextContent('Personal key')

    await user.click(trigger)
    const reopenedPopover = await screen.findByRole('dialog', { name: popoverName })
    await user.click(within(reopenedPopover).getByRole('button', { name: 'Backup key' }))
    expect(onConnectionChange).toHaveBeenCalledExactlyOnceWith('google-search', 'backup-key')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: popoverName })).not.toBeInTheDocument(),
    )
    rerender(
      <RequiredServices
        services={[{ ...service, selectedConnectionId: 'backup-key' }]}
        {...props}
      />,
    )

    expect(trigger).toHaveTextContent('Backup key')
    expect(within(trigger).getByText('share.connections.setup.apiKey')).toBeVisible()
    expect(screen.queryByText('share.connections.apiKeys.warning')).not.toBeInTheDocument()
    expect(trigger).not.toHaveAccessibleDescription(/share.connections.apiKeys.warning/)
  })

  it('offers Remove for API Keys and adds keys without exposing OAuth actions', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    const onRemove = vi.fn()
    const onReconnect = vi.fn()
    const onConnectionChange = vi.fn()
    render(
      <RequiredServices
        services={[service]}
        onConnect={onConnect}
        onRemove={onRemove}
        onReconnect={onReconnect}
        onReplace={vi.fn()}
        onConnectionChange={onConnectionChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Google Search' }))
    const popover = await screen.findByRole('dialog', { name: popoverName })
    expect(
      within(popover).queryByRole('button', { name: 'share.connections.accounts.addAccount' }),
    ).not.toBeInTheDocument()
    for (const { name, id } of [
      { name: 'Personal key', id: 'invalid-key' },
      { name: 'Backup key', id: 'backup-key' },
    ]) {
      await user.click(within(popover).getByRole('button', { name: moreActions(name) }))
      const menu = await screen.findByRole('menu')
      expect(
        within(menu).queryByRole('menuitem', { name: 'share.connections.accounts.reconnect' }),
      ).not.toBeInTheDocument()
      await user.click(
        within(menu).getByRole('menuitem', { name: 'share.connections.apiKeys.remove' }),
      )
      expect(onRemove).toHaveBeenLastCalledWith('google-search', id)
    }
    expect(onRemove).toHaveBeenCalledTimes(2)
    expect(onReconnect).not.toHaveBeenCalled()
    expect(onConnectionChange).not.toHaveBeenCalled()
    await user.click(
      within(popover).getByRole('button', { name: 'share.connections.setup.addApiKey' }),
    )
    expect(onConnect).not.toHaveBeenCalled()
    const addDialog = await screen.findByRole('dialog', {
      name: 'share.connections.setup.addApiKey',
    })
    await user.type(
      within(addDialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      'Search key',
    )
    await user.type(
      within(addDialog).getByLabelText(/share\.connections\.setup\.apiKey/),
      'sk-search-secret',
    )
    await user.click(within(addDialog).getByRole('button', { name: 'common.operation.save' }))
    expect(onConnect).toHaveBeenCalledExactlyOnceWith('google-search', 'api-key', {
      name: 'Search key',
      apiKey: 'sk-search-secret',
    })
  })

  it('discards unsaved secrets after cancelling or dismissing a replacement session', async () => {
    const user = userEvent.setup()
    const onReplace = vi.fn()
    render(
      <RequiredServices
        services={[service]}
        onConnect={vi.fn()}
        onConnectionChange={vi.fn()}
        onReplace={onReplace}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Google Search' })
    const openReplacement = async () => {
      await user.click(trigger)
      const popover = await screen.findByRole('dialog', { name: popoverName })
      await user.click(
        within(popover).getByRole('button', { name: 'share.connections.apiKeys.replace' }),
      )
      return screen.findByRole('dialog', { name: 'share.connections.apiKeys.replaceTitle' })
    }

    for (const dismissal of ['cancel', 'close', 'escape']) {
      const dialog = await openReplacement()
      const apiKey = within(dialog).getByLabelText(/share\.connections\.setup\.apiKey/)
      expect(apiKey).toHaveValue('')
      expect(
        within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      ).toHaveValue('Personal key')
      await user.type(apiKey, 'sk-unsaved-api-key')
      if (dismissal === 'escape') await user.keyboard('{Escape}')
      else
        await user.click(
          within(dialog).getByRole('button', { name: `common.operation.${dismissal}` }),
        )
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
      await waitFor(() => expect(trigger).toHaveFocus())
    }

    const reopened = await openReplacement()
    expect(within(reopened).getByLabelText(/share\.connections\.setup\.apiKey/)).toHaveValue('')
    expect(onReplace).not.toHaveBeenCalled()
  })

  it('disables an open invalid-key replacement and other key actions when a response starts', async () => {
    const user = userEvent.setup()
    const onReplace = vi.fn()
    const onConnect = vi.fn()
    const onRemove = vi.fn()
    const onReconnect = vi.fn()
    const onConnectionChange = vi.fn()
    const props = {
      services: [service],
      onReplace,
      onConnect,
      onRemove,
      onReconnect,
      onConnectionChange,
    }
    const { rerender } = render(<ConfigureConnections {...props} />)

    const connectionsTrigger = screen.getByRole('button', {
      name: 'share.connections.configure.title 1',
    })
    await user.click(connectionsTrigger)
    const dialog = await screen.findByRole('dialog', { name: 'share.connections.configure.title' })
    const trigger = within(dialog).getByRole('button', { name: 'Google Search' })
    await user.click(trigger)
    const popover = await screen.findByRole('dialog', { name: popoverName })
    const replace = within(popover).getByRole('button', {
      name: 'share.connections.apiKeys.replace',
    })
    expect(replace).toBeEnabled()

    rerender(<ConfigureConnections {...props} isResponding />)

    expect(trigger).toHaveAttribute('aria-disabled', 'true')
    for (const action of within(popover).getAllByRole('button')) expect(action).toBeDisabled()
    await user.click(replace)
    rerender(<ConfigureConnections {...props} />)
    await user.click(replace)
    const replacement = await screen.findByRole('dialog', {
      name: 'share.connections.apiKeys.replaceTitle',
    })
    expect(replacement).toBe(dialog)
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1)
    const apiKey = within(replacement).getByLabelText(/share\.connections\.setup\.apiKey/)
    await user.type(apiKey, 'sk-new-api-key')
    rerender(<ConfigureConnections {...props} isResponding />)
    expect(apiKey).toBeDisabled()
    expect(
      within(replacement).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
    ).toBeDisabled()
    const save = within(replacement).getByRole('button', { name: 'common.operation.save' })
    expect(save).toBeDisabled()
    await user.click(save)
    await user.click(within(replacement).getByRole('button', { name: 'common.operation.cancel' }))
    const resumed = await screen.findByRole('dialog', { name: 'share.connections.configure.title' })
    expect(resumed).toBe(dialog)
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1)
    expect(within(resumed).getByRole('button', { name: 'Google Search' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(within(resumed).getByRole('button', { name: 'Google Search' })).toHaveTextContent(
      'Personal key',
    )
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(connectionsTrigger).toHaveFocus())
    expect(onReplace).not.toHaveBeenCalled()
    expect(onConnect).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
    expect(onReconnect).not.toHaveBeenCalled()
    expect(onConnectionChange).not.toHaveBeenCalled()
  })
})
