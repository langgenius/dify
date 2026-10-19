import type { RequiredConnectionService } from '../required-services'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import RequiredServices from '../required-services'

const service: RequiredConnectionService = {
  id: 'gmail',
  name: 'Gmail',
  description: 'Read messages to draft replies.',
  methods: ['oauth', 'api-key'],
  availableConnections: [
    { id: 'personal', name: 'alex@example.com', method: 'oauth' },
    { id: 'expired', name: 'expired@example.com', method: 'oauth', status: 'expired' },
    { id: 'key', name: 'Personal key', method: 'api-key', status: 'active' },
  ],
  selectedConnectionId: 'expired',
}

const popoverName = 'share.connections.accounts.title:{"provider":"Gmail"}'
const moreActions = (account: string) =>
  `share.connections.accounts.moreActions:${JSON.stringify({ account })}`

describe('Service connection management', () => {
  it('explains an expired selection and reconnects it without selecting an unusable account', async () => {
    const user = userEvent.setup()
    const onConnectionChange = vi.fn()
    const onReconnect = vi.fn()
    render(
      <RequiredServices
        services={[service]}
        onConnect={vi.fn()}
        onConnectionChange={onConnectionChange}
        onReconnect={onReconnect}
        onRemove={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Gmail' })
    expect(trigger).toHaveTextContent('expired@example.com')
    expect(trigger).toHaveAccessibleDescription(/share.connections.accounts.expired/)
    await user.click(trigger)
    const popover = await screen.findByRole('dialog', { name: popoverName })
    expect(
      within(popover).queryByRole('button', { name: 'expired@example.com' }),
    ).not.toBeInTheDocument()
    expect(within(popover).getByText('share.connections.accounts.reconnectRequired')).toBeVisible()
    await user.click(
      within(popover).getByRole('button', { name: 'share.connections.accounts.reconnect' }),
    )
    expect(onReconnect).toHaveBeenCalledExactlyOnceWith('gmail', 'expired')
    expect(onConnectionChange).not.toHaveBeenCalled()
    expect(trigger).toHaveTextContent('expired@example.com')

    await user.click(within(popover).getByRole('button', { name: 'alex@example.com' }))
    expect(onConnectionChange).toHaveBeenCalledExactlyOnceWith('gmail', 'personal')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: popoverName })).not.toBeInTheDocument(),
    )
  })

  it('routes healthy and expired account menu actions to their IDs without changing the selection', async () => {
    const user = userEvent.setup()
    const onConnectionChange = vi.fn()
    const onReconnect = vi.fn()
    const onRemove = vi.fn()
    render(
      <RequiredServices
        services={[service]}
        onConnect={vi.fn()}
        onConnectionChange={onConnectionChange}
        onReconnect={onReconnect}
        onRemove={onRemove}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Gmail' }))
    const popover = await screen.findByRole('dialog', { name: popoverName })
    const healthyActions = within(popover).getByRole('button', {
      name: moreActions('alex@example.com'),
    })
    await user.click(healthyActions)
    await user.click(
      await screen.findByRole('menuitem', { name: 'share.connections.accounts.reconnect' }),
    )
    expect(onReconnect).toHaveBeenCalledExactlyOnceWith('gmail', 'personal')
    await user.click(healthyActions)
    await user.click(
      await screen.findByRole('menuitem', { name: 'share.connections.accounts.remove' }),
    )
    expect(onRemove).toHaveBeenNthCalledWith(1, 'gmail', 'personal')

    await user.click(
      within(popover).getByRole('button', { name: moreActions('expired@example.com') }),
    )
    const menu = await screen.findByRole('menu')
    expect(
      within(menu).queryByRole('menuitem', { name: 'share.connections.accounts.reconnect' }),
    ).not.toBeInTheDocument()
    await user.click(
      within(menu).getByRole('menuitem', { name: 'share.connections.accounts.remove' }),
    )
    expect(onRemove).toHaveBeenNthCalledWith(2, 'gmail', 'expired')
    expect(onRemove).toHaveBeenCalledTimes(2)
    expect(onConnectionChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Gmail' })).toHaveTextContent('expired@example.com')
  })

  it('adds an OAuth account or API Key through the provider-specific callback', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    render(
      <RequiredServices services={[service]} onConnect={onConnect} onConnectionChange={vi.fn()} />,
    )
    await user.click(screen.getByRole('button', { name: 'Gmail' }))
    const popover = await screen.findByRole('dialog', { name: popoverName })
    await user.click(
      within(popover).getByRole('button', { name: 'share.connections.accounts.addAccount' }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: popoverName })).not.toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: 'Gmail' }))
    const reopenedPopover = await screen.findByRole('dialog', { name: popoverName })
    await user.click(
      within(reopenedPopover).getByRole('button', { name: 'share.connections.setup.addApiKey' }),
    )
    expect(onConnect.mock.calls).toEqual([['gmail', 'oauth']])
    const addDialog = await screen.findByRole('dialog', {
      name: 'share.connections.setup.addApiKey',
    })
    await user.type(
      within(addDialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      'Work key',
    )
    await user.type(
      within(addDialog).getByLabelText(/share\.connections\.setup\.apiKey/),
      'sk-work-secret',
    )
    await user.click(within(addDialog).getByRole('button', { name: 'common.operation.save' }))
    expect(onConnect.mock.calls).toEqual([
      ['gmail', 'oauth'],
      ['gmail', 'api-key', { name: 'Work key', apiKey: 'sk-work-secret' }],
    ])
  })
})
