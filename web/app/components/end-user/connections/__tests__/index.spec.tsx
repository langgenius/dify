import type { ConnectionProvider, EndUserConnection } from '../model'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { render } from '@/test/console/render'
import Connections from '..'
import ProviderConnections from '../provider-connections'

const drive: ConnectionProvider = {
  id: 'drive-provider',
  name: 'Google Drive',
  description: 'Connect your documents and spreadsheets',
  iconClassName: 'i-ri-folder-line',
}
const notion: ConnectionProvider = {
  id: 'notion-provider',
  name: 'Notion',
  description: 'Connect your workspace notes',
  iconClassName: 'i-custom-public-common-notion',
}
const oauthConnection: EndUserConnection = {
  id: 'work-oauth',
  name: 'Work Google account',
  type: 'oauth',
  apps: [
    {
      id: 'planning',
      name: 'Planning Assistant',
      description: 'Plan the next project milestone',
      icon: '📅',
      iconBackground: '#E0F2FE',
      href: '/apps/planning',
    },
    {
      id: 'budget',
      name: 'Budget helper',
      description: 'Review your project expenses',
      icon: '💰',
      iconBackground: '#FEF3C7',
      href: '/apps/budget',
    },
  ],
}
const apiConnection: EndUserConnection = {
  id: 'finance-key',
  name: 'Finance API key',
  type: 'api-key',
  apps: [
    {
      id: 'research',
      name: 'Research Reports',
      description: 'Find insights in your reports',
      icon: '📊',
      iconBackground: '#EDE9FE',
      href: '/apps/research',
    },
  ],
}
const connectionLabel = (key: string, connection: EndUserConnection) =>
  `app.endUser.${key}:${JSON.stringify({ name: connection.name })}`
const actionLabel = (connection: EndUserConnection) =>
  connection.type === 'oauth' ? 'app.endUser.disconnect' : 'app.endUser.deleteKey'

const setupProvider = ({
  initialConnections = [oauthConnection, apiConnection],
  onRemove = vi.fn<(connection: EndUserConnection) => void | Promise<void>>(),
}: {
  initialConnections?: readonly EndUserConnection[]
  onRemove?: ReturnType<typeof vi.fn<(connection: EndUserConnection) => void | Promise<void>>>
} = {}) => {
  const Harness = () => {
    const [connections, setConnections] = useState(initialConnections)
    return (
      <ProviderConnections
        provider={drive}
        connections={connections}
        onRemove={async (connection) => {
          await onRemove(connection)
          setConnections((current) => current.filter((item) => item.id !== connection.id))
        }}
      />
    )
  }
  return { ...render(<Harness />), onRemove }
}
const connectionRow = (connection: EndUserConnection) =>
  within(screen.getByRole('table', { name: drive.name })).getByRole('row', {
    name: new RegExp(connection.name),
  })
const openConfirmation = async (
  user: ReturnType<typeof userEvent.setup>,
  connection: EndUserConnection,
) => {
  await user.click(
    within(connectionRow(connection)).getByRole('button', { name: actionLabel(connection) }),
  )
  return screen.findByRole('alertdialog', {
    name:
      connection.type === 'oauth'
        ? 'app.endUser.disconnectConnectionTitle'
        : connectionLabel('deleteKeyTitle', connection),
  })
}

