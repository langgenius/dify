import type { EndUserConnectionResponse } from '@dify/contracts/api/web/types.gen'
import type { PropsWithChildren } from 'react'
import type { WebAppEntryState } from '../../../../webapp-entry'
import type { TextGenerationTranslate } from '../../../types'
import type { WorkflowRunSnapshot } from '../../../workflow-run-configuration'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AppSourceType, sendWorkflowMessage } from '@/service/share'
import { withSelectorKey } from '@/test/i18n-mock'
import { createTestQueryClient } from '@/test/query-client'
import { Resolution, TransferMethod } from '@/types/app'
import { WebAppConnectionsProvider } from '../../../../connections/connection-provider'
import { useOptionalWebAppConnections } from '../../../../connections/use-connections'
import { WebAppEntryContext } from '../../../../webapp-entry'
import { captureWorkflowRunConfiguration } from '../../../workflow-run-configuration'
import { useResultRunState } from '../use-result-run-state'
import { useResultSender } from '../use-result-sender'

vi.mock('@/app/components/base/amplitude/web-app-event', () => ({ trackWebAppEvent: vi.fn() }))
vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (select: (state: { appInfo: { mode: string } }) => unknown) =>
    select({ appInfo: { mode: 'workflow' } }),
}))
vi.mock('@/utils', async (original) => ({
  ...(await original<typeof import('@/utils')>()),
  sleep: () => new Promise<void>(() => {}),
}))
vi.mock('@/service/share', async (original) => ({
  ...(await original<typeof import('@/service/share')>()),
  sendWorkflowMessage: vi.fn().mockResolvedValue(undefined),
}))

const connectionId = '11111111-1111-4111-8111-111111111111'
const revision = '22222222-2222-4222-8222-222222222222'
const checkedRevision = '33333333-3333-4333-8333-333333333333'
const address = { kind: 'default', code: 'workflow-connections' } as const
const connection: EndUserConnectionResponse = {
  id: connectionId,
  provider: 'langgenius/github/github',
  name: 'Personal GitHub',
  account_label: 'me@example.com',
  credential_type: 'api-key',
  credential_status: 'connected',
  expires_at: null,
  created_at: 1,
  updated_at: 1,
  last_active_at: 1,
}
const entry: Extract<WebAppEntryState, { parameters: unknown }> = {
  status: 'connections-pending',
  account: 'authenticated',
  parameters: {
    account_login_enabled: true,
    account_login_url: 'https://account.example/signin',
    allow_anonymous_end_user_auth: false,
    connection_revision: revision,
    requires_end_user_connections: true,
    connection_requirements: [
      {
        node_id: 'source',
        node_ids: ['source', 'reuse'],
        provider: connection.provider,
        allowed_credential_types: ['api-key'],
        plugin_unique_identifier: 'langgenius/github:1.0.0@digest',
        title: 'Find repositories',
        purpose: 'Research',
        icon: '/github.svg',
        icon_dark: null,
      },
    ],
  },
  showSignIn: false,
  canRun: false,
}

function renderWorkflow({ batch = false, requiresConnections = true } = {}) {
  const client = createTestQueryClient()
  const onCompleted = vi.fn()
  const onTaskStart = vi.fn()
  let preflightReady = true
  let waitForConfiguration: Promise<void> | undefined
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    if (path.endsWith('/connections/configuration')) {
      await waitForConfiguration
      return Response.json({ connections: { source: connection } })
    }
    if (path.endsWith('/connections/preflight'))
      return Response.json({
        connection_revision: checkedRevision,
        ready: preflightReady,
        connections: [
          {
            node_id: 'source',
            connection_id: connectionId,
            status: preflightReady ? 'connected' : 'invalid',
            check: null,
          },
        ],
      })
    if (path.endsWith('/connections'))
      return Response.json({ data: [connection], has_more: false, next_cursor: null })
    throw new Error(`Unexpected request: ${request.method} ${path}`)
  })
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <WebAppEntryContext
          value={
            requiresConnections
              ? entry
              : {
                  ...entry,
                  status: 'ready',
                  canRun: true,
                  parameters: {
                    ...entry.parameters,
                    requires_end_user_connections: false,
                    connection_requirements: [],
                  },
                }
          }
        >
          <WebAppConnectionsProvider address={address}>{children}</WebAppConnectionsProvider>
        </WebAppEntryContext>
      </QueryClientProvider>
    )
  }
  const hook = renderHook(
    ({ snapshot }: { snapshot?: WorkflowRunSnapshot }) => {
      const connections = useOptionalWebAppConnections()
      // oxlint-disable-next-line eslint-react/use-state -- This hook returns a ResultRunStateController object, not a state tuple.
      const runState = useResultRunState({
        appSourceType: AppSourceType.webApp,
        isWorkflow: true,
        notify: vi.fn(),
      })
      const sender = useResultSender({
        runSnapshot: snapshot,
        appSourceType: AppSourceType.webApp,
        appId: 'app',
        isWorkflow: true,
        isPC: true,
        isCallBatchAPI: batch,
        taskId: batch ? 7 : undefined,
        completionFiles: [],
        inputs: { query: 'Keep this draft' },
        notify: vi.fn(),
        onCompleted,
        onTaskStart,
        onRunStart: vi.fn(),
        onShowRes: vi.fn(),
        promptConfig: {
          prompt_template: '',
          prompt_variables: [{ key: 'query', name: 'Query', type: 'string', required: true }],
        },
        runState,
        t: withSelectorKey((key: string) => key) as TextGenerationTranslate,
        visionConfig: {
          enabled: false,
          number_limits: 2,
          detail: Resolution.low,
          transfer_methods: [TransferMethod.local_file],
        },
      })
      return { ...sender, runState, connections }
    },
    { wrapper: Wrapper, initialProps: {} },
  )
  return {
    ...hook,
    client,
    onCompleted,
    onTaskStart,
    setReady: (ready: boolean) => {
      preflightReady = ready
    },
    pauseConfiguration: (promise: Promise<void>) => {
      waitForConfiguration = promise
    },
  }
}

