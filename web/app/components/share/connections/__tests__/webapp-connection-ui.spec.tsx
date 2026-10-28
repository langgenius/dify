import type { WebAppEntryState } from '../../webapp-entry'
import type { ConnectionsState } from '../use-connections'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { webAppQuery } from '@/service/webapp'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { testApiKeySchema } from '@/test/webapp-credential-schema'
import { WebAppEntryContext } from '../../webapp-entry'
import { ConnectionsContext } from '../use-connections'
import WebAppConnectionControls from '../webapp-connection-controls'
import WebAppConnectionSetup from '../webapp-connection-setup'

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  usePathname: () => '/chat/shared-app',
  useSearchParams: () => new URLSearchParams(),
}))

const connectionId = '11111111-1111-4111-8111-111111111111'
const otherConnectionId = '22222222-2222-4222-8222-222222222222'
const revision = '33333333-3333-4333-8333-333333333333'

function entry(showSignIn = false): WebAppEntryState {
  return {
    status: 'connections-pending',
    account: showSignIn ? 'anonymous' : 'authenticated',
    parameters: {
      account_login_enabled: showSignIn,
      account_login_url: 'https://account.example/signin',
      allow_anonymous_end_user_auth: false,
      requires_end_user_connections: true,
      connection_revision: revision,
      connection_requirements: [],
    },
    canRun: false,
    showSignIn,
  }
}

function state(overrides: Partial<ConnectionsState> = {}): ConnectionsState {
  return {
    getApiKeySchemaOptions: (nodeId) => ({
      ...webAppQuery.connections.credentialSchema.get.queryOptions({
        input: { query: { connection_revision: revision, node_id: nodeId } },
      }),
      queryFn: async () => testApiKeySchema,
    }),
    services: [
      {
        id: 'source-a',
        name: 'Gmail',
        description: 'Read messages to draft replies.',
        methods: ['oauth', 'api-key'],
        availableConnections: [
          { id: connectionId, name: 'alex@example.com', method: 'oauth', status: 'active' },
          { id: otherConnectionId, name: 'work@example.com', method: 'oauth', status: 'active' },
        ],
        selectedConnectionId: connectionId,
        preflight: {
          node_id: 'source-a',
          connection_id: connectionId,
          status: 'connected',
          check: null,
        },
      },
    ],
    selections: { 'source-a': connectionId },
    sourceNodeByNodeId: { 'source-a': 'source-a' },
    onConnect: vi.fn(async () => {}),
    onReplace: vi.fn(async () => {}),
    onRemove: vi.fn(async () => {}),
    onReconnect: vi.fn(async () => {}),
    isMutating: false,
    status: 'ready',
    error: null,
    onConnectionChange: vi.fn(),
    hasMoreConnections: false,
    isFetchingMoreConnections: false,
    loadMoreConnections: vi.fn(),
    retry: vi.fn(),
    canRun: true,
    runConfiguration: { connection_revision: revision, connections: { 'source-a': connectionId } },
    preflight: {
      status: 'ready',
      response: {
        ready: true,
        connection_revision: revision,
        connections: [
          { node_id: 'source-a', connection_id: connectionId, status: 'connected', check: null },
        ],
      },
      error: null,
      canRetry: false,
      retry: vi.fn(),
    },
    ...overrides,
  }
}

function tree(
  connectionState: ConnectionsState | null,
  { onStart = vi.fn(), showSignIn = false, isResponding = false } = {},
) {
  return (
    <WebAppEntryContext value={entry(showSignIn)}>
      <ConnectionsContext value={connectionState}>
        <WebAppConnectionSetup onStart={onStart} />
        <WebAppConnectionControls isResponding={isResponding} />
      </ConnectionsContext>
    </WebAppEntryContext>
  )
}

