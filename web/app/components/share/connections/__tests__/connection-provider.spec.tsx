import type {
  ConnectionConfigurationResponse,
  EndUserConnectionListResponse,
  EndUserConnectionResponse,
  WebAppConnectionRequirement,
} from '@dify/contracts/api/web/types.gen'
import type { WebAppEntryState } from '../../webapp-entry'
import type { WebAppAddress } from '@/service/webapp-address'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
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

function selectedAccount(serviceName: string) {
  const row = screen.getByRole('listitem', { name: serviceName })
  return within(row).getByRole('button', { name: serviceName })
}

type Scope = {
  address: WebAppAddress
  conversationId?: string
  entry: ReadyEntry
}

describe('WebAppConnectionsProvider', () => {
  let queryClient: QueryClient

  const tree = (scope: Scope) => (
    <QueryClientProvider client={queryClient}>
      <WebAppEntryContext value={scope.entry}>
        <WebAppConnectionsProvider address={scope.address} conversationId={scope.conversationId}>
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

  it('loads both resources in parallel and keeps a saved selection visible before its list page arrives', async () => {
    const user = userEvent.setup()
    const initialPage = deferred<Response>()
    const configuration = deferred<Response>()
    const requests: Request[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const request = new Request(input, init)
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
    expect(selectedAccount('Find repositories')).toHaveTextContent('work@example.com')
    expect(selectedAccount('Read README')).toHaveTextContent('personal@example.com')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByLabelText('More connections')).toHaveTextContent('true')

    await user.click(screen.getByRole('button', { name: 'Load more connections' }))

    await waitFor(() =>
      expect(selectedAccount('Find repositories')).toHaveTextContent('updated-work@example.com'),
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
    await user.click(selectedAccount('Find repositories'))
    await user.click(await screen.findByRole('button', { name: 'work@example.com' }))
    expect(selections()).toEqual({ 'source-a': secondId, 'source-b': secondId })

    await user.click(screen.getByRole('button', { name: 'Choose personal through reused node' }))
    expect(selections()).toEqual({ 'source-a': firstId, 'source-b': secondId })
    await user.click(screen.getByRole('button', { name: 'Clear reused node connection' }))
    expect(selections()).toEqual({ 'source-a': null, 'source-b': secondId })
    expect(selectedAccount('Find repositories')).toHaveTextContent(
      'share.connections.setup.selectConnection',
    )
    expect(selectedAccount('Read README')).toHaveTextContent('work@example.com')
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('leaves missing and inaccessible saved selections unselected even when a connection is available', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
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
    expect(selectedAccount('Find repositories')).toHaveTextContent(
      'share.connections.setup.selectConnection',
    )
    expect(selectedAccount('Read README')).toHaveTextContent(
      'share.connections.setup.selectConnection',
    )
  })

  it('allows anonymous connections only when the App entry enables them', async () => {
    expireWebAppAccountSession()
    setWebAppPassport(address, 'anonymous-passport')
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      return Response.json(request.url.includes('/configuration') ? { connections: {} } : page([]))
    })
    const anonymous = entry({ account: 'anonymous' })
    anonymous.parameters = { ...anonymous.parameters, allow_anonymous_end_user_auth: true }
    render(tree({ address, entry: anonymous }))

    await waitFor(() =>
      expect(screen.getByLabelText('Connection status')).toHaveTextContent('ready'),
    )
    expect(fetch).toHaveBeenCalledTimes(2)
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
    expect(selectedAccount('Find repositories')).toHaveTextContent('work@example.com')
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
      expect(selectedAccount('Find repositories')).toHaveTextContent('work@example.com'),
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
      await user.click(selectedAccount('Find repositories'))
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
      expect(selectedAccount('Find repositories')).toHaveTextContent('personal@example.com')
    },
  )
})
