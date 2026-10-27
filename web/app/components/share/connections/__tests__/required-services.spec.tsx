import type { RequiredConnectionService } from '../required-services'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { createDeferred } from '@/test/deferred'
import RequiredServices from '../required-services'
import { credentialSchemas, renderConnectionUi as render } from './credential-schema-fixture'

const services: readonly RequiredConnectionService[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    iconClassName: 'i-ri-mail-line',
    description: 'Read messages to draft replies.',
    availableConnections: [
      { id: 'gmail-personal', name: 'alex@example.com' },
      { id: 'gmail-work', name: 'alex@work.example' },
    ],
    selectedConnectionId: 'gmail-personal',
    methods: ['oauth'],
    credentialSchemas,
  },
  {
    id: 'github',
    name: 'GitHub',
    iconClassName: 'i-ri-github-fill',
    description: 'Read repositories to answer questions.',
    availableConnections: [],
    methods: ['oauth'],
    credentialSchemas,
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Search workspace documentation.',
    availableConnections: [],
    methods: ['api-key'],
    credentialSchemas,
  },
  {
    id: 'youtube',
    name: 'YouTube',
    description: 'Find videos related to your questions.',
    availableConnections: [],
    methods: ['oauth', 'api-key'],
    credentialSchemas,
  },
]

