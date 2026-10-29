import type {
  ConnectionConfigurationPayload,
  ConnectionConfigurationResponse,
  EndUserConnectionListResponse,
  EndUserConnectionPreflightPayload,
  EndUserConnectionPreflightResponse,
  EndUserConnectionResponse,
  WebAppConnectionRequirement,
  WebAppParametersResponse,
} from '@dify/contracts/api/web/types.gen'
import type { WebAppEntryState } from '../../webapp-entry'
import type { WebAppAddress } from '@/service/webapp-address'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { captureAppAccessScope } from '@/features/app-access-error/state'
import { useGetWebAppParams } from '@/service/use-share'
import { setWebAppAccessToken, setWebAppPassport } from '@/service/webapp-auth'
import { WebAppEntryContext } from '../../webapp-entry'
import { WebAppConnectionsProvider } from '../connection-provider'
import { useWebAppConnections } from '../use-connections'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/service/refresh-token', () => ({ refreshAccessTokenOrReLogin: vi.fn() }))

type ReadyEntry = Extract<WebAppEntryState, { parameters: unknown }>

const address = { kind: 'default', code: 'research-app' } as const
const provider = 'langgenius/github/github'
const existingId = '11111111-1111-4111-8111-111111111111'
const backupId = '22222222-2222-4222-8222-222222222222'
const createdId = '33333333-3333-4333-8333-333333333333'
const conversationId = '44444444-4444-4444-8444-444444444444'
const connectionRevision = '55555555-5555-4555-8555-555555555555'
const providerRevision = '77777777-7777-4777-8777-777777777777'
const nextConnectionRevision = '66666666-6666-4666-8666-666666666666'
const draft = { name: 'New research key', credentials: { api_key: 'a-valid-provider-secret' } }
const replacement = {
  name: 'Updated research key',
  credentials: { api_key: 'replacement-secret' },
}
const requirements: WebAppConnectionRequirement[] = [
  {
    node_id: 'source-a',
    icon: '/provider-icon.svg',
    icon_dark: null,
    plugin_unique_identifier: 'langgenius/github:1.0.0@digest',
    node_ids: ['source-a', 'reuse-a'],
    title: 'Research repositories',
    purpose: 'Read repository documentation.',
    provider,
    allowed_credential_types: ['api-key'],
    provider_label: 'GitHub',
  },
  {
    node_id: 'source-b',
    icon: '/provider-icon.svg',
    icon_dark: null,
    plugin_unique_identifier: 'langgenius/github:1.0.0@digest',
    node_ids: ['source-b'],
    title: 'Read README',
    purpose: 'Read the project README.',
    provider,
    allowed_credential_types: ['api-key'],
    provider_label: 'GitHub',
  },
]

function connection(overrides: Partial<EndUserConnectionResponse> = {}): EndUserConnectionResponse {
  return {
    id: existingId,
    provider,
    name: 'Existing research key',
    credential_type: 'api-key',
    credential_status: 'connected',
    account_label: null,
    expires_at: null,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    last_active_at: 1_700_000_000,
    ...overrides,
  }
}

const existing = connection()
const backup = connection({ id: backupId, name: 'Backup key' })
const created = connection({
  id: createdId,
  name: draft.name,
  created_at: 1_700_000_100,
  updated_at: 1_700_000_100,
})

function entry(): ReadyEntry {
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
  }
}

function parameters(currentConnectionRevision: string): WebAppParametersResponse {
  return {
    ...entry().parameters,
    connection_revision: currentConnectionRevision,
    annotation_reply: {},
    file_upload: {},
    more_like_this: {},
    retriever_resource: {},
    sensitive_word_avoidance: {},
    speech_to_text: {},
    suggested_questions: [],
    suggested_questions_after_answer: {},
    system_parameters: {
      audio_file_size_limit: 50,
      file_size_limit: 15,
      image_file_size_limit: 10,
      video_file_size_limit: 100,
      workflow_file_upload_limit: 10,
    },
    text_to_speech: {},
    user_input_form: [],
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

type Backend = {
  records: EndUserConnectionResponse[]
  configuration: ConnectionConfigurationResponse
  connectionRevision: string
  list?: (request: Request) => EndUserConnectionListResponse
  saveSelection?: (request: Request) => Response | Promise<Response>
  write: (request: Request) => Response | Promise<Response>
}

function installBackend(overrides: Partial<Backend> = {}) {
  const backend: Backend = {
    records: [existing, backup],
    configuration: {
      reauthorization_required: false,
      connections: { 'source-a': existing, 'source-b': existing },
    },
    connectionRevision,
    write: () => {
      throw new Error('Unexpected connection write.')
    },
    ...overrides,
  }
  const requests: Request[] = []
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname.endsWith('/connections/preflight')) {
      const payload = (await request.json()) as EndUserConnectionPreflightPayload
      const connections = Object.entries(payload.connections).map(([node_id, connection_id]) => ({
        node_id,
        connection_id,
        status: connection_id
          ? (backend.records.find((connection) => connection.id === connection_id)
              ?.credential_status ?? 'disconnected')
          : ('disconnected' as const),
        check: null,
      }))
      return Response.json({
        connection_revision: payload.connection_revision,
        connections,
        ready: connections.every((connection) => connection.status === 'connected'),
      } satisfies EndUserConnectionPreflightResponse)
    }
    // These assertions record connection management requests; Preflight has its own suite.
    requests.push(request)
    if (request.method === 'PUT' && url.pathname.endsWith('/connections/configuration')) {
      if (backend.saveSelection) return backend.saveSelection(request)
      const payload = (await request.clone().json()) as ConnectionConfigurationPayload
      backend.configuration = {
        reauthorization_required: false,
        connections: Object.fromEntries(
          Object.entries(payload.connections).map(([nodeId, id]) => [
            nodeId,
            backend.records.find((item) => item.id === id) ?? null,
          ]),
        ),
      }
      return Response.json(backend.configuration)
    }
    if (request.method !== 'GET') return backend.write(request)
    if (url.pathname.endsWith('/parameters'))
      return Response.json(parameters(backend.connectionRevision))
    if (url.pathname.endsWith('/connections/configuration'))
      return Response.json(backend.configuration)
    if (url.pathname.endsWith('/connections'))
      return Response.json(backend.list?.(request) ?? page(backend.records))
    if (url.pathname.endsWith('/revision'))
      return Response.json({ connection_revision: providerRevision })
    const id = url.pathname.split('/').at(-1)
    const record = backend.records.find((item) => item.id === id)
    if (record) return Response.json(record)
    return Response.json(
      { code: 'connection_not_found', status: 404, message: 'Connection not found.' },
      { status: 404 },
    )
  })
  return { backend, requests, fetch }
}

