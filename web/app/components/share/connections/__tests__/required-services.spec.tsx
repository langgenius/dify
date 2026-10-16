import type { RequiredConnectionService } from '../required-services'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import RequiredServices from '../required-services'

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
  },
  {
    id: 'github',
    name: 'GitHub',
    iconClassName: 'i-ri-github-fill',
    description: 'Read repositories to answer questions.',
    availableConnections: [],
    methods: ['oauth'],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Search workspace documentation.',
    availableConnections: [],
    methods: ['api-key'],
  },
  {
    id: 'youtube',
    name: 'YouTube',
    description: 'Find videos related to your questions.',
    availableConnections: [],
    methods: ['oauth', 'api-key'],
  },
]

describe('RequiredServices', () => {
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
      within(notion).getByRole('button', { name: 'share.connections.setup.addApiKey' }),
    )
    await user.click(
      within(youtube).getByRole('button', { name: 'share.connections.setup.connect' }),
    )
    await user.click(
      within(youtube).getByRole('button', { name: 'share.connections.setup.addApiKey' }),
    )

    expect(onConnect.mock.calls).toEqual([
      ['github', 'oauth'],
      ['notion', 'api-key'],
      ['youtube', 'oauth'],
      ['youtube', 'api-key'],
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

    const select = screen.getByRole('combobox', { name: 'Gmail' })
    expect(select).toHaveTextContent('alex@example.com')
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: 'alex@work.example' }))

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
    expect(screen.getByRole('combobox', { name: 'Gmail' })).toHaveTextContent('alex@work.example')
  })
})
