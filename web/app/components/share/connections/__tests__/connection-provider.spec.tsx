import type {
  ConnectionConfigurationResponse,
  EndUserConnectionListResponse,
  EndUserConnectionPreflightPayload,
  EndUserConnectionPreflightResponse,
  EndUserConnectionResponse,
  WebAppConnectionRequirement,
} from '@dify/contracts/api/web/types.gen'
import type { WebAppEntryState } from '../../webapp-entry'
import type { WebAppAddress } from '@/service/webapp-address'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { captureAppAccessScope } from '@/features/app-access-error/state'
import {
  expireWebAppAccountSession,
  setWebAppAccessToken,
  setWebAppPassport,
} from '@/service/webapp-auth'
import { WebAppEntryContext } from '../../webapp-entry'
import { WebAppConnectionsProvider } from '../connection-provider'
import RequiredServices from '../required-services'
import { useWebAppConnections } from '../use-connections'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/service/refresh-token', () => ({ refreshAccessTokenOrReLogin: vi.fn() }))

type ReadyEntry = Extract<WebAppEntryState, { parameters: unknown }>

const address = { kind: 'default', code: 'shared-app' } as const
const firstId = '11111111-1111-4111-8111-111111111111'
const secondId = '22222222-2222-4222-8222-222222222222'
const conversationId = '33333333-3333-4333-8333-333333333333'
const connectionRevision = '44444444-4444-4444-8444-444444444444'
const provider = 'langgenius/github/github'
const requirements: WebAppConnectionRequirement[] = [
  {
    node_id: 'source-a',
    icon: '/provider-icon.svg',
    icon_dark: null,
    plugin_unique_identifier: 'langgenius/github:1.0.0@digest',
    node_ids: ['source-a', 'reuse-a'],
    title: 'Find repositories',
    purpose: 'Read repositories for the research brief.',
    provider,
    allowed_credential_types: ['oauth2', 'api-key'],
    provider_label: 'GitHub',
  },
  {
    node_id: 'source-b',
    icon: '/provider-icon.svg',
    icon_dark: null,
    plugin_unique_identifier: 'langgenius/github:1.0.0@digest',
    node_ids: ['source-b'],
    title: 'Read README',
    purpose: 'Read documentation for the answer.',
    provider,
    allowed_credential_types: ['oauth2'],
    provider_label: 'GitHub',
  },
]

function connection(overrides: Partial<EndUserConnectionResponse> = {}): EndUserConnectionResponse {
  return {
    id: firstId,
    name: 'Personal GitHub',
    provider,
    credential_type: 'oauth2',
    credential_status: 'connected',
    account_label: 'personal@example.com',
    expires_at: null,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    last_active_at: 1_700_000_000,
    ...overrides,
  }
}

const personal = connection()
const work = connection({ id: secondId, name: 'Work GitHub', account_label: 'work@example.com' })

function entry(overrides: Partial<ReadyEntry> = {}): ReadyEntry {
  return {
    status: 'connections-pending',
    account: 'authenticated',
    parameters: {
      account_login_enabled: true,
      account_login_url: 'https://account.example/signin',
      allow_anonymous_end_user_auth: false,
      connection_revision: connectionRevision,
      requires_end_user_connections: true,
      connection_requirements: requirements,
    },
    canRun: false,
    showSignIn: false,
    ...overrides,
  }
}

function page(
  data: EndUserConnectionResponse[],
  nextCursor: string | null = null,
): EndUserConnectionListResponse {
  return { data, has_more: nextCursor !== null, next_cursor: nextCursor }
}

