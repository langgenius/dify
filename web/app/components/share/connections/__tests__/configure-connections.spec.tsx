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

const invalidService: RequiredConnectionService = {
  id: 'search',
  name: 'Google Search',
  description: 'Search the web.',
  methods: ['api-key'],
  availableConnections: [{ id: 'key', name: 'Personal key', method: 'api-key', status: 'invalid' }],
  selectedConnectionId: 'key',
}

describe('ConfigureConnections', () => {
  it('adds a key in the same configuration surface without changing another service selection', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    function ConnectedConfiguration() {
      const [currentServices, setCurrentServices] = useState(services)
      return (
        <ConfigureConnections
          services={currentServices}
          onConnectionChange={vi.fn()}
          onConnect={(serviceId, method, values) => {
            onConnect(serviceId, method, values)
            if (method !== 'api-key' || !values) return
            setCurrentServices((current) =>
              current.map((service) =>
                service.id === serviceId
                  ? {
                      ...service,
                      availableConnections: [
                        { id: 'new-key', name: values.name, method: 'api-key', status: 'active' },
                      ],
                      selectedConnectionId: 'new-key',
                    }
                  : service,
              ),
            )
          }}
        />
      )
    }
    render(<ConnectedConfiguration />)
    await user.click(screen.getByRole('button', { name: 'share.connections.configure.title' }))
    const configuration = await screen.findByRole('dialog', {
      name: 'share.connections.configure.title',
    })
    const openAdd = async () => {
      const notion = within(configuration).getByRole('listitem', { name: 'Notion' })
      await user.click(
        within(notion).getByRole('button', { name: 'share.connections.setup.addApiKey' }),
      )
      const form = await screen.findByRole('dialog', { name: 'share.connections.setup.addApiKey' })
      expect(form).toBe(configuration)
      expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1)
      expect(
        within(form).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      ).toHaveValue('')
      expect(within(form).getByLabelText(/share\.connections\.setup\.apiKey/)).toHaveValue('')
      return form
    }
    for (const dismissal of ['close', 'escape']) {
      const discarded = await openAdd()
      await user.type(
        within(discarded).getByLabelText(/share\.connections\.setup\.apiKey/),
        'sk-unsaved-secret',
      )
      if (dismissal === 'escape') await user.keyboard('{Escape}')
      else
        await user.click(within(discarded).getByRole('button', { name: 'common.operation.close' }))
      expect(await screen.findByRole('dialog', { name: 'share.connections.configure.title' })).toBe(
        configuration,
      )
      expect(onConnect).not.toHaveBeenCalled()
      expect(within(configuration).getByRole('button', { name: 'Gmail' })).toHaveTextContent(
        'alex@example.com',
      )
    }
    const confirmed = await openAdd()
    await user.type(
      within(confirmed).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      'Notion key',
    )
    await user.type(
      within(confirmed).getByLabelText(/share\.connections\.setup\.apiKey/),
      'sk-notion-secret',
    )
    expect(onConnect).not.toHaveBeenCalled()
    await user.click(within(confirmed).getByRole('button', { name: 'common.operation.save' }))
    const resumed = await screen.findByRole('dialog', { name: 'share.connections.configure.title' })
    expect(resumed).toBe(configuration)
    expect(onConnect).toHaveBeenCalledExactlyOnceWith('notion', 'api-key', {
      name: 'Notion key',
      apiKey: 'sk-notion-secret',
    })
    expect(within(resumed).getByRole('button', { name: 'Notion' })).toHaveTextContent('Notion key')
    expect(within(resumed).getByRole('button', { name: 'Gmail' })).toHaveTextContent(
      'alex@example.com',
    )
  })

  it('returns to the same configuration surface after discarding a replacement and starts the next draft empty', async () => {
    const user = userEvent.setup()
    const onReplace = vi.fn()
    render(
      <ConfigureConnections
        services={[invalidService]}
        onConnect={vi.fn()}
        onConnectionChange={vi.fn()}
        onReplace={onReplace}
      />,
    )
    const trigger = screen.getByRole('button', { name: 'share.connections.configure.title 1' })
    await user.click(trigger)
    const configuration = await screen.findByRole('dialog', {
      name: 'share.connections.configure.title',
    })
    const openReplacement = async () => {
      await user.click(within(configuration).getByRole('button', { name: 'Google Search' }))
      const popover = await screen.findByRole('dialog', {
        name: 'share.connections.apiKeys.title:{"provider":"Google Search"}',
      })
      await user.click(
        within(popover).getByRole('button', { name: 'share.connections.apiKeys.replace' }),
      )
      return screen.findByRole('dialog', { name: 'share.connections.apiKeys.replaceTitle' })
    }

    for (const dismissal of ['cancel', 'close', 'escape']) {
      const replacement = await openReplacement()
      expect(replacement).toBe(configuration)
      expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1)
      const name = within(replacement).getByRole('textbox', {
        name: 'plugin.auth.authorizationName',
      })
      const apiKey = within(replacement).getByLabelText(/share\.connections\.setup\.apiKey/)
      await waitFor(() => expect(name).toHaveFocus())
      expect(name).toHaveValue('Personal key')
      expect(apiKey).toHaveValue('')
      await user.clear(name)
      await user.type(name, 'Unsaved name')
      await user.type(apiKey, 'sk-unsaved-secret')
      if (dismissal === 'escape') await user.keyboard('{Escape}')
      else
        await user.click(
          within(replacement).getByRole('button', { name: `common.operation.${dismissal}` }),
        )
      const resumed = await screen.findByRole('dialog', {
        name: 'share.connections.configure.title',
      })
      expect(resumed).toBe(configuration)
      await waitFor(() =>
        expect(
          within(resumed).getByRole('heading', {
            name: 'share.connections.configure.title',
          }),
        ).toHaveFocus(),
      )
      expect(within(resumed).getByRole('button', { name: 'Google Search' })).toHaveTextContent(
        'Personal key',
      )
      expect(trigger).toHaveAccessibleName('share.connections.configure.title 1')
      expect(onReplace).not.toHaveBeenCalled()
    }

    const reopened = await openReplacement()
    expect(within(reopened).getByLabelText(/share\.connections\.setup\.apiKey/)).toHaveValue('')
    await user.keyboard('{Escape}')
    expect(await screen.findByRole('dialog', { name: 'share.connections.configure.title' })).toBe(
      configuration,
    )
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('keeps the warning count until a replacement is saved and the owner marks the selected key active', async () => {
    const user = userEvent.setup()
    const onReplace = vi.fn()
    function ConnectedConfiguration() {
      const [currentServices, setCurrentServices] = useState([invalidService])
      return (
        <ConfigureConnections
          services={currentServices}
          onConnect={vi.fn()}
          onConnectionChange={vi.fn()}
          onReplace={(serviceId, connectionId, values) => {
            onReplace(serviceId, connectionId, values)
            setCurrentServices((current) =>
              current.map((service) =>
                service.id === serviceId
                  ? {
                      ...service,
                      availableConnections: service.availableConnections.map((connection) =>
                        connection.id === connectionId
                          ? { ...connection, name: values.name, status: 'active' }
                          : connection,
                      ),
                    }
                  : service,
              ),
            )
          }}
        />
      )
    }
    render(<ConnectedConfiguration />)
    const trigger = screen.getByRole('button', { name: 'share.connections.configure.title 1' })
    await user.click(trigger)
    const configuration = await screen.findByRole('dialog', {
      name: 'share.connections.configure.title',
    })
    await user.click(within(configuration).getByRole('button', { name: 'Google Search' }))
    const popover = await screen.findByRole('dialog', {
      name: 'share.connections.apiKeys.title:{"provider":"Google Search"}',
    })
    await user.click(
      within(popover).getByRole('button', { name: 'share.connections.apiKeys.replace' }),
    )
    const replacement = await screen.findByRole('dialog', {
      name: 'share.connections.apiKeys.replaceTitle',
    })
    expect(replacement).toBe(configuration)
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1)
    const replacementName = within(replacement).getByRole('textbox', {
      name: 'plugin.auth.authorizationName',
    })
    await user.clear(replacementName)
    await user.type(replacementName, 'Replacement key')
    await user.type(
      within(replacement).getByLabelText(/share\.connections\.setup\.apiKey/),
      'sk-replacement-key',
    )
    expect(onReplace).not.toHaveBeenCalled()
    expect(trigger).toHaveAccessibleName('share.connections.configure.title 1')

    await user.click(within(replacement).getByRole('button', { name: 'common.operation.save' }))

    expect(onReplace).toHaveBeenCalledExactlyOnceWith('search', 'key', {
      name: 'Replacement key',
      apiKey: 'sk-replacement-key',
    })
    const resumed = await screen.findByRole('dialog', {
      name: 'share.connections.configure.title',
    })
    expect(resumed).toBe(configuration)
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1)
    expect(
      screen.queryByRole('dialog', { name: 'share.connections.apiKeys.replaceTitle' }),
    ).not.toBeInTheDocument()
    expect(trigger).toHaveAccessibleName('share.connections.configure.title')
    expect(within(trigger).queryByText(/^\d+$/)).not.toBeInTheDocument()
    const selectedKey = within(resumed).getByRole('button', { name: 'Google Search' })
    expect(selectedKey).toHaveTextContent('Replacement key')
    expect(selectedKey).not.toHaveAccessibleDescription(/share.connections.apiKeys.warning/)
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('counts only unhealthy selected services and removes the count after recovery or a healthy selection', () => {
    const createService = (
      id: string,
      overrides: Partial<RequiredConnectionService>,
    ): RequiredConnectionService => ({
      id,
      name: id,
      description: 'Connection required by this app.',
      methods: ['oauth', 'api-key'],
      availableConnections: [],
      ...overrides,
    })
    const expired = createService('expired', {
      availableConnections: [
        { id: 'selected', name: 'Selected account', status: 'expired' },
        { id: 'other-expired', name: 'Other expired account', status: 'expired' },
        { id: 'other-invalid', name: 'Other invalid key', method: 'api-key', status: 'invalid' },
      ],
      selectedConnectionId: 'selected',
    })
    const invalid = createService('invalid', {
      availableConnections: [
        { id: 'selected', name: 'Invalid key', method: 'api-key', status: 'invalid' },
        { id: 'backup', name: 'Backup key', method: 'api-key', status: 'active' },
      ],
      selectedConnectionId: 'selected',
    })
    const unaffected = [
      createService('active', {
        availableConnections: [
          { id: 'selected', name: 'Healthy account', status: 'active' },
          { id: 'expired', name: 'Unused expired account', status: 'expired' },
        ],
        selectedConnectionId: 'selected',
      }),
      createService('default-status', {
        availableConnections: [
          { id: 'selected', name: 'Healthy account' },
          { id: 'invalid', name: 'Unused invalid key', method: 'api-key', status: 'invalid' },
        ],
        selectedConnectionId: 'selected',
      }),
      createService('no-selection', {
        availableConnections: [{ id: 'expired', name: 'Expired account', status: 'expired' }],
      }),
      createService('removed-selection', {
        availableConnections: [{ id: 'invalid', name: 'Invalid key', status: 'invalid' }],
        selectedConnectionId: 'removed',
      }),
      createService('no-connections', { selectedConnectionId: 'removed' }),
    ]
    const callbacks = { onConnect: vi.fn(), onConnectionChange: vi.fn() }
    const { rerender } = render(
      <ConfigureConnections services={[expired, invalid, ...unaffected]} {...callbacks} />,
    )

    const trigger = screen.getByRole('button', { name: 'share.connections.configure.title 2' })
    expect(within(trigger).getByText('2')).toBeVisible()

    const recovered = {
      ...expired,
      availableConnections: expired.availableConnections.map((connection) =>
        connection.id === 'selected' ? { ...connection, status: 'active' as const } : connection,
      ),
    }
    rerender(<ConfigureConnections services={[recovered, invalid, ...unaffected]} {...callbacks} />)
    const remainingWarning = screen.getByRole('button', {
      name: 'share.connections.configure.title 1',
    })
    expect(within(remainingWarning).getByText('1')).toBeVisible()

    rerender(
      <ConfigureConnections
        services={[recovered, { ...invalid, selectedConnectionId: 'backup' }, ...unaffected]}
        {...callbacks}
      />,
    )
    const healthyTrigger = screen.getByRole('button', { name: 'share.connections.configure.title' })
    expect(within(healthyTrigger).queryByText(/^\d+$/)).not.toBeInTheDocument()
  })

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
    expect(select).toHaveAttribute('aria-disabled', 'true')
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
    expect(select).not.toHaveAttribute('aria-disabled', 'true')
    expect(connect).toBeEnabled()
    expect(addApiKey).toBeEnabled()
    await user.click(addApiKey)
    expect(onConnect).not.toHaveBeenCalled()
    const addDialog = await screen.findByRole('dialog', {
      name: 'share.connections.setup.addApiKey',
    })
    expect(addDialog).toBe(dialog)
    await user.type(
      within(addDialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      'Notion key',
    )
    await user.type(
      within(addDialog).getByLabelText(/share\.connections\.setup\.apiKey/),
      'sk-notion-secret',
    )
    rerender(
      <ConfigureConnections
        services={services}
        onConnect={onConnect}
        onConnectionChange={onConnectionChange}
        isResponding
      />,
    )
    expect(within(addDialog).getByLabelText(/share\.connections\.setup\.apiKey/)).toBeDisabled()
    expect(within(addDialog).getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
    rerender(
      <ConfigureConnections
        services={services}
        onConnect={onConnect}
        onConnectionChange={onConnectionChange}
      />,
    )
    await user.click(within(addDialog).getByRole('button', { name: 'common.operation.save' }))
    expect(onConnect).toHaveBeenCalledExactlyOnceWith('notion', 'api-key', {
      name: 'Notion key',
      apiKey: 'sk-notion-secret',
    })
    expect(await screen.findByRole('dialog', { name: 'share.connections.configure.title' })).toBe(
      dialog,
    )
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

    expect(accountTrigger).toHaveAttribute('aria-disabled', 'true')
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