describe('RequiredServices', () => {
  it('closes removal normally and focuses the new Connect action after deleting the final connection', async () => {
    const user = userEvent.setup()
    const deletion = createDeferred()
    const onRemove = vi.fn()
    function LastConnection() {
      const [connections, setConnections] = useState<
        RequiredConnectionService['availableConnections']
      >([{ id: 'last-account', name: 'research@example.com', method: 'oauth', status: 'active' }])
      return (
        <RequiredServices
          services={[
            {
              id: 'source-one',
              name: 'Research provider',
              description: 'Read research documents.',
              methods: ['oauth'],
              availableConnections: connections,
              selectedConnectionId: connections[0]?.id,
            },
          ]}
          onConnect={vi.fn()}
          onConnectionChange={vi.fn()}
          onRemove={async (sourceId, connectionId) => {
            onRemove(sourceId, connectionId)
            await deletion.promise
            setConnections((current) =>
              current.filter((connection) => connection.id !== connectionId),
            )
          }}
        />
      )
    }
    render(<LastConnection />)
    await user.click(screen.getByRole('button', { name: 'Research provider' }))
    const popover = await screen.findByRole('dialog', {
      name: 'share.connections.accounts.title:{"provider":"Research provider"}',
    })
    await user.click(
      within(popover).getByRole('button', {
        name: 'share.connections.accounts.moreActions:{"account":"research@example.com"}',
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'share.connections.accounts.remove' }),
    )
    const confirmation = await screen.findByRole('alertdialog', {
      name: 'app.endUser.disconnectConnectionTitle',
    })
    await user.click(within(confirmation).getByRole('button', { name: 'app.endUser.disconnect' }))
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('source-one', 'last-account')
    await act(async () => deletion.resolve())
    await waitFor(() => expect(confirmation).not.toBeInTheDocument())
    const connect = screen.getByRole('button', { name: 'share.connections.setup.connect' })
    await waitFor(() => expect(connect).toHaveFocus())
    expect(screen.queryByRole('button', { name: 'Research provider' })).not.toBeInTheDocument()
  })

  it('blocks connection operations while a mutation is pending', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    const onConnectionChange = vi.fn()
    const props = { services, onConnect, onConnectionChange }
    render(<RequiredServices {...props} isMutating />)
    const github = screen.getByRole('listitem', { name: 'GitHub' })
    const connect = within(github).getByRole('button', { name: 'share.connections.setup.connect' })
    const selector = screen.getByRole('button', { name: 'Gmail' })
    expect(connect).toBeDisabled()
    expect(selector).toHaveAttribute('aria-disabled', 'true')
    await user.click(connect)
    await user.click(selector)
    expect(onConnect).not.toHaveBeenCalled()
    expect(onConnectionChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps OAuth available while disabling API Key creation without its credential schema', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    render(
      <RequiredServices
        services={[
          {
            id: 'provider',
            name: 'Provider',
            description: 'Read documents.',
            methods: ['oauth', 'api-key'],
            availableConnections: [],
          },
        ]}
        onConnect={onConnect}
        onConnectionChange={vi.fn()}
      />,
    )
    const oauth = screen.getByRole('button', { name: 'share.connections.setup.connect' })
    const apiKey = screen.getByRole('button', { name: 'share.connections.setup.addApiKey' })
    expect(oauth).toBeEnabled()
    expect(apiKey).toHaveAttribute('aria-disabled', 'true')
    await user.click(apiKey)
    expect(onConnect).not.toHaveBeenCalled()
    await user.click(oauth)
    expect(onConnect).toHaveBeenCalledExactlyOnceWith('provider', 'oauth')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it.each(['cancel', 'escape'] as const)(
    'restores focus to a disabled empty-service Add trigger after %s without allowing activation',
    async (dismissal) => {
      const user = userEvent.setup()
      const onConnect = vi.fn()
      const onConnectionChange = vi.fn()
      const props = {
        services: services.filter((service) => service.id === 'notion'),
        onConnect,
        onConnectionChange,
      }
      const { rerender } = render(<RequiredServices {...props} />)
      const trigger = screen.getByRole('button', { name: 'share.connections.setup.addApiKey' })
      await user.click(trigger)
      const dialog = await screen.findByRole('dialog', {
        name: 'share.connections.setup.addApiKey',
      })

      rerender(<RequiredServices {...props} disabled />)
      if (dismissal === 'escape') await user.keyboard('{Escape}')
      else await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
      await waitFor(() => expect(trigger).toHaveFocus())
      expect(trigger).toHaveAttribute('aria-disabled', 'true')

      await user.click(trigger)
      await user.keyboard('{Enter}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onConnect).not.toHaveBeenCalled()
      expect(onConnectionChange).not.toHaveBeenCalled()
    },
  )

  it('creates and selects a key for an empty service only after saving a complete draft', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    const onConnectionChange = vi.fn()
    function ConnectedServices() {
      const [currentServices, setCurrentServices] = useState(
        services.filter((service) => ['gmail', 'notion'].includes(service.id)),
      )
      return (
        <RequiredServices
          services={currentServices}
          onConnectionChange={onConnectionChange}
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
    render(<ConnectedServices />)
    const openAdd = async () => {
      const notion = screen.getByRole('listitem', { name: 'Notion' })
      await user.click(
        within(notion).getByRole('button', { name: 'share.connections.setup.addApiKey' }),
      )
      return screen.findByRole('dialog', { name: 'share.connections.setup.addApiKey' })
    }

    const discarded = await openAdd()
    const name = within(discarded).getByRole('textbox', { name: 'plugin.auth.authorizationName' })
    const apiKey = within(discarded).getByLabelText(/share\.connections\.setup\.apiKey/)
    const save = within(discarded).getByRole('button', { name: 'common.operation.save' })
    expect(name).toHaveValue('')
    expect(apiKey).toHaveValue('')
    expect(save).toBeDisabled()
    await user.type(apiKey, 'sk-draft-secret')
    await user.type(name, '   ')
    expect(save).toBeDisabled()
    await user.clear(name)
    await user.type(name, 'Notion key')
    await user.clear(apiKey)
    await user.type(apiKey, '   ')
    expect(save).toBeDisabled()
    await user.click(within(discarded).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(discarded).not.toBeInTheDocument())
    expect(onConnect).not.toHaveBeenCalled()

    const confirmed = await openAdd()
    expect(
      within(confirmed).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
    ).toHaveValue('')
    expect(within(confirmed).getByLabelText(/share\.connections\.setup\.apiKey/)).toHaveValue('')
    await user.type(
      within(confirmed).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      'Notion key',
    )
    await user.type(
      within(confirmed).getByLabelText(/share\.connections\.setup\.apiKey/),
      'sk-new-secret',
    )
    await user.click(within(confirmed).getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(confirmed).not.toBeInTheDocument())
    expect(onConnect).toHaveBeenCalledExactlyOnceWith('notion', 'api-key', {
      name: 'Notion key',
      credentials: { api_key: 'sk-new-secret' },
    })
    expect(screen.getByRole('button', { name: 'Notion' })).toHaveTextContent('Notion key')
    expect(screen.getByRole('button', { name: 'Gmail' })).toHaveTextContent('alex@example.com')
    expect(onConnectionChange).not.toHaveBeenCalled()
  })

  it('shows each required service and its authorization description', () => {
    render(
      <RequiredServices services={services} onConnect={vi.fn()} onConnectionChange={vi.fn()} />,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    for (const service of services) {
      const row = screen.getByRole('listitem', { name: service.name })
      expect(within(row).getByText(service.description)).toBeVisible()
    }
  })

  it('routes each authorization method to its service without changing other selections', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    const onConnectionChange = vi.fn()
    render(
      <RequiredServices
        services={services}
        onConnect={onConnect}
        onConnectionChange={onConnectionChange}
      />,
    )

    const github = screen.getByRole('listitem', { name: 'GitHub' })
    const notion = screen.getByRole('listitem', { name: 'Notion' })
    const youtube = screen.getByRole('listitem', { name: 'YouTube' })
    expect(
      within(github).getByRole('button', { name: 'share.connections.setup.connect' }),
    ).toHaveAccessibleDescription('GitHub Read repositories to answer questions.')
    expect(
      within(notion).getByRole('button', { name: 'share.connections.setup.addApiKey' }),
    ).toHaveAccessibleDescription('Notion Search workspace documentation.')
    await user.click(
      within(github).getByRole('button', { name: 'share.connections.setup.connect' }),
    )
    await user.click(
      within(youtube).getByRole('button', { name: 'share.connections.setup.connect' }),
    )
    await user.click(
      within(notion).getByRole('button', { name: 'share.connections.setup.addApiKey' }),
    )
    expect(onConnect.mock.calls).toEqual([
      ['github', 'oauth'],
      ['youtube', 'oauth'],
    ])
    const dialog = await screen.findByRole('dialog', { name: 'share.connections.setup.addApiKey' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'plugin.auth.authorizationName' }),
      'Notion key',
    )
    await user.type(
      within(dialog).getByLabelText(/share\.connections\.setup\.apiKey/),
      'sk-notion-secret',
    )
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(onConnect.mock.calls).toEqual([
      ['github', 'oauth'],
      ['youtube', 'oauth'],
      ['notion', 'api-key', { name: 'Notion key', credentials: { api_key: 'sk-notion-secret' } }],
    ])
    expect(onConnectionChange).not.toHaveBeenCalled()
  })

  it('selects an existing connection by its ID and displays the controlled selection', async () => {
    const user = userEvent.setup()
    const onConnect = vi.fn()
    const onConnectionChange = vi.fn()
    const { rerender } = render(
      <RequiredServices
        services={services}
        onConnect={onConnect}
        onConnectionChange={onConnectionChange}
      />,
    )

    const select = screen.getByRole('button', { name: 'Gmail' })
    expect(select).toHaveTextContent('alex@example.com')
    await user.click(select)
    await user.click(await screen.findByRole('button', { name: 'alex@work.example' }))

    expect(onConnectionChange).toHaveBeenCalledExactlyOnceWith('gmail', 'gmail-work')
    expect(onConnect).not.toHaveBeenCalled()
    rerender(
      <RequiredServices
        services={services.map((service) =>
          service.id === 'gmail' ? { ...service, selectedConnectionId: 'gmail-work' } : service,
        )}
        onConnect={onConnect}
        onConnectionChange={onConnectionChange}
      />,
    )
    expect(screen.getByRole('button', { name: 'Gmail' })).toHaveTextContent('alex@work.example')
  })
})