describe('Webapp connection setup and controls', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'))
  })

  afterEach(() => vi.restoreAllMocks())

  it.each(['outside-provider', 'no-requirements'] as const)('adds no setup for %s', (scenario) => {
    render(
      tree(scenario === 'outside-provider' ? null : state({ status: 'inactive', services: [] })),
    )

    expect(
      screen.queryByRole('button', { name: 'share.connections.setup.startUsingApp' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'share.connections.configure.title' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'share.connections.setup.title' }),
    ).not.toBeInTheDocument()
  })

  it('opens the app only after validation and never starts a run or connection operation', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    const current = state({ canRun: false, runConfiguration: null })
    current.preflight = { ...current.preflight, status: 'checking', response: null }
    const view = render(tree(current, { onStart }))
    const start = screen.getByRole('button', { name: 'share.connections.setup.startUsingApp' })

    expect(start).toBeDisabled()
    await user.click(start)
    expect(onStart).not.toHaveBeenCalled()
    view.rerender(
      tree(
        {
          ...current,
          canRun: true,
          runConfiguration: state().runConfiguration,
          preflight: state().preflight,
        },
        { onStart },
      ),
    )
    expect(start).toBeEnabled()
    await user.click(start)

    expect(onStart).toHaveBeenCalledOnce()
    expect(current.onConnect).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('offers sign-in only when the current app supports it', () => {
    const current = state({ status: 'sign-in-required', canRun: false, runConfiguration: null })
    const view = render(tree(current))
    expect(
      screen.queryByRole('button', { name: 'share.connections.required.signIn' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'share.auth.signIn' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'share.connections.required.title' })).toBeVisible()

    view.rerender(tree(current, { showSignIn: true }))

    expect(screen.getByRole('button', { name: 'share.connections.required.signIn' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'share.auth.signIn' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'share.connections.setup.startUsingApp' }),
    ).not.toBeInTheDocument()
  })

  it.each(['read', 'preflight'] as const)(
    'retries a temporary %s failure only on request',
    async (failure) => {
      const user = userEvent.setup()
      const current = state({ canRun: false, runConfiguration: null })
      if (failure === 'read') {
        current.status = 'error'
        current.error = new Error('Connection list unavailable')
      } else {
        current.preflight = {
          ...current.preflight,
          status: 'error',
          error: new Error('Preflight unavailable'),
          canRetry: true,
          response: null,
        }
      }
      render(tree(current))
      expect(screen.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
      expect(
        screen.getByRole('button', { name: 'share.connections.setup.startUsingApp' }),
      ).toBeDisabled()
      expect(current.retry).not.toHaveBeenCalled()
      expect(current.preflight.retry).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

      expect(failure === 'read' ? current.retry : current.preflight.retry).toHaveBeenCalledOnce()
      expect(failure === 'read' ? current.preflight.retry : current.retry).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'share.connections.configure.title' }))
      const dialog = await screen.findByRole('dialog', {
        name: 'share.connections.configure.title',
      })
      expect(within(dialog).getByRole('alert')).toHaveTextContent('common.api.actionFailed')
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.retry' }))
      expect(failure === 'read' ? current.retry : current.preflight.retry).toHaveBeenCalledTimes(2)
    },
  )

  it('shares the selected connection with the dialog and locks its editing during a response', async () => {
    const user = userEvent.setup()
    const current = state()
    const view = render(tree(current))
    await user.click(screen.getByRole('button', { name: 'share.connections.configure.title' }))
    const dialog = await screen.findByRole('dialog', { name: 'share.connections.configure.title' })
    const selector = within(dialog).getByRole('button', { name: 'Gmail' })
    expect(selector).toHaveTextContent('alex@example.com')
    await user.click(selector)
    await user.click(await screen.findByRole('button', { name: 'work@example.com' }))
    expect(current.onConnectionChange).toHaveBeenCalledExactlyOnceWith(
      'source-a',
      otherConnectionId,
    )

    const updated = {
      ...current,
      services: current.services.map((service) => ({
        ...service,
        selectedConnectionId: otherConnectionId,
      })),
    }
    view.rerender(tree(updated, { isResponding: true }))

    expect(selector).toHaveTextContent('work@example.com')
    expect(selector).toHaveAttribute('aria-disabled', 'true')
    expect(within(dialog).getByText('share.connections.configure.runningDescription')).toBeVisible()
    await user.click(selector)
    expect(
      screen.queryByRole('dialog', {
        name: 'share.connections.accounts.title:{"provider":"Gmail"}',
      }),
    ).not.toBeInTheDocument()
    expect(current.onConnectionChange).toHaveBeenCalledOnce()
  })

  it('counts an invalid node check even when the connection itself is active', async () => {
    const user = userEvent.setup()
    const current = state()
    current.services[0]!.preflight = {
      node_id: 'source-a',
      connection_id: connectionId,
      status: 'invalid',
      check: null,
    }
    render(tree(current))

    await user.click(screen.getByRole('button', { name: 'share.connections.configure.title 1' }))

    const dialog = await screen.findByRole('dialog', { name: 'share.connections.configure.title' })
    expect(within(dialog).getByText('share.connections.accounts.reconnectRequired')).toBeVisible()
  })
})