beforeEach(() => {
  window.history.replaceState({}, '', '/workflow/workflow-connections')
})

describe('public Workflow connection runs', () => {
  it('blocks a run before validation without clearing or starting the result, then sends the checked revision and complete mapping', async () => {
    const { result, onTaskStart } = renderWorkflow()
    await act(async () => expect(await result.current.handleSend()).toBe(false))
    expect(onTaskStart).not.toHaveBeenCalled()
    expect(result.current.runState.isResponding).toBe(false)
    expect(sendWorkflowMessage).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.connections?.canRun).toBe(true))
    await act(async () => expect(await result.current.handleSend()).toBe(true))
    expect(sendWorkflowMessage).toHaveBeenCalledWith(
      {
        inputs: { query: 'Keep this draft' },
        connection_revision: checkedRevision,
        connections: { source: connectionId },
      },
      expect.any(Object),
      AppSourceType.webApp,
      'app',
    )
  })

  it('keeps an accepted batch snapshot during a background reload, while a manual retry still requires a current check', async () => {
    const hook = renderWorkflow({ batch: true })
    await waitFor(() => expect(hook.result.current.connections?.canRun).toBe(true))
    const snapshot = captureWorkflowRunConfiguration(hook.result.current.connections)
    if (!snapshot) throw new Error('Expected a checked run snapshot')
    hook.rerender({ snapshot })
    hook.pauseConfiguration(new Promise<void>(() => {}))
    act(() => {
      void hook.client.invalidateQueries({
        predicate: (query) => query.queryKey.includes(revision),
      })
    })
    await waitFor(() => expect(hook.result.current.connections?.canRun).toBe(false))
    await act(async () => expect(await hook.result.current.handleSend()).toBe(false))
    expect(hook.onCompleted).toHaveBeenCalledExactlyOnceWith('', 7, false)
    await act(async () => expect(await hook.result.current.handleSend(true)).toBe(true))
    expect(sendWorkflowMessage).toHaveBeenCalledOnce()
    expect(hook.onTaskStart).toHaveBeenCalledWith(7)
    expect(vi.mocked(sendWorkflowMessage).mock.calls[0]![0]).toMatchObject(snapshot.configuration!)
  })

  it('drains a queued batch task after leaving its App instead of sending under a new identity', async () => {
    const hook = renderWorkflow({ batch: true })
    await waitFor(() => expect(hook.result.current.connections?.canRun).toBe(true))
    const snapshot = captureWorkflowRunConfiguration(hook.result.current.connections)
    if (!snapshot) throw new Error('Expected a checked run snapshot')
    hook.rerender({ snapshot })
    window.history.replaceState({}, '', '/workflow/another-app')
    await act(async () => expect(await hook.result.current.handleSend(true)).toBe(false))
    expect(sendWorkflowMessage).not.toHaveBeenCalled()
    expect(hook.onCompleted).toHaveBeenCalledExactlyOnceWith('', 7, false)
    expect(hook.result.current.runState.isResponding).toBe(false)
  })

  it('rejects retry when Preflight reports invalid credentials', async () => {
    const hook = renderWorkflow()
    await waitFor(() => expect(hook.result.current.connections?.canRun).toBe(true))
    hook.setReady(false)
    await act(async () => {
      await hook.client.invalidateQueries({
        predicate: (query) => JSON.stringify(query.queryKey).includes('preflight'),
      })
    })
    await waitFor(() => expect(hook.result.current.connections?.preflight.status).toBe('blocked'))
    await act(async () => expect(await hook.result.current.handleSend()).toBe(false))
    expect(sendWorkflowMessage).not.toHaveBeenCalled()
    expect(hook.onTaskStart).not.toHaveBeenCalled()
  })

  it('does not send a stale connection mapping when the published Workflow has no personal connection requirement', async () => {
    const hook = renderWorkflow({ requiresConnections: false })
    expect(hook.result.current.connections?.status).toBe('inactive')
    await act(async () => expect(await hook.result.current.handleSend()).toBe(true))
    expect(sendWorkflowMessage).toHaveBeenCalledExactlyOnceWith(
      {
        inputs: { query: 'Keep this draft' },
      },
      expect.any(Object),
      AppSourceType.webApp,
      'app',
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
