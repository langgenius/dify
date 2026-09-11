import type { KnowledgeFsBackgroundTaskListResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { createStore } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { documentDetailKnowledgeSpaceIdAtom } from '../state/inputs'
import { documentBackgroundTasksAtom, documentTaskDrawerOpenAtom } from '../state/workflow'

const listTasks = vi.hoisted(() => vi.fn<() => Promise<KnowledgeFsBackgroundTaskListResponse>>())

vi.mock('@/service/console', async () => {
  const { createTanstackQueryUtils } = await import('@orpc/tanstack-query')
  return {
    consoleQuery: createTanstackQueryUtils({
      knowledgeFs: { spaces: { byControlSpaceId: { backgroundTasks: { get: listTasks } } } },
    }),
  }
})

function taskResponse(
  taskKind: 'document' | 'document_bulk' | 'source',
  state: 'queued' | 'running' | 'completed',
): KnowledgeFsBackgroundTaskListResponse {
  return {
    next_cursor: null,
    data: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        knowledge_space_id: 'space-1',
        task_kind: taskKind,
        operation: taskKind === 'source' ? 'source_sync' : 'document_reindex',
        state,
        can_cancel: state !== 'completed',
        can_retry: false,
        created_at: '2026-09-11T12:00:00Z',
        updated_at: state === 'queued' ? '2026-09-11T12:00:00Z' : '2026-09-11T12:01:00Z',
        progress_completed: state === 'completed' ? 1 : 0,
        progress_failed: 0,
        progress_percent: state === 'completed' ? 100 : state === 'running' ? 50 : 0,
        progress_total: 1,
      },
    ],
  }
}

describe('document detail task drawer polling', () => {
  let client: QueryClient
  let store: ReturnType<typeof createStore>
  let unsubscribe: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    listTasks.mockReset()
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    store = createStore()
    store.set(queryClientAtom, client)
    store.set(documentDetailKnowledgeSpaceIdAtom, 'space-1')
    unsubscribe = () => undefined
  })

  afterEach(() => {
    unsubscribe()
    client.clear()
    vi.useRealTimers()
  })

  async function observeTasks() {
    unsubscribe = store.sub(documentBackgroundTasksAtom, () => undefined)
    await vi.advanceTimersByTimeAsync(1)
  }

  it.each(['document', 'document_bulk', 'source'] as const)(
    'updates %s progress while open and stops once completed',
    async (taskKind) => {
      listTasks
        .mockResolvedValueOnce(taskResponse(taskKind, 'queued'))
        .mockResolvedValueOnce(taskResponse(taskKind, 'running'))
        .mockResolvedValue(taskResponse(taskKind, 'completed'))
      store.set(documentTaskDrawerOpenAtom, true)
      await observeTasks()
      expect(store.get(documentBackgroundTasksAtom)[0]).toMatchObject({ state: 'queued' })

      await vi.advanceTimersByTimeAsync(5001)
      expect(store.get(documentBackgroundTasksAtom)[0]).toMatchObject({
        state: 'running',
        progressPercent: 50,
      })
      await vi.advanceTimersByTimeAsync(5001)
      expect(store.get(documentBackgroundTasksAtom)[0]).toMatchObject({
        state: 'succeeded',
        progressPercent: 100,
        canCancel: false,
      })
      await vi.advanceTimersByTimeAsync(15000)
      expect(listTasks).toHaveBeenCalledTimes(3)
    },
  )

  it('pauses polling when closed and resumes on reopening', async () => {
    listTasks.mockResolvedValue(taskResponse('document_bulk', 'running'))
    await observeTasks()
    await vi.advanceTimersByTimeAsync(10000)
    expect(listTasks).not.toHaveBeenCalled()

    store.set(documentTaskDrawerOpenAtom, true)
    await vi.advanceTimersByTimeAsync(1)
    expect(store.get(documentBackgroundTasksAtom)[0]?.state).toBe('running')
    listTasks.mockClear()
    await vi.advanceTimersByTimeAsync(5001)
    expect(listTasks).toHaveBeenCalledOnce()

    store.set(documentTaskDrawerOpenAtom, false)
    listTasks.mockClear()
    await vi.advanceTimersByTimeAsync(10000)
    expect(listTasks).not.toHaveBeenCalled()

    store.set(documentTaskDrawerOpenAtom, true)
    await vi.advanceTimersByTimeAsync(1)
    listTasks.mockClear()
    await vi.advanceTimersByTimeAsync(5001)
    expect(listTasks).toHaveBeenCalledOnce()
  })

  it('stops polling after read permission is revoked', async () => {
    listTasks
      .mockResolvedValueOnce(taskResponse('document_bulk', 'running'))
      .mockRejectedValue({ status: 403 })
    store.set(documentTaskDrawerOpenAtom, true)
    await observeTasks()
    await vi.advanceTimersByTimeAsync(5001)
    expect(listTasks).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(15000)
    expect(listTasks).toHaveBeenCalledTimes(2)
  })
})
