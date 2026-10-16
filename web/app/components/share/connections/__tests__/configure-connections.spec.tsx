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
    const select = within(dialog).getByRole('combobox', { name: 'Gmail' })
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
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
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
    const select = within(dialog).getByRole('combobox', { name: 'Gmail' })
    expect(select).toHaveTextContent('alex@example.com')
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: /Personal key/ }))
    expect(onConnectionChange).toHaveBeenCalledExactlyOnceWith('gmail', 'gmail-key')
    expect(select).toHaveTextContent('Personal key')
    expect(within(select).getByText('share.connections.setup.apiKey')).toBeVisible()

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(trigger)
    const reopenedDialog = await screen.findByRole('dialog', {
      name: 'share.connections.configure.title',
    })
    const reopenedSelect = within(reopenedDialog).getByRole('combobox', { name: 'Gmail' })
    expect(reopenedSelect).toHaveTextContent('Personal key')
    expect(within(reopenedSelect).getByText('share.connections.setup.apiKey')).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
