import { act } from '@testing-library/react'
import { createElement } from 'react'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { createConsoleQueryWrapper, seedAppDetail } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { useNodesSyncDraft } from '../use-nodes-sync-draft'

const boundary = vi.hoisted(() => ({
  syncLoro: vi.fn(),
  httpSave: vi.fn(),
  keepalive: vi.fn(),
  environment: vi.fn(),
  leaderSave: vi.fn(),
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    syncLoroDraft: boundary.syncLoro,
    requestWorkflowSync: boundary.leaderSave,
  },
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleClient: { apps: { byAppId: { workflows: { draft: { post: boundary.httpSave } } } } },
  }
})
vi.mock('@/service/fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/fetch')>()),
  postWithKeepalive: boundary.keepalive,
}))
vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  updateEnvironmentVariables: boundary.environment,
}))
vi.mock('../use-workflow-refresh-draft', () => ({
  useWorkflowRefreshDraft: () => ({ handleRefreshWorkflowDraft: vi.fn() }),
}))

beforeEach(() => {
  vi.resetAllMocks()
  boundary.syncLoro.mockResolvedValue({ hash: 'loro-confirmed', updatedAt: 42 })
  boundary.httpSave.mockResolvedValue({ hash: 'http-confirmed', updated_at: 43 })
  boundary.environment.mockResolvedValue({})
})

function renderDraft({ enabled = true, empty = false } = {}) {
  const features = createFeaturesStore()
  const { queryClient } = createConsoleQueryWrapper()
  seedAppDetail(queryClient, createAppDetailFixture({ id: 'app-1', mode: 'workflow' }))
  return renderWorkflowCanvasHook(() => useNodesSyncDraft(), {
    queryClient,
    resource: { kind: 'app', appId: 'app-1', mode: 'workflow', collaborationEnabled: enabled },
    nodes: empty
      ? []
      : [createNode({ id: 'start', data: { type: BlockEnum.Start, title: 'Start' } })],
    initialStoreState: {
      isWorkflowDataLoaded: true,
      syncWorkflowDraftHash: 'baseline',
      syncWorkflowDraftIsEmpty: empty,
      loroDraft: enabled ? { epoch: 'epoch-1', accountId: 'editor-1' } : undefined,
    },
    wrapper: ({ children }) =>
      createElement(FeaturesContext.Provider, { value: features }, children),
  })
}

it('returns the Loro confirmation directly to the saving caller', async () => {
  const { result } = renderDraft()
  const onSuccess = vi.fn()
  const onSettled = vi.fn()
  await act(async () => {
    const confirmation = await result.current.doSyncWorkflowDraft(false, { onSuccess, onSettled })
    expect(confirmation).toEqual({ hash: 'loro-confirmed', updatedAt: 42 })
  })
  expect(boundary.syncLoro).toHaveBeenCalledExactlyOnceWith('app-1', false)
  expect(boundary.httpSave).not.toHaveBeenCalled()
  expect(boundary.leaderSave).not.toHaveBeenCalled()
  expect(onSuccess).toHaveBeenCalledOnce()
  expect(onSettled).toHaveBeenCalledOnce()
})

it('keeps a rejected Loro save on the Loro path and allows the caller to retry', async () => {
  boundary.syncLoro.mockRejectedValueOnce(new Error('Connection unavailable'))
  const { result } = renderDraft()
  const onError = vi.fn()
  const onSettled = vi.fn()
  await act(async () => {
    expect(await result.current.doSyncWorkflowDraft(false, { onError, onSettled })).toBeNull()
  })
  expect(onError).toHaveBeenCalledOnce()
  expect(onSettled).toHaveBeenCalledOnce()
  await act(async () => {
    expect(await result.current.doSyncWorkflowDraft()).toEqual({
      hash: 'loro-confirmed',
      updatedAt: 42,
    })
  })
  expect(boundary.httpSave).not.toHaveBeenCalled()
  expect(boundary.leaderSave).not.toHaveBeenCalled()
})

it('does not send a page-close HTTP snapshot over a durable Loro draft', () => {
  const { result } = renderDraft()
  result.current.syncWorkflowDraftWhenPageClose()
  expect(boundary.keepalive).not.toHaveBeenCalled()
  expect(boundary.httpSave).not.toHaveBeenCalled()
})

it('saves the environment patch before confirming the graph through Loro', async () => {
  const { result } = renderDraft()
  const patch = { environmentVariables: [], deletedEnvironmentVariableIds: ['obsolete-variable'] }
  await act(async () => {
    await result.current.doSyncWorkflowDraft(false, undefined, { environmentVariablePatch: patch })
  })
  expect(boundary.environment).toHaveBeenCalledExactlyOnceWith(
    { appId: 'app-1', ...patch },
    { silent: true },
  )
  expect(boundary.environment.mock.invocationCallOrder[0]).toBeLessThan(
    boundary.syncLoro.mock.invocationCallOrder[0]!,
  )
  expect(boundary.syncLoro).toHaveBeenCalledExactlyOnceWith('app-1', false)
  expect(boundary.httpSave).not.toHaveBeenCalled()
})

it('confirms an already-empty collaborative draft through the Loro boundary', async () => {
  const { result } = renderDraft({ empty: true })
  await act(async () => {
    await result.current.doSyncWorkflowDraft()
  })
  expect(boundary.syncLoro).toHaveBeenCalledExactlyOnceWith('app-1', true)
  expect(boundary.httpSave).not.toHaveBeenCalled()
})

it('retains HTTP draft saving and page-close saving when collaboration is disabled', async () => {
  const { result, store } = renderDraft({ enabled: false })
  await act(async () => {
    await result.current.doSyncWorkflowDraft()
  })
  expect(boundary.httpSave).toHaveBeenCalledOnce()
  expect(boundary.httpSave).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.not.objectContaining({ _is_collaborative: expect.anything() }),
    }),
    expect.anything(),
  )
  expect(store.getState().syncWorkflowDraftHash).toBe('http-confirmed')
  result.current.syncWorkflowDraftWhenPageClose()
  expect(boundary.keepalive).toHaveBeenCalledOnce()
  expect(boundary.syncLoro).not.toHaveBeenCalled()
})
