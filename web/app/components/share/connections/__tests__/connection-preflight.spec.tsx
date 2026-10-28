import type {
  ConnectionPreflightStatus,
  EndUserConnectionPreflightPayload,
  EndUserConnectionPreflightResponse,
  EndUserConnectionResponse,
  WebAppConnectionRequirement,
} from '@dify/contracts/api/web/types.gen'
import type { WebAppEntryState } from '../../webapp-entry'
import type { WebAppAddress } from '@/service/webapp-address'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { captureAppAccessScope } from '@/features/app-access-error/state'
import { setWebAppAccessToken, setWebAppPassport } from '@/service/webapp-auth'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import { WebAppEntryContext } from '../../webapp-entry'
import { WebAppConnectionsProvider } from '../connection-provider'
import { useWebAppConnections } from '../use-connections'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/service/refresh-token', () => ({ refreshAccessTokenOrReLogin: vi.fn() }))

const address = { kind: 'default', code: 'preflight-app' } as const
const firstId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const conversationId = '33333333-3333-4333-8333-333333333333'
const parametersRevision = '44444444-4444-4444-8444-444444444444'
const checkedRevision = '55555555-5555-4555-8555-555555555555'
const provider = 'langgenius/github/github'
const requirements: WebAppConnectionRequirement[] = [
  {
    node_id: 'source-a',
    node_ids: ['source-a', 'reuse-a'],
    provider,
    allowed_credential_types: ['oauth2', 'api-key'],
    provider_label: 'GitHub',
    plugin_unique_identifier: 'langgenius/github:1.0.0@digest',
    title: 'Find repositories',
    purpose: 'Read repositories for a brief.',
    icon: '/github.svg',
    icon_dark: null,
  },
  {
    node_id: 'source-b',
    node_ids: ['source-b'],
    provider,
    allowed_credential_types: ['oauth2'],
    provider_label: 'GitHub',
    plugin_unique_identifier: 'langgenius/github:1.0.0@digest',
    title: 'Read README',
    purpose: 'Read the documentation.',
    icon: '/github.svg',
    icon_dark: null,
  },
]

function connection(overrides: Partial<EndUserConnectionResponse> = {}): EndUserConnectionResponse {
  return {
    id: firstId,
    name: 'Personal GitHub',
    account_label: 'personal@example.com',
    provider,
    credential_type: 'oauth2',
    credential_status: 'connected',
    expires_at: null,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    last_active_at: 1_700_000_000,
    ...overrides,
  }
}

const personal = connection()
const work = connection({ id: secondId, name: 'Work GitHub', account_label: 'work@example.com' })

type ReadyEntry = Extract<WebAppEntryState, { parameters: unknown }>

function entry(parameters: Partial<ReadyEntry['parameters']> = {}): ReadyEntry {
  return {
    status: 'connections-pending',
    account: 'authenticated',
    parameters: {
      account_login_enabled: true,
      account_login_url: 'https://account.example/signin',
      allow_anonymous_end_user_auth: false,
      connection_revision: parametersRevision,
      requires_end_user_connections: true,
      connection_requirements: requirements,
      ...parameters,
    },
    canRun: false,
    showSignIn: false,
  }
}

function checked(
  overrides: Partial<EndUserConnectionPreflightResponse> = {},
): EndUserConnectionPreflightResponse {
  return {
    connection_revision: checkedRevision,
    ready: true,
    connections: [
      { node_id: 'source-a', connection_id: firstId, status: 'connected', check: null },
      { node_id: 'source-b', connection_id: secondId, status: 'connected', check: null },
    ],
    ...overrides,
  }
}

type Backend = {
  configuration: () => Response | Promise<Response>
  records: EndUserConnectionResponse[]
  replace: () => Response | Promise<Response>
  preflight: (
    body: EndUserConnectionPreflightPayload,
    index: number,
  ) => Response | Promise<Response>
}