function Consumer() {
  const state = useWebAppConnections()
  const [result, setResult] = useState('')
  const perform = async (operation: () => void | Promise<void>) => {
    setResult('pending')
    try {
      await operation()
      setResult('saved')
    } catch {
      setResult('failed')
    }
  }
  return (
    <>
      <output aria-label="Connection status">{state.status}</output>
      <output aria-label="Selected connections">{JSON.stringify(state.selections)}</output>
      <output aria-label="Available connections">
        {JSON.stringify(state.services.flatMap((service) => service.availableConnections))}
      </output>
      <output aria-label="Can run">{String(state.canRun)}</output>
      <output aria-label="Mutation pending">{String(state.isMutating)}</output>
      <output aria-label="Action result">{result}</output>
      <button
        type="button"
        onClick={() => void perform(() => state.onConnect('reuse-a', 'api-key', draft))}
      >
        Add connection
      </button>
      <button
        type="button"
        onClick={() => void perform(() => state.onReplace('source-a', existingId, replacement))}
      >
        Replace connection
      </button>
      <button
        type="button"
        onClick={() => void perform(() => state.onRemove('source-a', existingId))}
      >
        Remove connection
      </button>
      <button type="button" onClick={() => void perform(() => state.onConnect('reuse-a', 'oauth'))}>
        Connect OAuth
      </button>
      <button
        type="button"
        onClick={() => void perform(() => state.onReconnect('source-a', existingId))}
      >
        Reconnect OAuth
      </button>
      <button type="button" onClick={() => state.onConnectionChange('reuse-a', createdId)}>
        Choose created connection
      </button>
      <button type="button" onClick={() => state.onConnectionChange('reuse-a', null)}>
        Clear source connection
      </button>
      <button type="button" onClick={state.retry}>
        Reload connections
      </button>
      <button type="button" onClick={() => state.onConnectionChange('reuse-a', backupId)}>
        Choose backup connection
      </button>
    </>
  )
}

function ParameterProbe({ currentAddress }: { currentAddress: WebAppAddress }) {
  const { data } = useGetWebAppParams(currentAddress)
  return <output aria-label="Connection revision">{data?.connection_revision ?? ''}</output>
}

function selections() {
  return JSON.parse(screen.getByLabelText('Selected connections').textContent || '{}') as Record<
    string,
    string | null
  >
}

function available() {
  return JSON.parse(screen.getByLabelText('Available connections').textContent || '[]') as {
    id: string
    name: string
    status: string
  }[]
}

type Scope = {
  address: WebAppAddress
  conversationId?: string
  selectionSession?: number
  probeParameters?: boolean
  entry?: ReadyEntry
}

