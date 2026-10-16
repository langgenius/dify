import type { RequiredConnectionService } from '../required-services'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import RequiredConnectionSetup from '../required-connection-setup'

const services: readonly RequiredConnectionService[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read messages to draft replies.',
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
]

describe('RequiredConnectionSetup', () => {
  it('keeps its title, required count, and composed service list in sync', () => {
    const { rerender } = render(
      <RequiredConnectionSetup
        services={services}
        onConnect={vi.fn()}
        onConnectionChange={vi.fn()}
      />,
    )

    const section = screen.getByRole('region', { name: 'share.connections.setup.title' })
    expect(
      within(section).getByRole('heading', {
        level: 2,
        name: 'share.connections.setup.title',
      }),
    ).toBeVisible()
    expect(within(section).getByText('share.connections.setup.required:{"count":2}')).toBeVisible()
    const list = within(section).getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByRole('listitem', { name: 'Gmail' })).toBeVisible()
    expect(within(list).getByRole('listitem', { name: 'Notion' })).toBeVisible()

    rerender(
      <RequiredConnectionSetup
        services={services.slice(1)}
        onConnect={vi.fn()}
        onConnectionChange={vi.fn()}
      />,
    )

    expect(within(section).getByText('share.connections.setup.required:{"count":1}')).toBeVisible()
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).queryByRole('listitem', { name: 'Gmail' })).not.toBeInTheDocument()
    expect(within(list).getByRole('listitem', { name: 'Notion' })).toBeVisible()
  })

  it('hides the setup prompt when the app no longer requires connections', () => {
    const { rerender } = render(
      <RequiredConnectionSetup
        services={services}
        onConnect={vi.fn()}
        onConnectionChange={vi.fn()}
      />,
    )

    rerender(
      <RequiredConnectionSetup services={[]} onConnect={vi.fn()} onConnectionChange={vi.fn()} />,
    )

    expect(
      screen.queryByRole('region', { name: 'share.connections.setup.title' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})