async function replyToPreflight(request: Request) {
  const payload = (await request.json()) as EndUserConnectionPreflightPayload
  const connections = Object.entries(payload.connections).map(([node_id, connection_id]) => ({
    node_id,
    connection_id,
    status: connection_id ? ('connected' as const) : ('disconnected' as const),
    check: null,
  }))
  return Response.json({
    connection_revision: payload.connection_revision,
    connections,
    ready: connections.every((connection) => connection.status === 'connected'),
  } satisfies EndUserConnectionPreflightResponse)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const onConnect = vi.fn()

function Consumer() {
  const state = useWebAppConnections()
  return (
    <>
      <textarea aria-label="Draft message" />
      <output aria-label="Run configuration">{JSON.stringify(state.runConfiguration)}</output>
      <output aria-label="Connection status">{state.status}</output>
      <output aria-label="Selected connections">{JSON.stringify(state.selections)}</output>
      <output aria-label="Authorization sources">{JSON.stringify(state.sourceNodeByNodeId)}</output>
      <output aria-label="More connections">{String(state.hasMoreConnections)}</output>
      <output aria-label="Loading more connections">
        {String(state.isFetchingMoreConnections)}
      </output>
      <output aria-label="Connection error">{state.error?.message ?? ''}</output>
      <button type="button" onClick={state.loadMoreConnections}>
        Load more connections
      </button>
      <button type="button" onClick={state.retry}>
        Retry connections
      </button>
      <button type="button" onClick={() => state.onConnectionChange('reuse-a', firstId)}>
        Choose personal through reused node
      </button>
      <button type="button" onClick={() => state.onConnectionChange('reuse-a', null)}>
        Clear reused node connection
      </button>
      <button
        type="button"
        onClick={() => {
          void state.onConnect('source-a', 'api-key', {
            name: 'New API Key',
            credentials: { api_key: 'sk-test' },
          })
        }}
      >
        Create API Key
      </button>
      <RequiredServices
        services={state.services}
        onConnect={onConnect}
        onConnectionChange={state.onConnectionChange}
      />
    </>
  )
}

function selections() {
  return JSON.parse(screen.getByLabelText('Selected connections').textContent || '{}') as Record<
    string,
    string | null
  >
}

function selectedAccount(description: string) {
  return screen.getByRole('button', { name: 'GitHub', description: new RegExp(description) })
}

type Scope = {
  address: WebAppAddress
  conversationId?: string
  selectionSession?: number
  entry: ReadyEntry
}

describe('WebAppConnectionsProvider', () => {
  let queryClient: QueryClient

  const tree = (scope: Scope) => (
    <QueryClientProvider client={queryClient}>
      <WebAppEntryContext value={scope.entry}>
        <WebAppConnectionsProvider
          address={scope.address}
          conversationId={scope.conversationId}
          selectionSession={scope.selectionSession}
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
    window.history.replaceState({}, '', '/chat/shared-app')
    setWebAppAccessToken('account-a', 'end_user')
    setWebAppPassport(address, 'app-passport')
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  afterEach(() => {
    queryClient.clear()
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    captureAppAccessScope()
  })

  it('preserves the draft message when the first response assigns a real conversation ID', async () => {
    const user = userEvent.setup()
    const requests: Request[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      requests.push(request.clone())
      if (new URL(request.url).pathname.endsWith('/connections/preflight'))
        return replyToPreflight(request)
      return Response.json(
        request.url.includes('/configuration')
          ? { connections: { 'source-a': personal, 'source-b': work } }
          : page([personal, work]),
      )
    })
    const view = render(tree({ address, entry: entry() }))
    await waitFor(() =>
      expect(screen.getByLabelText('Run configuration')).toHaveTextContent(firstId),
    )
    await user.type(screen.getByRole('textbox', { name: 'Draft message' }), 'My next question')

    view.rerender(tree({ address, conversationId, entry: entry() }))

    expect(screen.getByRole('textbox', { name: 'Draft message' })).toHaveValue('My next question')
    await waitFor(() =>
      expect(screen.getByLabelText('Run configuration')).toHaveTextContent(conversationId),
    )
    const configuration = requests.filter((request) => request.url.includes('/configuration'))
    expect(configuration).toHaveLength(2)
    expect(new URL(configuration[1]!.url).searchParams.get('conversation_id')).toBe(conversationId)
    const checks = requests.filter((request) => request.url.endsWith('/connections/preflight'))
    expect(await checks.at(-1)!.clone().json()).toMatchObject({ conversation_id: conversationId })
  })

  it('reloads app defaults and rechecks them for each new blank conversation session without remounting content', async () => {
    const user = userEvent.setup()
    const configurationRequests: Request[] = []
    const checks: EndUserConnectionPreflightPayload[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (request.url.endsWith('/connections/preflight')) {
        checks.push((await request.clone().json()) as EndUserConnectionPreflightPayload)
        return replyToPreflight(request)
      }
      if (request.url.includes('/configuration')) {
        configurationRequests.push(request)
        return Response.json({ connections: { 'source-a': personal, 'source-b': work } })
      }
      return Response.json(page([personal, work]))
    })
    const view = render(tree({ address, selectionSession: 0, entry: entry() }))
    await waitFor(() =>
      expect(screen.getByLabelText('Run configuration')).toHaveTextContent(firstId),
    )
    await user.type(screen.getByRole('textbox', { name: 'Draft message' }), 'Mounted content')

    view.rerender(tree({ address, selectionSession: 1, entry: entry() }))

    await waitFor(() => expect(checks).toHaveLength(2))
    expect(configurationRequests).toHaveLength(2)
    expect(screen.getByRole('textbox', { name: 'Draft message' })).toHaveValue('Mounted content')
    await waitFor(() =>
      expect(screen.getByLabelText('Run configuration')).toHaveTextContent(firstId),
    )
    await user.click(selectedAccount('Read repositories for the research brief.'))
    await user.click(await screen.findByRole('button', { name: 'work@example.com' }))
    await waitFor(() => expect(checks).toHaveLength(3))
    expect(selections()['source-a']).toBe(secondId)

    view.rerender(tree({ address, selectionSession: 2, entry: entry() }))

    await waitFor(() =>
      expect(screen.getByLabelText('Run configuration')).toHaveTextContent(firstId),
    )
    expect(configurationRequests).toHaveLength(3)
    expect(checks).toHaveLength(4)
    expect(checks.at(-1)).toEqual({
      connection_revision: connectionRevision,
      connections: { 'source-a': firstId, 'source-b': secondId },
    })
    expect(configurationRequests.every((request) => new URL(request.url).search === '')).toBe(true)
    expect(screen.getByRole('textbox', { name: 'Draft message' })).toHaveValue('Mounted content')
  })

  it('does not apply a delayed connection creation after leaving and reopening the same conversation', async () => {
    const user = userEvent.setup()
    const created = deferred<Response>()
    let createStarted = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname.endsWith('/connections/preflight'))
        return replyToPreflight(request)
      if (request.method === 'POST') {
        createStarted = true
        return created.promise
      }
      return Response.json(
        request.url.includes('/configuration')
          ? { connections: { 'source-a': personal, 'source-b': work } }
          : page([personal, work]),
      )
    })
    const originalScope = { address, conversationId, entry: entry() }
    const view = render(tree(originalScope))
    await waitFor(() =>
      expect(screen.getByLabelText('Connection status')).toHaveTextContent('ready'),
    )
    await user.click(screen.getByRole('button', { name: 'Create API Key' }))
    await waitFor(() => expect(createStarted).toBe(true))

    view.rerender(tree({ ...originalScope, conversationId: secondId }))
    await waitFor(() =>
      expect(screen.getByLabelText('Connection status')).toHaveTextContent('ready'),
    )
    view.rerender(tree(originalScope))
    await waitFor(() =>
      expect(screen.getByLabelText('Connection status')).toHaveTextContent('ready'),
    )
    await act(async () => {
      created.resolve(
        Response.json(
          connection({ id: '77777777-7777-4777-8777-777777777777', credential_type: 'api-key' }),
        ),
      )
    })

    await waitFor(() =>
      expect(screen.getByLabelText('Run configuration')).toHaveTextContent(conversationId),
    )
    expect(selections()).toEqual({ 'source-a': firstId, 'source-b': secondId })
  })

  it('loads both resources in parallel and keeps a saved selection visible before its list page arrives', async () => {
    const user = userEvent.setup()
    const initialPage = deferred<Response>()
    const configuration = deferred<Response>()
    const requests: Request[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname.endsWith('/connections/preflight'))
        return replyToPreflight(request)
      requests.push(request)
      const url = new URL(request.url)
      if (url.pathname.endsWith('/connections/configuration')) return configuration.promise
      if (url.searchParams.has('cursor')) {
        return Promise.resolve(
          Response.json(page([connection({ ...work, account_label: 'updated-work@example.com' })])),
        )
      }
      return initialPage.promise
    })

    render(tree({ address, conversationId, entry: entry() }))

    await waitFor(() => expect(requests).toHaveLength(2))
    expect(screen.getByLabelText('Connection status')).toHaveTextContent('loading')
    const listUrl = new URL(
      requests.find((item) => new URL(item.url).pathname.endsWith('/connections'))!.url,
    )
    expect(Object.fromEntries(listUrl.searchParams)).toEqual({ limit: '100' })
    const configurationUrl = new URL(
      requests.find((item) => item.url.includes('/configuration'))!.url,
    )
    expect(configurationUrl.searchParams.get('conversation_id')).toBe(conversationId)

    await act(async () => {
      initialPage.resolve(Response.json(page([personal], firstId)))
      configuration.resolve(
        Response.json({ connections: { 'source-a': work, 'source-b': personal } }),
      )
    })

    await waitFor(() =>
      expect(screen.getByLabelText('Connection status')).toHaveTextContent('ready'),
    )
    expect(selectedAccount('Read repositories for the research brief.')).toHaveTextContent(
      'work@example.com',
    )
    expect(selectedAccount('Read documentation for the answer.')).toHaveTextContent(
      'personal@example.com',
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByLabelText('More connections')).toHaveTextContent('true')

    await user.click(screen.getByRole('button', { name: 'Load more connections' }))

    await waitFor(() =>
      expect(selectedAccount('Read repositories for the research brief.')).toHaveTextContent(
        'updated-work@example.com',
      ),
    )
    expect(screen.getByLabelText('More connections')).toHaveTextContent('false')
    const lastRequest = new URL(requests.at(-1)!.url)
    expect(lastRequest.searchParams.get('cursor')).toBe(firstId)
    expect(lastRequest.searchParams.get('limit')).toBe('100')
    expect(selections()).toEqual({ 'source-a': secondId, 'source-b': firstId })
  })

  it('keeps independent sources separate and routes a reused node change to its authorization source', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname.endsWith('/connections/preflight'))
        return replyToPreflight(request)
      return Response.json(
        request.url.includes('/configuration')
          ? { connections: { 'source-a': personal, 'source-b': work } }
          : page([personal, work]),
      )
    })
    render(tree({ address, entry: entry() }))
    await waitFor(() =>
      expect(screen.getByLabelText('Connection status')).toHaveTextContent('ready'),
    )

    expect(selections()).toEqual({ 'source-a': firstId, 'source-b': secondId })
    expect(JSON.parse(screen.getByLabelText('Authorization sources').textContent || '{}')).toEqual({
      'source-a': 'source-a',
      'reuse-a': 'source-a',
      'source-b': 'source-b',
    })
    await user.click(selectedAccount('Read repositories for the research brief.'))
    await user.click(await screen.findByRole('button', { name: 'work@example.com' }))
    expect(selections()).toEqual({ 'source-a': secondId, 'source-b': secondId })

    await user.click(screen.getByRole('button', { name: 'Choose personal through reused node' }))
    expect(selections()).toEqual({ 'source-a': firstId, 'source-b': secondId })
    await user.click(screen.getByRole('button', { name: 'Clear reused node connection' }))
    expect(selections()).toEqual({ 'source-a': null, 'source-b': secondId })
    expect(selectedAccount('Read repositories for the research brief.')).toHaveTextContent(
      'share.connections.setup.selectConnection',
    )
    expect(selectedAccount('Read documentation for the answer.')).toHaveTextContent(
      'work@example.com',
    )
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('leaves missing and inaccessible saved selections unselected even when a connection is available', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname.endsWith('/connections/preflight'))
        return replyToPreflight(request)
      return Response.json(
        request.url.includes('/configuration')
          ? { connections: { 'source-a': null } }
          : page([personal]),
      )
    })
    render(tree({ address, entry: entry() }))

    await waitFor(() =>
      expect(screen.getByLabelText('Connection status')).toHaveTextContent('ready'),
    )
    expect(selections()).toEqual({ 'source-a': null, 'source-b': null })
    expect(selectedAccount('Read repositories for the research brief.')).toHaveTextContent(
      'share.connections.setup.selectConnection',
    )
    expect(selectedAccount('Read documentation for the answer.')).toHaveTextContent(
      'share.connections.setup.selectConnection',
    )
  })

  it('allows anonymous connections only when the App entry enables them', async () => {
    expireWebAppAccountSession()
    setWebAppPassport(address, 'anonymous-passport')
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname.endsWith('/connections/preflight'))
        return replyToPreflight(request)
      return Response.json(request.url.includes('/configuration') ? { connections: {} } : page([]))
    })
    const anonymous = entry({ account: 'anonymous' })
    anonymous.parameters = { ...anonymous.parameters, allow_anonymous_end_user_auth: true }
    render(tree({ address, entry: anonymous }))

    await waitFor(() =>
      expect(screen.getByLabelText('Connection status')).toHaveTextContent('ready'),
    )
    expect(
      fetch.mock.calls.filter(([input, init]) => new Request(input, init).method === 'GET'),
    ).toHaveLength(2)
    expect(selections()).toEqual({ 'source-a': null, 'source-b': null })
  })

  it.each(['sign-in-required', 'no-requirements', 'environment'] as const)(
    'does not read personal connection APIs for %s entry',
    async (scenario) => {
      const fetch = vi.spyOn(globalThis, 'fetch')
      const currentEntry = entry(scenario === 'sign-in-required' ? { account: 'anonymous' } : {})
      let currentAddress: WebAppAddress = address
      if (scenario === 'no-requirements') {
        currentEntry.parameters = {
          ...currentEntry.parameters,
          connection_requirements: [],
          requires_end_user_connections: false,
        }
      }
      if (scenario === 'environment') {
        currentAddress = { kind: 'environment', code: address.code }
        window.history.replaceState({}, '', '/environment/chat/shared-app')
      }
      render(tree({ address: currentAddress, entry: currentEntry }))

      await waitFor(() =>
        expect(screen.getByLabelText('Connection status')).toHaveTextContent(
          scenario === 'sign-in-required' ? 'sign-in-required' : 'inactive',
        ),
      )
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('preserves loaded choices after a failed next page and retries that page explicitly', async () => {
    const user = userEvent.setup()
    let nextPageAttempts = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname.endsWith('/connections/preflight'))
        return replyToPreflight(request)
      const url = new URL(request.url)
      if (url.pathname.endsWith('/configuration'))
        return Response.json({ connections: { 'source-a': work } })
      if (!url.searchParams.has('cursor')) return Response.json(page([personal], firstId))
      nextPageAttempts++
      if (nextPageAttempts === 1) {
        return Response.json(
          {
            code: 'connection_page_unavailable',
            message: 'Connection page unavailable',
            status: 503,
          },
          { status: 503 },
        )
      }
      return Response.json(page([work]))
    })
    render(tree({ address, entry: entry() }))
    await waitFor(() =>
      expect(screen.getByLabelText('Connection status')).toHaveTextContent('ready'),
    )

    await user.click(screen.getByRole('button', { name: 'Load more connections' }))

    await waitFor(() => expect(screen.getByLabelText('Connection error')).not.toBeEmptyDOMElement())
    expect(selectedAccount('Read repositories for the research brief.')).toHaveTextContent(
      'work@example.com',
    )
    expect(selections()['source-a']).toBe(secondId)
    expect(screen.getByLabelText('More connections')).toHaveTextContent('true')
    expect(nextPageAttempts).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Retry connections' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Connection status')).toHaveTextContent('ready'),
    )
    expect(nextPageAttempts).toBe(2)
    expect(screen.getByLabelText('Connection error')).toBeEmptyDOMElement()
    expect(screen.getByLabelText('More connections')).toHaveTextContent('false')
    expect(selections()['source-a']).toBe(secondId)
  })

  it('reports a missing pagination cursor without treating a saved selection as deleted or looping requests', async () => {
    const user = userEvent.setup()
    let listAttempts = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      if (new URL(request.url).pathname.endsWith('/connections/preflight'))
        return replyToPreflight(request)
      if (request.url.includes('/configuration'))
        return Response.json({ connections: { 'source-a': work } })
      listAttempts++
      return Response.json(
        listAttempts === 1
          ? { data: [personal], has_more: true, next_cursor: null }
          : page([personal, work]),
      )
    })
    render(tree({ address, entry: entry() }))

    await waitFor(() =>
      expect(screen.getByLabelText('Connection status')).toHaveTextContent('error'),
    )
    expect(screen.getByLabelText('Connection error')).not.toBeEmptyDOMElement()
    await waitFor(() =>
      expect(selectedAccount('Read repositories for the research brief.')).toHaveTextContent(
        'work@example.com',
      ),
    )
    expect(selections()['source-a']).toBe(secondId)
    expect(listAttempts).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Load more connections' }))
    expect(listAttempts).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Retry connections' }))

    await waitFor(() =>
      expect(screen.getByLabelText('Connection status')).toHaveTextContent('ready'),
    )
    expect(listAttempts).toBe(2)
    expect(selections()['source-a']).toBe(secondId)
  })

  it.each(['conversation', 'App', 'account', 'revision'] as const)(
    'resets local choices after changing %s and ignores the previous scope response',
    async (changedScope) => {
      const user = userEvent.setup()
      const previousConfiguration = deferred<Response>()
      let phase: 'initial' | 'previous-refetch' | 'next' = 'initial'
      let pendingPreviousRequest = false
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const request = new Request(input, init)
        if (new URL(request.url).pathname.endsWith('/connections/preflight'))
          return replyToPreflight(request)
        if (!request.url.includes('/configuration')) return Response.json(page([personal, work]))
        if (phase === 'previous-refetch') {
          pendingPreviousRequest = true
          return previousConfiguration.promise
        }
        return Response.json({ connections: { 'source-a': personal, 'source-b': work } })
      })
      const originalScope: Scope = { address, conversationId, entry: entry() }
      const { rerender } = render(tree(originalScope))
      await waitFor(() =>
        expect(screen.getByLabelText('Connection status')).toHaveTextContent('ready'),
      )
      await user.click(selectedAccount('Read repositories for the research brief.'))
      await user.click(await screen.findByRole('button', { name: 'work@example.com' }))
      expect(selections()['source-a']).toBe(secondId)

      phase = 'previous-refetch'
      await user.click(screen.getByRole('button', { name: 'Retry connections' }))
      await waitFor(() => expect(pendingPreviousRequest).toBe(true))
      phase = 'next'
      const nextScope: Scope = { ...originalScope, entry: entry() }
      if (changedScope === 'conversation') {
        nextScope.conversationId = '55555555-5555-4555-8555-555555555555'
      } else if (changedScope === 'App') {
        nextScope.address = { kind: 'default', code: 'another-app' }
        window.history.replaceState({}, '', '/chat/another-app')
        setWebAppPassport(nextScope.address, 'another-passport')
      } else if (changedScope === 'account') {
        act(() => {
          setWebAppAccessToken('account-b', 'end_user')
          setWebAppPassport(address, 'account-b-passport')
        })
      } else {
        nextScope.entry.parameters = {
          ...nextScope.entry.parameters,
          connection_revision: '66666666-6666-4666-8666-666666666666',
        }
      }
      rerender(tree(nextScope))

      await waitFor(() =>
        expect(screen.getByLabelText('Connection status')).toHaveTextContent('ready'),
      )
      expect(selections()).toEqual({ 'source-a': firstId, 'source-b': secondId })
      await act(async () => {
        previousConfiguration.resolve(
          Response.json({
            connections: { 'source-a': work },
          } satisfies ConnectionConfigurationResponse),
        )
      })
      expect(selections()).toEqual({ 'source-a': firstId, 'source-b': secondId })
      expect(selectedAccount('Read repositories for the research brief.')).toHaveTextContent(
        'personal@example.com',
      )
    },
  )
})