describe('Webapp connection actions', () => {
  let queryClient: QueryClient
  const tree = (scope: Scope = { address, conversationId }) => (
    <QueryClientProvider client={queryClient}>
      <WebAppEntryContext value={scope.entry ?? entry()}>
        {scope.probeParameters && <ParameterProbe currentAddress={scope.address} />}
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
  const ready = () =>
    waitFor(() => expect(screen.getByLabelText('Connection status')).toHaveTextContent('ready'))

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    captureAppAccessScope()
    window.history.replaceState({}, '', '/chat/research-app')
    setWebAppAccessToken('account-a', 'end_user')
    setWebAppPassport(address, 'research-passport')
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
  })

  afterEach(() => {
    queryClient.clear()
    vi.restoreAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
    captureAppAccessScope()
  })

  it('creates an API key for the authorization source and selects the response ID rather than a list position', async () => {
    const user = userEvent.setup()
    const { backend, requests } = installBackend()
    let submitted: unknown
    backend.write = async (request) => {
      submitted = await request.json()
      backend.records = [backup, created, existing]
      return Response.json(created, { status: 201 })
    }
    render(tree())
    await ready()

    await user.click(screen.getByRole('button', { name: 'Add connection' }))

    await waitFor(() => expect(screen.getByLabelText('Action result')).toHaveTextContent('saved'))
    expect(submitted).toEqual({
      ...draft,
      connection_revision: connectionRevision,
      node_id: 'source-a',
    })
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1)
    expect(
      await requests
        .find((item) => item.method === 'PUT')!
        .clone()
        .json(),
    ).toEqual({
      connection_revision: connectionRevision,
      conversation_id: conversationId,
      connections: { 'source-a': createdId, 'source-b': existingId },
    })
    expect(selections()).toEqual({ 'source-a': createdId, 'source-b': existingId })
    expect(available()).toContainEqual(expect.objectContaining({ id: createdId, name: draft.name }))
  })

  it('persists a manual choice with all independent sources and the active conversation before enabling runs', async () => {
    const user = userEvent.setup()
    const pending = deferred<Response>()
    const { requests } = installBackend({ saveSelection: () => pending.promise })
    render(tree())
    await ready()
    await waitFor(() => expect(screen.getByLabelText('Can run')).toHaveTextContent('true'))

    await user.click(screen.getByRole('button', { name: 'Choose backup connection' }))
    await waitFor(() => expect(requests.filter((item) => item.method === 'PUT')).toHaveLength(1))
    expect(
      await requests
        .find((item) => item.method === 'PUT')!
        .clone()
        .json(),
    ).toEqual({
      connection_revision: connectionRevision,
      conversation_id: conversationId,
      connections: { 'source-a': backupId, 'source-b': existingId },
    })
    expect(selections()).toEqual({ 'source-a': existingId, 'source-b': existingId })
    expect(screen.getByLabelText('Mutation pending')).toHaveTextContent('true')
    expect(screen.getByLabelText('Can run')).toHaveTextContent('false')
    await user.click(screen.getByRole('button', { name: 'Clear source connection' }))
    expect(requests.filter((item) => item.method === 'PUT')).toHaveLength(1)

    await act(async () =>
      pending.resolve(
        Response.json({
          reauthorization_required: false,
          connections: { 'source-a': backup, 'source-b': existing },
        } satisfies ConnectionConfigurationResponse),
      ),
    )
    await waitFor(() => expect(selections()['source-a']).toBe(backupId))
    await waitFor(() => expect(screen.getByLabelText('Can run')).toHaveTextContent('true'))
  })

  it('saves partial app defaults without a conversation and uses the authoritative returned selection', async () => {
    const user = userEvent.setup()
    const { requests } = installBackend({
      saveSelection: () =>
        Response.json({
          reauthorization_required: false,
          connections: { 'source-a': null, 'source-b': backup },
        } satisfies ConnectionConfigurationResponse),
    })
    render(tree({ address }))
    await ready()
    await user.click(screen.getByRole('button', { name: 'Clear source connection' }))
    await waitFor(() => expect(selections()).toEqual({ 'source-a': null, 'source-b': backupId }))
    expect(
      await requests
        .find((item) => item.method === 'PUT')!
        .clone()
        .json(),
    ).toEqual({
      connection_revision: connectionRevision,
      connections: { 'source-a': null, 'source-b': existingId },
    })
    expect(screen.getByLabelText('Can run')).toHaveTextContent('false')
  })

  it('preserves the old selection and reports an error when saving a manual choice fails', async () => {
    const user = userEvent.setup()
    installBackend({
      saveSelection: () => Response.json({ message: 'Save failed' }, { status: 500 }),
    })
    render(tree())
    await ready()
    await user.click(screen.getByRole('button', { name: 'Choose backup connection' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledExactlyOnceWith('common.api.actionFailed'),
    )
    expect(selections()).toEqual({ 'source-a': existingId, 'source-b': existingId })
    expect(screen.getByLabelText('Mutation pending')).toHaveTextContent('false')
  })

  it.each(['conversation', 'selectionSession'] as const)(
    'serializes selection writes after changing %s and refreshes the new session after the old write commits',
    async (changedScope) => {
      const user = userEvent.setup()
      const previousSave = deferred<Response>()
      const { backend, requests } = installBackend({ saveSelection: () => previousSave.promise })
      const scope: Scope =
        changedScope === 'conversation'
          ? { address, conversationId }
          : { address, selectionSession: 0 }
      const view = render(tree(scope))
      await ready()
      await user.click(screen.getByRole('button', { name: 'Choose backup connection' }))
      await waitFor(() => expect(requests.filter((item) => item.method === 'PUT')).toHaveLength(1))

      const nextScope =
        changedScope === 'conversation'
          ? { address, conversationId: createdId }
          : { address, selectionSession: 1 }
      view.rerender(tree(nextScope))
      await ready()
      expect(screen.getByLabelText('Mutation pending')).toHaveTextContent('true')
      expect(screen.getByLabelText('Can run')).toHaveTextContent('false')
      await user.click(screen.getByRole('button', { name: 'Clear source connection' }))
      expect(requests.filter((item) => item.method === 'PUT')).toHaveLength(1)
      const configurationReads = () =>
        requests.filter(
          (item) =>
            item.method === 'GET' &&
            new URL(item.url).pathname.endsWith('/connections/configuration'),
        )
      const readsBeforeCommit = configurationReads().length

      backend.configuration = {
        reauthorization_required: false,
        connections:
          changedScope === 'conversation'
            ? { 'source-a': existing, 'source-b': backup }
            : { 'source-a': backup, 'source-b': existing },
      }
      await act(async () =>
        previousSave.resolve(
          Response.json({
            reauthorization_required: false,
            connections: { 'source-a': backup, 'source-b': existing },
          } satisfies ConnectionConfigurationResponse),
        ),
      )
      await waitFor(() =>
        expect(screen.getByLabelText('Mutation pending')).toHaveTextContent('false'),
      )
      expect(configurationReads().length).toBeGreaterThan(readsBeforeCommit)
      expect(selections()).toEqual(
        changedScope === 'conversation'
          ? { 'source-a': existingId, 'source-b': backupId }
          : { 'source-a': backupId, 'source-b': existingId },
      )
      expect(toast.error).not.toHaveBeenCalled()

      backend.saveSelection = undefined
      await user.click(screen.getByRole('button', { name: 'Clear source connection' }))
      await waitFor(() => expect(selections()['source-a']).toBeNull())
      expect(requests.filter((item) => item.method === 'PUT')).toHaveLength(2)
      expect(
        await requests
          .filter((item) => item.method === 'PUT')
          .at(-1)!
          .clone()
          .json(),
      ).toEqual({
        connection_revision: connectionRevision,
        ...(changedScope === 'conversation' ? { conversation_id: createdId } : {}),
        connections: {
          'source-a': null,
          'source-b': changedScope === 'conversation' ? backupId : existingId,
        },
      })
    },
  )

  it('updates an API key only after PATCH succeeds and preserves the selected connection ID', async () => {
    const user = userEvent.setup()
    const original = connection({ credential_status: 'invalid' })
    const request = deferred<Response>()
    const { backend, requests } = installBackend({
      records: [original, backup],
      configuration: { reauthorization_required: false, connections: { 'source-a': original } },
    })
    let submitted: unknown
    backend.write = async (writeRequest) => {
      submitted = await writeRequest.json()
      return request.promise
    }
    render(tree())
    await ready()

    await user.click(screen.getByRole('button', { name: 'Replace connection' }))

    await waitFor(() =>
      expect(submitted).toEqual({ ...replacement, connection_revision: providerRevision }),
    )
    expect(
      requests
        .filter(
          (item) => item.method === 'PATCH' || new URL(item.url).pathname.endsWith('/revision'),
        )
        .map((item) => item.method),
    ).toEqual(['GET', 'PATCH'])
    expect(selections()['source-a']).toBe(existingId)
    expect(available()).toContainEqual(
      expect.objectContaining({ id: existingId, name: existing.name, status: 'invalid' }),
    )
    const updated = connection({ name: replacement.name, updated_at: 1_700_000_200 })
    backend.records = [updated, backup]
    await act(async () => {
      request.resolve(Response.json(updated))
    })

    await waitFor(() => expect(screen.getByLabelText('Action result')).toHaveTextContent('saved'))
    expect(
      requests.filter((item) => item.method === 'PATCH').map((item) => new URL(item.url).pathname),
    ).toEqual([expect.stringContaining(`/connections/${existingId}`)])
    expect(selections()['source-a']).toBe(existingId)
    expect(available()).toContainEqual(
      expect.objectContaining({ id: existingId, name: replacement.name, status: 'active' }),
    )
  })

  it.each(['PATCH', 'DELETE'] as const)(
    'preserves existing connections and selections after a failed %s',
    async (method) => {
      const user = userEvent.setup()
      const { backend } = installBackend()
      backend.write = () =>
        Response.json(
          { code: 'connection_conflict', status: 409, message: 'The connection changed.' },
          { status: 409 },
        )
      render(tree())
      await ready()

      await user.click(
        screen.getByRole('button', {
          name: method === 'PATCH' ? 'Replace connection' : 'Remove connection',
        }),
      )

      await waitFor(() =>
        expect(screen.getByLabelText('Action result')).toHaveTextContent('failed'),
      )
      expect(selections()).toEqual({ 'source-a': existingId, 'source-b': existingId })
      expect(available()).toContainEqual(
        expect.objectContaining({ id: existingId, name: existing.name }),
      )
      expect(toast.error).not.toHaveBeenCalled()
    },
  )

  it('removes a connection only after DELETE succeeds and clears every source that selected it', async () => {
    const user = userEvent.setup()
    const request = deferred<Response>()
    const { backend, requests } = installBackend()
    backend.write = () => request.promise
    render(tree())
    await ready()

    await user.click(screen.getByRole('button', { name: 'Remove connection' }))

    await waitFor(() => expect(requests.some((item) => item.method === 'DELETE')).toBe(true))
    expect(selections()).toEqual({ 'source-a': existingId, 'source-b': existingId })
    expect(available().some((item) => item.id === existingId)).toBe(true)
    backend.records = [backup]
    backend.configuration = {
      reauthorization_required: false,
      connections: { 'source-a': null, 'source-b': null },
    }
    await act(async () => {
      request.resolve(new Response(null, { status: 204 }))
    })

    await waitFor(() => expect(screen.getByLabelText('Action result')).toHaveTextContent('saved'))
    expect(selections()).toEqual({ 'source-a': null, 'source-b': null })
    expect(available().some((item) => item.id === existingId)).toBe(false)
    expect(available().some((item) => item.id === backupId)).toBe(true)
  })

  it('keeps API Key writes unavailable for an OAuth-only authorization source', async () => {
    const user = userEvent.setup()
    const oauth = connection({ credential_type: 'oauth2', account_label: 'reader@example.com' })
    const { requests } = installBackend({
      records: [oauth, backup],
      configuration: {
        reauthorization_required: false,
        connections: { 'source-a': oauth, 'source-b': backup },
      },
    })
    const source = entry()
    source.parameters = {
      ...source.parameters,
      connection_requirements: requirements.map((requirement): WebAppConnectionRequirement =>
        requirement.node_id === 'source-a'
          ? { ...requirement, allowed_credential_types: ['oauth2'] }
          : requirement,
      ),
    }
    render(tree({ address, conversationId, entry: source }))
    await ready()

    await user.click(screen.getByRole('button', { name: 'Add connection' }))
    await waitFor(() => expect(screen.getByLabelText('Action result')).toHaveTextContent('failed'))
    await user.click(screen.getByRole('button', { name: 'Replace connection' }))
    await waitFor(() => expect(screen.getByLabelText('Action result')).toHaveTextContent('failed'))

    expect(requests.every((request) => request.method === 'GET')).toBe(true)
    expect(selections()).toEqual({ 'source-a': existingId, 'source-b': backupId })
  })

  it('allows retrying a failed request without automatically reloading published parameters', async () => {
    const user = userEvent.setup()
    const { backend, requests } = installBackend()
    let attempts = 0
    backend.write = () => {
      attempts++
      backend.connectionRevision = nextConnectionRevision
      if (attempts === 1)
        return Response.json(
          {
            code: 'connection_credentials_unavailable',
            status: 503,
            message: 'The service is unavailable.',
          },
          { status: 503 },
        )
      backend.records.push(created)
      return Response.json(created, { status: 201 })
    }
    render(tree({ address, conversationId, probeParameters: true }))
    await ready()
    await waitFor(() =>
      expect(screen.getByLabelText('Connection revision')).toHaveTextContent(connectionRevision),
    )

    await user.click(screen.getByRole('button', { name: 'Add connection' }))

    await waitFor(() => expect(screen.getByLabelText('Action result')).toHaveTextContent('failed'))
    expect(screen.getByLabelText('Connection revision')).toHaveTextContent(connectionRevision)
    expect(
      requests.filter((request) => new URL(request.url).pathname.endsWith('/parameters')),
    ).toHaveLength(1)
    expect(selections()).toEqual({ 'source-a': existingId, 'source-b': existingId })
    await user.click(screen.getByRole('button', { name: 'Add connection' }))

    await waitFor(() => expect(screen.getByLabelText('Action result')).toHaveTextContent('saved'))
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(2)
    expect(
      requests.filter((request) => new URL(request.url).pathname.endsWith('/parameters')),
    ).toHaveLength(1)
    expect(selections()).toEqual({ 'source-a': createdId, 'source-b': existingId })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('keeps a newly created connection selected when it belongs to a later list page', async () => {
    const user = userEvent.setup()
    const { backend } = installBackend({ list: () => page([existing, backup], backupId) })
    backend.write = () => {
      backend.records.push(created)
      return Response.json(created, { status: 201 })
    }
    render(tree())
    await ready()

    await user.click(screen.getByRole('button', { name: 'Add connection' }))
    await waitFor(() => expect(selections()['source-a']).toBe(createdId))
    await user.click(screen.getByRole('button', { name: 'Reload connections' }))

    await ready()
    expect(selections()['source-a']).toBe(createdId)
    expect(available()).toContainEqual(expect.objectContaining({ id: createdId, name: draft.name }))
  })

  it('clears a confirmed connection removed elsewhere and allows choosing an existing backup', async () => {
    const user = userEvent.setup()
    const { backend, requests } = installBackend()
    backend.write = () => {
      backend.records.push(created)
      return Response.json(created, { status: 201 })
    }
    render(tree())
    await ready()
    await user.click(screen.getByRole('button', { name: 'Add connection' }))
    await waitFor(() => expect(selections()['source-a']).toBe(createdId))
    await waitFor(() =>
      expect(screen.getByLabelText('Mutation pending')).toHaveTextContent('false'),
    )
    backend.records = backend.records.filter((item) => item.id !== createdId)

    await user.click(screen.getByRole('button', { name: 'Reload connections' }))

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.method === 'GET' &&
            new URL(request.url).pathname.endsWith(`/connections/${createdId}`),
        ),
      ).toBe(true),
    )
    await waitFor(() => expect(selections()['source-a']).toBeNull())
    expect(screen.getByLabelText('Connection status')).toHaveTextContent('ready')
    expect(available().some((item) => item.id === createdId)).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Choose backup connection' }))

    expect(selections()).toEqual({ 'source-a': backupId, 'source-b': existingId })
    expect(toast.error).not.toHaveBeenCalled()
  })

  const oauthEntry = () => {
    const value = entry()
    value.parameters = {
      ...value.parameters,
      connection_requirements: requirements.map((requirement): WebAppConnectionRequirement => ({
        ...requirement,
        allowed_credential_types: ['oauth2'],
      })),
    }
    return value
  }

  const openAuthorizationPopup = () => {
    const child = {
      closed: false,
      location: { replace: vi.fn() },
      close: vi.fn(() => {
        child.closed = true
      }),
    }
    const popup = child as unknown as Window
    vi.spyOn(window, 'open').mockReturnValue(popup)
    return {
      child,
      complete: (connectionId: string) =>
        window.dispatchEvent(
          new MessageEvent('message', {
            source: popup,
            origin: window.location.origin,
            data: { type: 'oauth_callback', success: true, connectionId },
          }),
        ),
    }
  }

  it.each(['API key', 'OAuth'] as const)(
    'keeps a created %s available when selection saving fails and retries selection without creating again',
    async (method) => {
      const user = userEvent.setup()
      const isOAuth = method === 'OAuth'
      const original = connection({ credential_type: isOAuth ? 'oauth2' : 'api-key' })
      const newConnection = connection({ ...created, credential_type: original.credential_type })
      const { backend, requests } = installBackend({
        records: [original],
        configuration: {
          reauthorization_required: false,
          connections: { 'source-a': original, 'source-b': original },
        },
        saveSelection: () => Response.json({ message: 'Save failed' }, { status: 500 }),
      })
      backend.write = () => {
        backend.records = [original, newConnection]
        return isOAuth
          ? Response.json({ authorization_url: 'https://github.example/authorize' })
          : Response.json(newConnection, { status: 201 })
      }
      const popup = isOAuth ? openAuthorizationPopup() : null
      render(tree({ address, conversationId, entry: isOAuth ? oauthEntry() : entry() }))
      await ready()
      await user.click(
        screen.getByRole('button', { name: isOAuth ? 'Connect OAuth' : 'Add connection' }),
      )
      if (popup) {
        await waitFor(() => expect(popup.child.location.replace).toHaveBeenCalledOnce())
        await act(async () => popup.complete(createdId))
      }
      await waitFor(() => expect(screen.getByLabelText('Action result')).toHaveTextContent('saved'))
      expect(toast.error).toHaveBeenCalledExactlyOnceWith('common.api.actionFailed')
      expect(selections()).toEqual({ 'source-a': existingId, 'source-b': existingId })
      expect(available()).toContainEqual(expect.objectContaining({ id: createdId }))

      backend.saveSelection = undefined
      await user.click(screen.getByRole('button', { name: 'Choose created connection' }))
      await waitFor(() => expect(selections()['source-a']).toBe(createdId))
      expect(requests.filter((item) => item.method === 'POST')).toHaveLength(1)
      expect(requests.filter((item) => item.method === 'PUT')).toHaveLength(2)
    },
  )

  it('selects the OAuth callback connection only for the source that initiated authorization', async () => {
    const user = userEvent.setup()
    const oauthExisting = connection({
      credential_type: 'oauth2',
      account_label: 'personal@example.com',
    })
    const oauthBackup = connection({
      ...backup,
      credential_type: 'oauth2',
      account_label: 'work@example.com',
    })
    const oauthCreated = connection({
      ...created,
      credential_type: 'oauth2',
      account_label: 'new@example.com',
    })
    const { backend, requests } = installBackend({
      records: [oauthBackup, oauthExisting],
      configuration: {
        reauthorization_required: false,
        connections: { 'source-a': oauthExisting, 'source-b': oauthBackup },
      },
    })
    let submitted: unknown
    backend.write = async (request) => {
      submitted = await request.json()
      return Response.json({ authorization_url: 'https://github.example/authorize?state=opaque' })
    }
    const popup = openAuthorizationPopup()
    render(tree({ address, conversationId, entry: oauthEntry() }))
    await ready()

    await user.click(screen.getByRole('button', { name: 'Connect OAuth' }))

    await waitFor(() =>
      expect(popup.child.location.replace).toHaveBeenCalledExactlyOnceWith(
        'https://github.example/authorize?state=opaque',
      ),
    )
    expect(submitted).toEqual({
      connection_revision: connectionRevision,
      node_id: 'source-a',
    })
    expect(
      requests
        .filter((request) => request.method === 'POST')
        .map((request) => new URL(request.url).pathname),
    ).toEqual([expect.stringContaining('/connections/oauth/authorization-url')])
    backend.records = [oauthBackup, oauthCreated, oauthExisting]

    await act(async () => {
      popup.complete(createdId)
    })

    await waitFor(() =>
      expect(screen.getByLabelText('Mutation pending')).toHaveTextContent('false'),
    )
    expect(
      requests.some(
        (request) =>
          request.method === 'GET' &&
          new URL(request.url).pathname.endsWith(`/connections/${createdId}`),
      ),
    ).toBe(true)
    expect(
      await requests
        .find((item) => item.method === 'PUT')!
        .clone()
        .json(),
    ).toEqual({
      connection_revision: connectionRevision,
      conversation_id: conversationId,
      connections: { 'source-a': createdId, 'source-b': backupId },
    })
    expect(selections()).toEqual({ 'source-a': createdId, 'source-b': backupId })
    expect(available()).toContainEqual(
      expect.objectContaining({ id: createdId, name: 'new@example.com' }),
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('rejects an OAuth callback connection belonging to another provider without replacing the selection', async () => {
    const user = userEvent.setup()
    const oauthExisting = connection({
      credential_type: 'oauth2',
      account_label: 'personal@example.com',
    })
    const unrelated = connection({
      ...created,
      credential_type: 'oauth2',
      provider: 'another/provider',
      account_label: 'another@example.com',
    })
    const { backend, requests } = installBackend({
      records: [oauthExisting, unrelated],
      configuration: {
        reauthorization_required: false,
        connections: { 'source-a': oauthExisting, 'source-b': oauthExisting },
      },
    })
    backend.write = () => Response.json({ authorization_url: 'https://github.example/authorize' })
    const popup = openAuthorizationPopup()
    render(tree({ address, conversationId, entry: oauthEntry() }))
    await ready()
    await user.click(screen.getByRole('button', { name: 'Connect OAuth' }))
    await waitFor(() => expect(popup.child.location.replace).toHaveBeenCalledOnce())

    await act(async () => {
      popup.complete(createdId)
    })

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledExactlyOnceWith('common.api.actionFailed'),
    )
    expect(
      requests.some(
        (request) =>
          request.method === 'GET' &&
          new URL(request.url).pathname.endsWith(`/connections/${createdId}`),
      ),
    ).toBe(true)
    expect(selections()).toEqual({ 'source-a': existingId, 'source-b': existingId })
    expect(available().some((item) => item.id === createdId)).toBe(false)
  })

  it('reauthorizes and refreshes the existing OAuth connection while preserving its ID', async () => {
    const user = userEvent.setup()
    const expired = connection({
      credential_type: 'oauth2',
      credential_status: 'reconnect_required',
      account_label: 'personal@example.com',
    })
    const refreshed = connection({
      credential_type: 'oauth2',
      account_label: 'personal@example.com',
      updated_at: 1_700_000_300,
    })
    const { backend, requests } = installBackend({
      records: [expired],
      configuration: { reauthorization_required: false, connections: { 'source-a': expired } },
    })
    let submitted: unknown
    backend.write = async (request) => {
      submitted = await request.json()
      return Response.json({ authorization_url: 'https://github.example/reauthorize' })
    }
    const popup = openAuthorizationPopup()
    render(tree({ address, conversationId, entry: oauthEntry() }))
    await ready()

    await user.click(screen.getByRole('button', { name: 'Reconnect OAuth' }))
    await waitFor(() =>
      expect(popup.child.location.replace).toHaveBeenCalledExactlyOnceWith(
        'https://github.example/reauthorize',
      ),
    )
    expect(submitted).toEqual({ connection_revision: providerRevision })
    expect(
      requests
        .filter(
          (item) => item.method === 'POST' || new URL(item.url).pathname.endsWith('/revision'),
        )
        .map((item) => item.method),
    ).toEqual(['GET', 'POST'])
    backend.records = [refreshed]
    await act(async () => {
      popup.complete(existingId)
    })

    await waitFor(() =>
      expect(screen.getByLabelText('Mutation pending')).toHaveTextContent('false'),
    )
    expect(
      requests
        .filter((request) => request.method === 'POST')
        .map((request) => new URL(request.url).pathname),
    ).toEqual([expect.stringContaining(`/connections/${existingId}/reauthorize`)])
    expect(selections()).toEqual({ 'source-a': existingId, 'source-b': null })
    expect(available()).toContainEqual(
      expect.objectContaining({ id: existingId, status: 'active' }),
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each(['Connect OAuth', 'Reconnect OAuth'] as const)(
    'reports a failed %s authorization request once and preserves the previous choices',
    async (action) => {
      const user = userEvent.setup()
      const oauthExisting = connection({
        credential_type: 'oauth2',
        account_label: 'personal@example.com',
      })
      const { backend, requests } = installBackend({
        records: [oauthExisting],
        configuration: {
          reauthorization_required: false,
          connections: { 'source-a': oauthExisting, 'source-b': oauthExisting },
        },
      })
      backend.write = () =>
        Response.json(
          {
            code: 'connection_credentials_unavailable',
            status: 503,
            message: 'Authorization is unavailable.',
          },
          { status: 503 },
        )
      const popup = openAuthorizationPopup()
      render(tree({ address, conversationId, entry: oauthEntry() }))
      await ready()

      await user.click(screen.getByRole('button', { name: action }))

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledExactlyOnceWith('common.api.actionFailed'),
      )
      expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1)
      expect(popup.child.closed).toBe(true)
      expect(selections()).toEqual({ 'source-a': existingId, 'source-b': existingId })
    },
  )

  it('keeps cancellation silent when the user closes the OAuth popup', async () => {
    const user = userEvent.setup()
    const oauthExisting = connection({
      credential_type: 'oauth2',
      account_label: 'personal@example.com',
    })
    const { backend } = installBackend({
      records: [oauthExisting],
      configuration: {
        reauthorization_required: false,
        connections: { 'source-a': oauthExisting, 'source-b': oauthExisting },
      },
    })
    backend.write = () => Response.json({ authorization_url: 'https://github.example/authorize' })
    const popup = openAuthorizationPopup()
    render(tree({ address, conversationId, entry: oauthEntry() }))
    await ready()
    await user.click(screen.getByRole('button', { name: 'Connect OAuth' }))
    await waitFor(() => expect(popup.child.location.replace).toHaveBeenCalledOnce())

    popup.child.closed = true

    await waitFor(() =>
      expect(screen.getByLabelText('Mutation pending')).toHaveTextContent('false'),
    )
    expect(toast.error).not.toHaveBeenCalled()
    expect(selections()).toEqual({ 'source-a': existingId, 'source-b': existingId })
  })

  it('aborts the OAuth popup silently after switching accounts and ignores its late result', async () => {
    const user = userEvent.setup()
    const oauthExisting = connection({
      credential_type: 'oauth2',
      account_label: 'personal@example.com',
    })
    const oauthBackup = connection({
      ...backup,
      credential_type: 'oauth2',
      account_label: 'work@example.com',
    })
    const { backend } = installBackend({
      records: [oauthExisting, oauthBackup],
      configuration: {
        reauthorization_required: false,
        connections: { 'source-a': oauthExisting, 'source-b': oauthExisting },
      },
    })
    backend.write = () => Response.json({ authorization_url: 'https://github.example/authorize' })
    const popup = openAuthorizationPopup()
    const scope: Scope = { address, conversationId, entry: oauthEntry() }
    const { rerender } = render(tree(scope))
    await ready()
    await user.click(screen.getByRole('button', { name: 'Connect OAuth' }))
    await waitFor(() => expect(popup.child.location.replace).toHaveBeenCalledOnce())
    backend.configuration = {
      reauthorization_required: false,
      connections: { 'source-a': oauthBackup, 'source-b': oauthBackup },
    }

    act(() => {
      setWebAppAccessToken('account-b', 'end_user')
      setWebAppPassport(address, 'account-b-passport')
    })
    rerender(tree(scope))

    await ready()
    expect(popup.child.closed).toBe(true)
    expect(selections()).toEqual({ 'source-a': backupId, 'source-b': backupId })
    await act(async () => {
      popup.complete(createdId)
    })
    expect(selections()).toEqual({ 'source-a': backupId, 'source-b': backupId })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each(['App', 'account', 'conversation'] as const)(
    'does not apply an in-flight create result to a different %s scope',
    async (changedScope) => {
      const user = userEvent.setup()
      const pendingWrite = deferred<Response>()
      const { backend, requests } = installBackend()
      backend.write = () => pendingWrite.promise
      const originalScope: Scope = { address, conversationId }
      const { rerender } = render(tree(originalScope))
      await ready()
      await user.click(screen.getByRole('button', { name: 'Add connection' }))
      await waitFor(() => expect(requests.some((request) => request.method === 'POST')).toBe(true))
      backend.configuration = {
        reauthorization_required: false,
        connections: { 'source-a': backup, 'source-b': backup },
      }
      const nextScope = { ...originalScope }
      if (changedScope === 'App') {
        nextScope.address = { kind: 'default', code: 'another-app' }
        window.history.replaceState({}, '', '/chat/another-app')
        setWebAppPassport(nextScope.address, 'another-app-passport')
      } else if (changedScope === 'account') {
        act(() => {
          setWebAppAccessToken('account-b', 'end_user')
          setWebAppPassport(address, 'account-b-passport')
        })
      } else {
        nextScope.conversationId = '77777777-7777-4777-8777-777777777777'
      }
      rerender(tree(nextScope))
      await ready()
      expect(selections()).toEqual({ 'source-a': backupId, 'source-b': backupId })

      await act(async () => {
        pendingWrite.resolve(Response.json(created, { status: 201 }))
      })

      expect(selections()).toEqual({ 'source-a': backupId, 'source-b': backupId })
      expect(available().some((item) => item.id === createdId)).toBe(false)
      expect(toast.error).not.toHaveBeenCalled()
    },
  )
})
