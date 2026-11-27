import type { RequiredConnectionService } from '../required-services'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { testApiKeySchema } from '@/test/webapp-credential-schema'
import RequiredServices from '../required-services'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const service: RequiredConnectionService = {
  id: 'gmail',
  name: 'Gmail',
  description: 'Read messages to draft replies.',
  methods: ['oauth', 'api-key'],
  apiKeySchema: testApiKeySchema,
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
  it('keeps node validation separate when two authorization sources select the same active account', async () => {
    const user = userEvent.setup()
    const onReconnect = vi.fn()
    const onConnectionChange = vi.fn()
    const sharedAccount = [
      {
        id: 'personal',
        name: 'alex@example.com',
        method: 'oauth' as const,
        status: 'active' as const,
      },
    ]
    render(
      <RequiredServices
        services={[
          {
            ...service,
            id: 'blocked-source',
            name: 'Read private messages',
            selectedConnectionId: 'personal',
            availableConnections: sharedAccount,
            preflight: {
              node_id: 'blocked-source',
              connection_id: 'personal',
              status: 'invalid',
              check: {
                checked_at: 1_700_000_000,
                reason_code: 'credential_invalid',
                retryable: false,
                status: 'invalid',
              },
            },
          },
          {
            ...service,
            id: 'connected-source',
            name: 'Read public messages',
            selectedConnectionId: 'personal',
            availableConnections: sharedAccount,
            preflight: {
              node_id: 'connected-source',
              connection_id: 'personal',
              status: 'connected',
              check: null,
            },
          },
        ]}
        onConnect={vi.fn()}
        onConnectionChange={onConnectionChange}
        onReconnect={onReconnect}
      />,
    )

    const blocked = screen.getByRole('button', { name: 'Read private messages' })
    const connected = screen.getByRole('button', { name: 'Read public messages' })
    expect(blocked).toHaveAccessibleDescription(/share.connections.accounts.reconnectRequired/)
    expect(connected).not.toHaveAccessibleDescription(
      /share.connections.accounts.reconnectRequired/,
    )
    expect(connected).toHaveTextContent('alex@example.com')
    await user.click(blocked)
    const picker = await screen.findByRole('dialog', {
      name: 'share.connections.accounts.title:{"provider":"Read private messages"}',
    })
    await user.click(
      within(picker).getByRole('button', { name: 'share.connections.accounts.reconnect' }),
    )

    expect(onReconnect).toHaveBeenCalledExactlyOnceWith('blocked-source', 'personal')
    expect(onConnectionChange).not.toHaveBeenCalled()
    expect(connected).not.toHaveAccessibleDescription(
      /share.connections.accounts.reconnectRequired/,
    )
  })

  it('retains the selected API Key during a temporary node check failure without offering credential replacement', async () => {
    const user = userEvent.setup()
    render(
      <RequiredServices
        services={[
          {
            ...service,
            selectedConnectionId: 'key',
            preflight: {
              node_id: service.id,
              connection_id: 'key',
              status: null,
              check: {
                checked_at: 1_700_000_000,
                reason_code: 'provider_timeout',
                retryable: true,
                status: 'temporarily_unavailable',
              },
            },
          },
        ]}
        onConnect={vi.fn()}
        onConnectionChange={vi.fn()}
        onReplace={vi.fn()}
        onReconnect={vi.fn()}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Gmail' })
    expect(trigger).toHaveTextContent('Personal key')
    expect(trigger).toHaveAccessibleDescription(/common.api.actionFailed/)
    expect(screen.queryByText('share.connections.apiKeys.warning')).not.toBeInTheDocument()
    expect(
      screen.queryByText('share.connections.accounts.reconnectRequired'),
    ).not.toBeInTheDocument()

    await user.click(trigger)
    const picker = await screen.findByRole('dialog', {
      name: 'share.connections.apiKeys.title:{"provider":"Gmail"}',
    })
    const selectedKey = within(picker).getByRole('listitem', { name: 'Personal key' })
    expect(within(selectedKey).getByText('common.api.actionFailed')).toBeVisible()
    expect(
      within(selectedKey).queryByRole('button', { name: 'share.connections.apiKeys.replace' }),
    ).not.toBeInTheDocument()
    expect(
      within(selectedKey).queryByRole('button', { name: 'share.connections.accounts.reconnect' }),
    ).not.toBeInTheDocument()
  })

  it('offers Reconnect for an invalid OAuth account without API Key error copy or a Replace action', async () => {
    const user = userEvent.setup()
    const onReconnect = vi.fn()
    const onReplace = vi.fn()
    const onConnectionChange = vi.fn()
    render(
      <RequiredServices
        services={[
          {
            ...service,
            selectedConnectionId: 'personal',
            availableConnections: service.availableConnections.map((connection) =>
              connection.id === 'personal'
                ? { ...connection, status: 'invalid' as const }
                : connection,
            ),
          },
        ]}
        onConnect={vi.fn()}
        onConnectionChange={onConnectionChange}
        onReconnect={onReconnect}
        onReplace={onReplace}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Gmail' })
    expect(trigger).toHaveAccessibleDescription(/share.connections.accounts.reconnectRequired/)
    expect(screen.queryByText('share.connections.apiKeys.warning')).not.toBeInTheDocument()
    await user.click(trigger)
    const popover = await screen.findByRole('dialog', { name: popoverName })
    const invalidAccount = within(popover).getByRole('listitem', { name: 'alex@example.com' })
    expect(
      within(invalidAccount).getByText('share.connections.accounts.reconnectRequired'),
    ).toBeVisible()
    expect(
      within(invalidAccount).queryByRole('button', { name: 'share.connections.apiKeys.replace' }),
    ).not.toBeInTheDocument()
    expect(
      within(invalidAccount).queryByText('share.connections.apiKeys.invalid'),
    ).not.toBeInTheDocument()
    const reconnect = within(invalidAccount).getByRole('button', {
      name: 'share.connections.accounts.reconnect',
    })
    expect(reconnect).toBeEnabled()
    await user.click(reconnect)
    expect(onReconnect).toHaveBeenCalledExactlyOnceWith('gmail', 'personal')
    expect(onReplace).not.toHaveBeenCalled()
    expect(onConnectionChange).not.toHaveBeenCalled()
  })

  it('does not toast or change selection when a removal is cancelled by its request scope', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn().mockRejectedValue(new DOMException('App changed', 'AbortError'))
    const onConnectionChange = vi.fn()
    render(
      <RequiredServices
        services={[service]}
        onConnect={vi.fn()}
        onConnectionChange={onConnectionChange}
        onRemove={onRemove}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Gmail' }))
    const popover = await screen.findByRole('dialog', { name: popoverName })
    await user.click(within(popover).getByRole('button', { name: moreActions('alex@example.com') }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'share.connections.accounts.remove' }),
    )
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'app.endUser.disconnectConnectionTitle',
    })
    const confirm = within(confirmation).getByRole('button', { name: 'app.endUser.disconnect' })
    await user.click(confirm)
    await waitFor(() => expect(confirm).not.toHaveAttribute('aria-disabled', 'true'))
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('gmail', 'personal')
    expect(toast.error).not.toHaveBeenCalled()
    expect(onConnectionChange).not.toHaveBeenCalled()
    expect(confirmation).toBeInTheDocument()
    expect(within(confirmation).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('requires confirmation and preserves a failed removal for retry without allowing duplicates', async () => {
    const user = userEvent.setup()
    const request = createDeferred()
    const onRemove = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValueOnce(undefined)
    render(
      <RequiredServices
        services={[service]}
        onConnect={vi.fn()}
        onConnectionChange={vi.fn()}
        onRemove={onRemove}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Gmail' })
    const openRemoval = async () => {
      await user.click(trigger)
      const popover = await screen.findByRole('dialog', { name: popoverName })
      await user.click(
        within(popover).getByRole('button', { name: moreActions('alex@example.com') }),
      )
      await user.click(
        await screen.findByRole('menuitem', { name: 'share.connections.accounts.remove' }),
      )
      return screen.findByRole('alertdialog', { name: 'app.endUser.disconnectConnectionTitle' })
    }
    const cancelled = await openRemoval()
    await user.click(within(cancelled).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(cancelled).not.toBeInTheDocument())
    expect(onRemove).not.toHaveBeenCalled()
    const confirmation = await openRemoval()
    const confirm = within(confirmation).getByRole('button', { name: 'app.endUser.disconnect' })
    await user.click(confirm)
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('gmail', 'personal')
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    expect(
      within(confirmation).getByRole('button', { name: 'common.operation.cancel' }),
    ).toBeDisabled()
    await user.click(confirm)
    await user.keyboard('{Escape}')
    expect(onRemove).toHaveBeenCalledOnce()
    expect(confirmation).toBeInTheDocument()
    await act(async () => {
      request.reject(new Error('Removal failed'))
      await request.promise.catch(() => {})
    })
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('common.api.actionFailed')
    expect(within(confirmation).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(confirmation).getByText('alex@example.com')).toBeVisible()
    await user.click(confirm)
    expect(onRemove).toHaveBeenNthCalledWith(2, 'gmail', 'personal')
    await waitFor(() => expect(confirmation).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(toast.error).toHaveBeenCalledOnce()
  })

  it('opens fixed Replace and Add API Key forms while keeping existing connections selectable', async () => {
    const user = userEvent.setup()
    const onConnectionChange = vi.fn()
    const onReplace = vi.fn()
    render(
      <RequiredServices
        services={[
          {
            ...service,
            selectedConnectionId: 'key',
            availableConnections: service.availableConnections.map((connection) =>
              connection.id === 'key' ? { ...connection, status: 'invalid' as const } : connection,
            ),
          },
        ]}
        onConnect={vi.fn()}
        onConnectionChange={onConnectionChange}
        onReplace={onReplace}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'Gmail' })
    const openPicker = async () => {
      await user.click(trigger)
      return screen.findByRole('dialog', {
        name: 'share.connections.apiKeys.title:{"provider":"Gmail"}',
      })
    }
    let popover = await openPicker()
    await user.click(
      within(popover).getByRole('button', { name: 'share.connections.apiKeys.replace' }),
    )
    const replacement = await screen.findByRole('dialog', {
      name: 'share.connections.apiKeys.replaceTitle',
    })
    await user.type(
      within(replacement).getByLabelText(/share\.connections\.setup\.apiKey/),
      'replacement-secret',
    )
    await user.click(within(replacement).getByRole('button', { name: 'common.operation.save' }))
    expect(onReplace).toHaveBeenCalledExactlyOnceWith('gmail', 'key', {
      name: 'Personal key',
      credentials: { api_key: 'replacement-secret' },
    })
    await waitFor(() => expect(replacement).not.toBeInTheDocument())
    popover = await openPicker()
    await user.click(
      within(popover).getByRole('button', { name: 'share.connections.setup.addApiKey' }),
    )
    const add = await screen.findByRole('dialog', { name: 'share.connections.setup.addApiKey' })
    expect(within(add).getByLabelText(/share\.connections\.setup\.apiKey/)).toHaveValue('')
    await user.click(within(add).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(add).not.toBeInTheDocument())
    popover = await openPicker()
    await user.click(within(popover).getByRole('button', { name: 'alex@example.com' }))
    expect(onConnectionChange).toHaveBeenCalledExactlyOnceWith('gmail', 'personal')
  })

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
    const firstConfirmation = await screen.findByRole('alertdialog', {
      name: 'app.endUser.disconnectConnectionTitle',
    })
    expect(onRemove).not.toHaveBeenCalled()
    await user.click(
      within(firstConfirmation).getByRole('button', { name: 'app.endUser.disconnect' }),
    )
    expect(onRemove).toHaveBeenNthCalledWith(1, 'gmail', 'personal')

    await waitFor(() => expect(firstConfirmation).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Gmail' }))
    const nextPopover = await screen.findByRole('dialog', { name: popoverName })

    await user.click(
      within(nextPopover).getByRole('button', { name: moreActions('expired@example.com') }),
    )
    const menu = await screen.findByRole('menu')
    expect(
      within(menu).queryByRole('menuitem', { name: 'share.connections.accounts.reconnect' }),
    ).not.toBeInTheDocument()
    await user.click(
      within(menu).getByRole('menuitem', { name: 'share.connections.accounts.remove' }),
    )
    const secondConfirmation = await screen.findByRole('alertdialog', {
      name: 'app.endUser.disconnectConnectionTitle',
    })
    await user.click(
      within(secondConfirmation).getByRole('button', { name: 'app.endUser.disconnect' }),
    )
    expect(onRemove).toHaveBeenNthCalledWith(2, 'gmail', 'expired')
    expect(onRemove).toHaveBeenCalledTimes(2)
    expect(onConnectionChange).not.toHaveBeenCalled()
    await waitFor(() => expect(secondConfirmation).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Gmail' })).toHaveTextContent('expired@example.com')
  })

  it.each(['expired', 'key'])(
    'adds either allowed method when the selected connection is %s',
    async (selectedConnectionId) => {
      const pickerName =
        selectedConnectionId === 'key'
          ? 'share.connections.apiKeys.title:{"provider":"Gmail"}'
          : popoverName
      const user = userEvent.setup()
      const onConnect = vi.fn()
      render(
        <RequiredServices
          services={[{ ...service, selectedConnectionId }]}
          onConnect={onConnect}
          onConnectionChange={vi.fn()}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'Gmail' }))
      const popover = await screen.findByRole('dialog', { name: pickerName })
      expect(
        within(popover).getByRole('button', { name: 'share.connections.setup.addApiKey' }),
      ).toBeEnabled()
      await user.click(
        within(popover).getByRole('button', { name: 'share.connections.accounts.addAccount' }),
      )
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: pickerName })).not.toBeInTheDocument(),
      )
      await user.click(screen.getByRole('button', { name: 'Gmail' }))
      const reopenedPopover = await screen.findByRole('dialog', { name: pickerName })
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
        ['gmail', 'api-key', { name: 'Work key', credentials: { api_key: 'sk-work-secret' } }],
      ])
    },
  )

  it.each(['oauth', 'api-key'] as const)(
    'only offers the allowed %s creation method',
    async (method) => {
      const user = userEvent.setup()
      render(
        <RequiredServices
          services={[
            {
              ...service,
              methods: [method],
              selectedConnectionId: method === 'oauth' ? 'personal' : 'key',
              availableConnections: service.availableConnections.filter(
                (connection) => connection.method === method,
              ),
            },
          ]}
          onConnect={vi.fn()}
          onConnectionChange={vi.fn()}
        />,
      )
      await user.click(screen.getByRole('button', { name: 'Gmail' }))
      const picker = await screen.findByRole('dialog')
      const oauthAction = within(picker).queryByRole('button', {
        name: 'share.connections.accounts.addAccount',
      })
      const apiKeyAction = within(picker).queryByRole('button', {
        name: 'share.connections.setup.addApiKey',
      })
      expect(method === 'oauth' ? oauthAction : apiKeyAction).toBeEnabled()
      expect(method === 'oauth' ? apiKeyAction : oauthAction).not.toBeInTheDocument()
    },
  )
})