function installBackend() {
  const bodies: EndUserConnectionPreflightPayload[] = []
  const requests: Request[] = []
  const backend: Backend = {
    configuration: () => Response.json({ connections: { 'source-a': personal, 'source-b': work } }),
    records: [personal, work],
    replace: () => Response.json(personal),
    preflight: () => Response.json(checked()),
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    requests.push(request)
    const path = new URL(request.url).pathname
    if (path.endsWith('/connections/configuration')) return backend.configuration()
    if (path.endsWith('/connections/preflight')) {
      const body = (await request.json()) as EndUserConnectionPreflightPayload
      bodies.push(body)
      return backend.preflight(body, bodies.length - 1)
    }
    if (path.endsWith(`/connections/${firstId}/revision`))
      return Response.json({ connection_revision: parametersRevision })
    if (path.endsWith(`/connections/${firstId}`) && request.method === 'PATCH')
      return backend.replace()
    if (path.endsWith('/connections'))
      return Response.json({ data: backend.records, has_more: false, next_cursor: null })
    throw new Error(`Unexpected request: ${request.method} ${path}`)
  })
  return { backend, bodies, requests }
}

const onRun = vi.fn()

function Consumer() {
  const state = useWebAppConnections()
  return (
    <>
      <button type="button" disabled={!state.canRun} onClick={() => onRun(state.runConfiguration)}>
        Run
      </button>
      <button type="button" onClick={state.preflight.retry}>
        Retry validation
      </button>
      <button
        type="button"
        onClick={() => {
          void state
            .onReplace('source-a', firstId, {
              name: 'Personal GitHub',
              credentials: { api_key: 'replacement-secret' },
            })
            .catch(() => {})
        }}
      >
        Replace API Key
      </button>
      <button type="button" onClick={state.retry}>
        Refresh connections
      </button>
      <button type="button" onClick={() => state.onConnectionChange('reuse-a', secondId)}>
        Choose work connection
      </button>
      <output aria-label="Validation status">{state.preflight.status}</output>
      <output aria-label="Validation error">{state.preflight.error?.message ?? ''}</output>
      <output aria-label="Retry available">{String(state.preflight.canRetry)}</output>
      <output aria-label="Selected connections">{JSON.stringify(state.selections)}</output>
      <output aria-label="Node validation">
        {JSON.stringify(
          Object.fromEntries(state.services.map((service) => [service.id, service.preflight])),
        )}
      </output>
    </>
  )
}

function selections(): Record<string, string | null> {
  return JSON.parse(screen.getByLabelText('Selected connections').textContent || '{}')
}

function validations(): Record<string, ConnectionPreflightStatus> {
  return JSON.parse(screen.getByLabelText('Node validation').textContent || '{}')
}

type Scope = { entry: WebAppEntryState; conversationId?: string; address?: WebAppAddress }

