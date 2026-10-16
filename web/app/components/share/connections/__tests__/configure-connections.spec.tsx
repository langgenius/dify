import type { RequiredConnectionService } from '../required-services'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import ConfigureConnections from '../configure-connections'

const services: readonly RequiredConnectionService[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read messages to draft replies.',
    methods: ['oauth', 'api-key'],
    availableConnections: [
      { id: 'gmail-personal', name: 'alex@example.com', method: 'oauth' },
      { id: 'gmail-key', name: 'Personal key', method: 'api-key' },
    ],
    selectedConnectionId: 'gmail-personal',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Search workspace documentation.',
    methods: ['oauth', 'api-key'],
    availableConnections: [],
  },
]

describe('ConfigureConnections', () => {
  it('blocks all connection changes during a response and enables them when the response finishes', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    const onConnectionChange = vi.fn()
    const { rerender } = render(
      <ConfigureConnections
        services={services}
        isResponding
        onConnect={onConnect}
        onConnectionChange={onConnectionChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'share.connections.configure.title' }))
    const dialog = await screen.findByRole('dialog', { name: 'share.connections.configure.title' })
    expect(dialog).toHaveAccessibleDescription('share.connections.configure.runningDescription')
    const select = within(dialog).getByRole('button', { name: 'Gmail' })
    const notion = within(dialog).getByRole('listitem', { name: 'Notion' })
    const connect = within(notion).getByRole('button', { name: 'share.connections.setup.connect' })
    const addApiKey = within(notion).getByRole('button', {
      name: 'share.connections.setup.addApiKey',
    })
    expect(select).toBeDisabled()
    expect(connect).toBeDisabled()
    expect(addApiKey).toBeDisabled()
    await user.click(select)
    await user.click(connect)
    await user.click(addApiKey)
    expect(
      screen.queryByRole('dialog', {
        name: 'share.connections.accounts.title:{"provider":"Gmail"}',
      }),
    ).not.toBeInTheDocument()
    expect(onConnect).not.toHaveBeenCalled()
    expect(onConnectionChange).not.toHaveBeenCalled()

    rerender(
      <ConfigureConnections
        services={services}
        isResponding={false}
        onConnect={onConnect}
        onConnectionChange={onConnectionChange}
      />,
    )

    expect(
      within(dialog).queryByText('share.connections.configure.runningDescription'),
    ).not.toBeInTheDocument()
    expect(select).toBeEnabled()
    expect(connect).toBeEnabled()
    expect(addApiKey).toBeEnabled()
    await user.click(addApiKey)
    expect(onConnect).toHaveBeenCalledExactlyOnceWith('notion', 'api-key')
  })

  it('keeps the controlled connection and API Key label after closing and reopening the dialog', async () => {
    const user = userEvent.setup()
    const onConnectionChange = vi.fn()
    function ControlledConnections() {
      const [selectedConnectionId, setSelectedConnectionId] = useState('gmail-personal')
      return (
        <ConfigureConnections
          services={services.map((service) =>
            service.id === 'gmail' ? { ...service, selectedConnectionId } : service,
          )}
          onConnect={vi.fn()}
          onConnectionChange={(serviceId, connectionId) => {
            onConnectionChange(serviceId, connectionId)
            setSelectedConnectionId(connectionId)
          }}
        />
      )
    }
    render(<ControlledConnections />)

    const trigger = screen.getByRole('button', { name: 'share.connections.configure.title' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'share.connections.configure.title' })
    expect(
      within(dialog).queryByText('share.connections.configure.runningDescription'),
    ).not.toBeInTheDocument()
    const select = within(dialog).getByRole('button', { name: 'Gmail' })
    expect(select).toHaveTextContent('alex@example.com')
    await user.click(select)
    await user.click(await screen.findByRole('button', { name: /Personal key/ }))
    expect(onConnectionChange).toHaveBeenCalledExactlyOnceWith('gmail', 'gmail-key')
    expect(select).toHaveTextContent('Personal key')
    expect(within(select).getByText('share.connections.setup.apiKey')).toBeVisible()

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(trigger)
    const reopenedDialog = await screen.findByRole('dialog', {
      name: 'share.connections.configure.title',
    })
    const reopenedSelect = within(reopenedDialog).getByRole('button', { name: 'Gmail' })
    expect(reopenedSelect).toHaveTextContent('Personal key')
    expect(within(reopenedSelect).getByText('share.connections.setup.apiKey')).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('dismisses a nested account menu and selector before closing the configuration dialog', async () => {
    const user = userEvent.setup()
    render(
      <ConfigureConnections
        services={services}
        onConnect={vi.fn()}
        onConnectionChange={vi.fn()}
        onReconnect={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'share.connections.configure.title' })
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'share.connections.configure.title' })
    const accountTrigger = within(dialog).getByRole('button', { name: 'Gmail' })
    await user.click(accountTrigger)
    const popoverName = 'share.connections.accounts.title:{"provider":"Gmail"}'
    const popover = await screen.findByRole('dialog', { name: popoverName })
    const moreActions = within(popover).getByRole('button', {
      name: 'share.connections.accounts.moreActions:{"account":"alex@example.com"}',
    })
    await user.click(moreActions)
    expect(await screen.findByRole('menu')).toBeVisible()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(popover).toBeVisible()
    expect(dialog).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: popoverName })).not.toBeInTheDocument(),
    )
    expect(dialog).toBeVisible()
    await waitFor(() => expect(accountTrigger).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('revokes open account management actions when a response starts', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    const onConnectionChange = vi.fn()
    const onReconnect = vi.fn()
    const onRemove = vi.fn()
    const props = { services, onConnect, onConnectionChange, onReconnect, onRemove }
    const { rerender } = render(<ConfigureConnections {...props} />)

    await user.click(screen.getByRole('button', { name: 'share.connections.configure.title' }))
    const dialog = await screen.findByRole('dialog', { name: 'share.connections.configure.title' })
    const accountTrigger = within(dialog).getByRole('button', { name: 'Gmail' })
    await user.click(accountTrigger)
    const popover = await screen.findByRole('dialog', {
      name: 'share.connections.accounts.title:{"provider":"Gmail"}',
    })
    await user.click(
      within(popover).getByRole('button', {
        name: 'share.connections.accounts.moreActions:{"account":"alex@example.com"}',
      }),
    )
    expect(await screen.findByRole('menu')).toBeVisible()

    const remove = screen.getByRole('menuitem', { name: 'share.connections.accounts.remove' })
    rerender(<ConfigureConnections {...props} isResponding />)

    expect(accountTrigger).toBeDisabled()
    await waitFor(() => {
      for (const action of screen.queryAllByRole('menuitem'))
        expect(action).toHaveAttribute('aria-disabled', 'true')
      for (const action of within(popover).queryAllByRole('button')) expect(action).toBeDisabled()
    })
    await user.click(remove)
    expect(onConnect).not.toHaveBeenCalled()
    expect(onConnectionChange).not.toHaveBeenCalled()
    expect(onReconnect).not.toHaveBeenCalled()
    expect(onRemove).not.toHaveBeenCalled()
  })
})
