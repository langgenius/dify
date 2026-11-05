import { act } from '@testing-library/react'
import { createElement } from 'react'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createSocket } from '@/app/components/workflow/collaboration/core/__tests__/test-socket'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import * as websocketManager from '@/app/components/workflow/collaboration/core/websocket-manager'
import { BlockEnum } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { createHttpError } from '@/service/http-error'
import { createConsoleQueryWrapper, seedAppDetail } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { useNodesSyncDraft } from '../use-nodes-sync-draft'

const request = vi.hoisted(() => vi.fn())
const keepalive = vi.hoisted(() => vi.fn())
vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
  return { ...actual, toast: { ...actual.toast, error: vi.fn() } }
})
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { apps } = await import('@dify/contracts/api/console/apps/orpc.gen')
  const { validateDefinedErrors } = await import('@/service/console/defined-errors')
  const validate = validateDefinedErrors({ apps })
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.draft.post': (input) =>
        validate({
          context: {},
          input,
          path: ['apps', 'byAppId', 'workflows', 'draft', 'post'],
          next: () => request(input),
        }),
    }),
  }
})
vi.mock('@/service/fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/fetch')>()),
  postWithKeepalive: (...args: unknown[]) => keepalive(...args),
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

it('uses guarded full draft saves after the default socket fails before joining', async () => {
  const { webSocketClient } = websocketManager
  const transport = createSocket('socket-app-1', false)
  vi.spyOn(websocketManager, 'isDefaultSocketUrl').mockReturnValue(true)
  vi.spyOn(webSocketClient, 'connect').mockReturnValue(transport.socket)
  vi.spyOn(webSocketClient, 'getSocket').mockReturnValue(transport.socket)
  vi.spyOn(webSocketClient, 'isConnected').mockImplementation(() => transport.socket.connected)
  vi.spyOn(webSocketClient, 'disconnect').mockImplementation(() => {
    transport.socket.connected = false
    transport.socket.removeAllListeners()
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const connectionId = await collaborationManager.connect('app-1', undefined, () => 'hash-123')
  const fallback = vi.fn()
  collaborationManager.onInitialPlainDraftFallback(fallback)
  transport.receive('connect_error', new Error('connection failed'))
  expect(fallback).toHaveBeenCalledWith('app-1')

  const node = createNode({ id: 'start', data: { type: BlockEnum.Start, title: 'Start' } })
  const features = createFeaturesStore({})
  const { queryClient } = createConsoleQueryWrapper()
  seedAppDetail(queryClient, createAppDetailFixture({ id: 'app-1', mode: 'workflow' }))
  const { result, unmount } = renderWorkflowCanvasHook(() => useNodesSyncDraft(), {
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    nodes: [node],
    initialStoreState: {
      isWorkflowDataLoaded: true,
      isCollaborationEnabled: true,
      syncWorkflowDraftHash: 'hash-123',
    },
    wrapper: ({ children }) =>
      createElement(FeaturesContext.Provider, { value: features }, children),
  })

  // The server rejects ordinary saves while another collaboration room is active.
  request.mockRejectedValue(
    createHttpError(new Response(null, { status: 409 }), {
      code: 'draft_workflow_collaboration_active',
      message: 'The workflow is being edited collaboratively.',
      status: 409,
    }),
  )
  await act(async () => {
    await expect(result.current.doSyncWorkflowDraft()).resolves.toBeNull()
  })
  expect(request).toHaveBeenCalledOnce()
  expect(request.mock.lastCall?.[0].body).toEqual(
    expect.objectContaining({
      graph: expect.objectContaining({ nodes: [expect.objectContaining({ id: 'start' })] }),
      features: expect.any(Object),
      conversation_variables: expect.any(Array),
    }),
  )
  expect(request.mock.lastCall?.[0].body).not.toHaveProperty('_is_collaborative')
  expect(toast.error).toHaveBeenCalledWith('workflow.collaboration.draftSaveBlocked')

  act(() => result.current.syncWorkflowDraftWhenPageClose())
  expect(keepalive).toHaveBeenCalledOnce()
  expect(keepalive.mock.lastCall?.[1]).not.toHaveProperty('_is_collaborative')
  expect(keepalive.mock.lastCall?.[1]).toEqual(
    expect.objectContaining({
      graph: expect.objectContaining({ nodes: [expect.objectContaining({ id: 'start' })] }),
      features: expect.any(Object),
      conversation_variables: expect.any(Array),
    }),
  )
  unmount()
  collaborationManager.disconnect(connectionId)
})