describe('Webapp connection preflight', () => {
  let queryClient: ReturnType<typeof createTestQueryClient>

  const tree = (scope: Scope = { entry: entry() }) => (
    <QueryClientProvider client={queryClient}>
      <WebAppEntryContext value={scope.entry}>
        <WebAppConnectionsProvider
          address={scope.address ?? address}
          conversationId={scope.conversationId}
        >
          <Consumer />
        </WebAppConnectionsProvider>
      </WebAppEntryContext>
    </QueryClientProvider>
  )

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    captureAppAccessScope()
    window.history.replaceState({}, '', '/chat/preflight-app')
    setWebAppAccessToken('account-a', 'end_user')
    setWebAppPassport(address, 'app-passport')
    queryClient = createTestQueryClient()
  })

  afterEach(() => {
    queryClient.clear()
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    captureAppAccessScope()
  })

  it('waits for configuration and sends only explicit source IDs, including null, for the existing conversation', async () => {
    const configuration = createDeferred<Response>()
    const check = createDeferred<Response>()
    const { backend, bodies, requests } = installBackend()
    backend.configuration = () => configuration.promise
    backend.preflight = () => check.promise
    render(tree({ entry: entry(), conversationId }))

    await waitFor(() => expect(requests).toHaveLength(2))
    expect(bodies).toEqual([])
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()

    await act(async () => {
      configuration.resolve(
        Response.json({ connections: { 'source-a': personal, 'source-b': null } }),
      )
    })
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({
      connection_revision: parametersRevision,
      conversation_id: conversationId,
      connections: { 'source-a': firstId, 'source-b': null },
    })
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()

    await act(async () => {
      check.resolve(
        Response.json(
          checked({
            ready: false,
            connections: [
              { node_id: 'source-a', connection_id: firstId, status: 'connected', check: null },
              { node_id: 'source-b', connection_id: null, status: 'disconnected', check: null },
            ],
          }),
        ),
      )
    })
    await waitFor(() =>
      expect(screen.getByLabelText('Validation status')).toHaveTextContent('blocked'),
    )
    expect(selections()).toEqual({ 'source-a': firstId, 'source-b': null })
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  })

  it('uses node IDs rather than row order and passes the compatible response revision to Run', async () => {
    const user = userEvent.setup()
    const { backend, bodies } = installBackend()
    backend.preflight = () =>
      Response.json(
        checked({
          connections: [
            { node_id: 'source-b', connection_id: secondId, status: 'connected', check: null },
            {
              node_id: 'source-a',
              connection_id: firstId,
              status: 'connected',
              check: {
                checked_at: 1_700_000_001,
                status: 'unsupported',
                reason_code: null,
                retryable: false,
              },
            },
          ],
        }),
      )
    render(tree())

    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled())
    expect(validations()['source-a']).toMatchObject({
      connection_id: firstId,
      check: { status: 'unsupported' },
    })
    expect(validations()['source-b']).toMatchObject({
      connection_id: secondId,
      status: 'connected',
    })
    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(onRun).toHaveBeenCalledExactlyOnceWith({
      connection_revision: checkedRevision,
      connections: { 'source-a': firstId, 'source-b': secondId },
    })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.connection_revision).toBe(parametersRevision)
  })

  it('retains the selection on a temporary check failure and enables Run only after an explicit successful retry', async () => {
    const user = userEvent.setup()
    const { backend, bodies } = installBackend()
    backend.preflight = (_, index) =>
      Response.json(
        index === 0
          ? checked({
              ready: false,
              connections: [
                {
                  node_id: 'source-a',
                  connection_id: firstId,
                  status: null,
                  check: {
                    checked_at: 1_700_000_001,
                    status: 'temporarily_unavailable',
                    reason_code: 'provider_timeout',
                    retryable: true,
                  },
                },
                { node_id: 'source-b', connection_id: secondId, status: 'connected', check: null },
              ],
            })
          : checked(),
      )
    render(tree())

    await waitFor(() =>
      expect(screen.getByLabelText('Validation status')).toHaveTextContent('blocked'),
    )
    expect(validations()['source-a']).toMatchObject({
      status: null,
      check: { reason_code: 'provider_timeout', retryable: true },
    })
    expect(selections()).toEqual({ 'source-a': firstId, 'source-b': secondId })
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    const retry = screen.getByRole('button', { name: 'Retry validation' })
    expect(screen.getByLabelText('Retry available')).toHaveTextContent('true')
    await user.click(retry)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled())
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toEqual(bodies[0])
  })

  it.each(['invalid', 'reconnect_required', 'disconnected'] as const)(
    'blocks a node with %s status even while its connection summary is active',
    async (status) => {
      const { backend } = installBackend()
      backend.preflight = () =>
        Response.json(
          checked({
            ready: false,
            connections: [
              { node_id: 'source-a', connection_id: firstId, status, check: null },
              { node_id: 'source-b', connection_id: secondId, status: 'connected', check: null },
            ],
          }),
        )
      render(tree())

      await waitFor(() =>
        expect(screen.getByLabelText('Validation status')).toHaveTextContent('blocked'),
      )
      expect(validations()['source-a']?.status).toBe(status)
      expect(selections()['source-a']).toBe(firstId)
      expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    },
  )

  it.each([
    { status: 503, code: 'credential_check_unavailable', retryable: true },
    { status: 409, code: 'connection_conflict', retryable: true },
    { status: 409, code: 'connection_revision_changed', retryable: false },
  ])(
    'does not automatically retry a $status response or discard the selected connections',
    async ({ status, code, retryable }) => {
      const user = userEvent.setup()
      const { backend, bodies, requests } = installBackend()
      backend.preflight = (_, index) =>
        index === 0
          ? Response.json({ status, code, message: 'The check is unavailable.' }, { status })
          : Response.json(checked())
      render(tree())

      await waitFor(() =>
        expect(screen.getByLabelText('Validation status')).toHaveTextContent('error'),
      )
      expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
      expect(selections()).toEqual({ 'source-a': firstId, 'source-b': secondId })
      expect(screen.getByLabelText('Validation error')).not.toBeEmptyDOMElement()
      expect(screen.getByLabelText('Retry available')).toHaveTextContent(String(retryable))
      expect(bodies).toHaveLength(1)
      if (!retryable) {
        await user.click(screen.getByRole('button', { name: 'Retry validation' }))
        await user.click(screen.getByRole('button', { name: 'Refresh connections' }))
        await waitFor(() =>
          expect(
            requests.filter((request) => new URL(request.url).pathname.endsWith('/configuration')),
          ).toHaveLength(2),
        )
        expect(bodies).toHaveLength(1)
        expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
      } else {
        await user.click(screen.getByRole('button', { name: 'Retry validation' }))
        await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled())
        expect(bodies).toHaveLength(2)
      }
    },
  )

  it('keeps the draft after a network failure and checks it again only on manual retry', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { backend, bodies } = installBackend()
    backend.preflight = (_, index) => {
      if (index === 0) throw new TypeError('Failed to fetch')
      return Response.json(checked())
    }
    render(tree())

    await waitFor(() =>
      expect(screen.getByLabelText('Validation status')).toHaveTextContent('error'),
    )
    expect(selections()).toEqual({ 'source-a': firstId, 'source-b': secondId })
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(screen.getByLabelText('Retry available')).toHaveTextContent('true')
    expect(bodies).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Retry validation' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled())
    expect(bodies).toHaveLength(2)
  })

  it('ignores a late successful check for the previous selection', async () => {
    const user = userEvent.setup()
    const previous = createDeferred<Response>()
    const current = createDeferred<Response>()
    const { backend, bodies } = installBackend()
    backend.preflight = (_, index) => (index === 0 ? previous.promise : current.promise)
    render(tree())
    await waitFor(() => expect(bodies).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: 'Choose work connection' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]?.connections).toEqual({ 'source-a': secondId, 'source-b': secondId })
    await act(async () => {
      previous.resolve(Response.json(checked()))
    })
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(validations()['source-a']).toBeUndefined()
    await act(async () => {
      current.resolve(
        Response.json(
          checked({
            connections: [
              { node_id: 'source-a', connection_id: secondId, status: 'connected', check: null },
              { node_id: 'source-b', connection_id: secondId, status: 'connected', check: null },
            ],
          }),
        ),
      )
    })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(onRun).toHaveBeenCalledExactlyOnceWith({
      connection_revision: checkedRevision,
      connections: { 'source-a': secondId, 'source-b': secondId },
    })
  })

  it('requires a new check when authorization requirements change even if the selection and revision remain the same', async () => {
    const secondCheck = createDeferred<Response>()
    const { backend, bodies } = installBackend()
    backend.preflight = (_, index) => (index === 0 ? Response.json(checked()) : secondCheck.promise)
    const view = render(tree())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled())

    view.rerender(
      tree({
        entry: entry({
          connection_requirements: requirements.map((requirement) =>
            requirement.node_id === 'source-a'
              ? { ...requirement, allowed_credential_types: ['oauth2'] }
              : requirement,
          ),
        }),
      }),
    )

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]).toEqual(bodies[0])
    await act(async () => {
      secondCheck.resolve(Response.json(checked()))
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled())
  })

  it('invalidates the previous check when a refresh reports changed credentials', async () => {
    const user = userEvent.setup()
    const recheck = createDeferred<Response>()
    const { backend, bodies } = installBackend()
    backend.preflight = (_, index) => (index === 0 ? Response.json(checked()) : recheck.promise)
    render(tree())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled())
    backend.records = [
      connection({ credential_status: 'invalid', updated_at: 1_700_000_001 }),
      work,
    ]

    await user.click(screen.getByRole('button', { name: 'Refresh connections' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    await act(async () => {
      recheck.resolve(
        Response.json(
          checked({
            ready: false,
            connections: [
              { node_id: 'source-a', connection_id: firstId, status: 'invalid', check: null },
              { node_id: 'source-b', connection_id: secondId, status: 'connected', check: null },
            ],
          }),
        ),
      )
    })
    await waitFor(() =>
      expect(screen.getByLabelText('Validation status')).toHaveTextContent('blocked'),
    )
    expect(selections()['source-a']).toBe(firstId)
  })

  it('rechecks a replaced credential even when its public summary and connection ID have not changed', async () => {
    const user = userEvent.setup()
    const replacement = createDeferred<Response>()
    const recheck = createDeferred<Response>()
    const { backend, bodies } = installBackend()
    const apiKey = connection({ credential_type: 'api-key' })
    backend.records = [apiKey, work]
    backend.configuration = () =>
      Response.json({ connections: { 'source-a': apiKey, 'source-b': work } })
    backend.replace = () => replacement.promise
    backend.preflight = (_, index) => (index === 0 ? Response.json(checked()) : recheck.promise)
    render(tree())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled())

    await user.click(screen.getByRole('button', { name: 'Replace API Key' }))
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    await act(async () => {
      replacement.resolve(Response.json(apiKey))
    })
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]).toEqual(bodies[0])
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    await act(async () => {
      recheck.resolve(Response.json(checked()))
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled())
  })

  it.each(['conversation', 'account'] as const)(
    'ignores a successful check from the previous %s',
    async (changed) => {
      const previous = createDeferred<Response>()
      const current = createDeferred<Response>()
      const { backend, bodies } = installBackend()
      backend.preflight = (_, index) => (index === 0 ? previous.promise : current.promise)
      const view = render(tree({ entry: entry(), conversationId }))
      await waitFor(() => expect(bodies).toHaveLength(1))

      if (changed === 'conversation') {
        view.rerender(
          tree({ entry: entry(), conversationId: '66666666-6666-4666-8666-666666666666' }),
        )
      } else {
        act(() => {
          setWebAppAccessToken('account-b', 'end_user')
          setWebAppPassport(address, 'account-b-passport')
        })
      }
      await waitFor(() => expect(bodies).toHaveLength(2))
      await act(async () => {
        previous.resolve(Response.json(checked()))
      })
      expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
      await act(async () => {
        current.resolve(Response.json(checked()))
      })
      await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled())
      if (changed === 'conversation') {
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: 'Run' }))
        expect(onRun).toHaveBeenCalledWith(
          expect.objectContaining({ conversation_id: '66666666-6666-4666-8666-666666666666' }),
        )
      }
    },
  )

  it('does not let a mismatched connection in an otherwise ready response authorize the selected connection', async () => {
    const { backend } = installBackend()
    backend.preflight = () =>
      Response.json(
        checked({
          connections: [
            { node_id: 'source-a', connection_id: secondId, status: 'connected', check: null },
            { node_id: 'source-b', connection_id: secondId, status: 'connected', check: null },
          ],
        }),
      )
    render(tree())

    await waitFor(() =>
      expect(screen.getByLabelText('Validation status')).toHaveTextContent('blocked'),
    )
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(selections()['source-a']).toBe(firstId)
  })

  it('adds no connection check to an App without requirements and preserves its existing access gate', async () => {
    const { requests } = installBackend()
    const noConnections: ReadyEntry = {
      ...entry({
        requires_end_user_connections: false,
        connection_requirements: [],
        connection_revision: null,
      }),
      status: 'ready',
      account: 'anonymous',
      canRun: true,
    }
    const view = render(tree({ entry: noConnections }))

    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
    expect(requests).toEqual([])
    view.rerender(tree({ entry: { status: 'unavailable', canRun: false, showSignIn: false } }))
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(requests).toEqual([])
  })
})