describe('End user Connections', () => {
  it('links each provider identity to its own connection page', () => {
    render(<Connections providers={[drive, notion]} />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'app.endUser.myConnections' }),
    ).toBeVisible()
    expect(screen.getByText('app.endUser.connectionsDescription')).toBeVisible()
    for (const provider of [drive, notion]) {
      const link = screen.getByRole('link', { name: new RegExp(provider.name) })
      expect(link).toHaveAttribute('href', `/connections/${provider.id}`)
      expect(within(link).getByText(provider.description)).toBeVisible()
    }
  })

  it('shows each connection’s linked apps and descriptions in a counted dialog without leaking the previous connection', async () => {
    const user = userEvent.setup()
    setupProvider()
    for (const connection of [oauthConnection, apiConnection]) {
      await user.click(
        within(connectionRow(connection)).getByRole('button', {
          name: `app.endUser.linkedAppCount:${JSON.stringify({ count: connection.apps.length })}`,
        }),
      )
      const dialog = await screen.findByRole('dialog', {
        name: `app.endUser.linkedAppsTitle:${JSON.stringify({ count: connection.apps.length })}`,
      })
      expect(within(dialog).getAllByRole('link')).toHaveLength(connection.apps.length)
      for (const app of connection.apps) {
        const link = within(dialog).getByRole('link', { name: new RegExp(app.name) })
        expect(link).toHaveAttribute('href', app.href)
        expect(within(link).getByText(app.name)).toBeVisible()
        expect(within(link).getByText(app.description)).toBeVisible()
      }
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
      await waitFor(() => expect(dialog).not.toBeInTheDocument())
    }
  })

  it.each([oauthConnection, apiConnection])(
    'cancels and then confirms removal of the $type connection by its own identity',
    async (connection) => {
      const user = userEvent.setup()
      const { onRemove } = setupProvider()
      const canceled = await openConfirmation(user, connection)
      if (connection.type === 'oauth')
        expect(within(canceled).getByText(connection.name, { exact: true })).toBeVisible()
      expect(canceled).toHaveAccessibleDescription(
        connection.type === 'oauth'
          ? 'app.endUser.disconnectConnectionDescription'
          : 'app.endUser.deleteKeyDescription',
      )
      await user.click(within(canceled).getByRole('button', { name: 'common.operation.cancel' }))
      await waitFor(() => expect(canceled).not.toBeInTheDocument())
      expect(onRemove).not.toHaveBeenCalled()
      expect(connectionRow(connection)).toBeVisible()

      const confirmed = await openConfirmation(user, connection)
      await user.click(within(confirmed).getByRole('button', { name: actionLabel(connection) }))
      await waitFor(() => expect(confirmed).not.toBeInTheDocument())

      expect(onRemove).toHaveBeenCalledExactlyOnceWith(connection)
      const remaining = connection.type === 'oauth' ? apiConnection : oauthConnection
      expect(connectionRow(remaining)).toBeVisible()
      expect(
        screen.queryByRole('row', { name: new RegExp(connection.name) }),
      ).not.toBeInTheDocument()
    },
  )

  it('retains a failed key deletion for retry and shows the provider empty state after the last key is removed', async () => {
    const user = userEvent.setup()
    let rejectRemoval!: (error: Error) => void
    const pendingRemoval = new Promise<void>((_resolve, reject) => {
      rejectRemoval = reject
    })
    const onRemove = vi
      .fn<(connection: EndUserConnection) => Promise<void>>()
      .mockReturnValueOnce(pendingRemoval)
      .mockResolvedValueOnce(undefined)
    setupProvider({ initialConnections: [apiConnection], onRemove })
    const dialog = await openConfirmation(user, apiConnection)
    const confirm = within(dialog).getByRole('button', { name: actionLabel(apiConnection) })
    await user.click(confirm)
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    expect(within(dialog).getByRole('button', { name: 'common.operation.cancel' })).toBeDisabled()
    await user.click(confirm)
    expect(onRemove).toHaveBeenCalledOnce()

    await act(async () => {
      rejectRemoval(new Error('Connection removal failed'))
      await pendingRemoval.catch(() => {})
    })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(
      within(screen.getByRole('table', { hidden: true })).getByText(apiConnection.name),
    ).toBeInTheDocument()
    expect(confirm).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(confirm)
    await waitFor(() => expect(dialog).not.toBeInTheDocument())

    expect(onRemove).toHaveBeenCalledTimes(2)
    expect(onRemove).toHaveBeenLastCalledWith(apiConnection)
    expect(screen.getByRole('heading', { name: 'app.endUser.noProviderConnections' })).toBeVisible()
    expect(
      screen.queryByRole('row', { name: new RegExp(apiConnection.name) }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: drive.name }).querySelector('caption')).toHaveFocus()
  })
})
