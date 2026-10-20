import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TaskStatus } from '../../../types'
import checkTaskStatus from '../check-task-status'

const { fetchTask } = vi.hoisted(() => ({ fetchTask: vi.fn() }))
vi.mock('@/service/plugins', () => ({ checkTaskStatus: fetchTask }))

const task = (status: TaskStatus) => ({
  task: {
    plugins: [
      {
        plugin_unique_identifier: 'other-plugin',
        status: TaskStatus.failed,
        message: 'Unrelated failure',
      },
      { plugin_unique_identifier: 'test-plugin', status, message: '' },
    ],
  },
})
const params = { taskId: 'task-1', pluginUniqueIdentifier: 'test-plugin' }

describe('checkTaskStatus', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => vi.useRealTimers())

  it('fails when the requested package is absent from the task', async () => {
    fetchTask.mockResolvedValue({
      task: { plugins: [{ plugin_unique_identifier: 'other-plugin', status: TaskStatus.success }] },
    })

    await expect(checkTaskStatus().check(params)).resolves.toEqual({
      status: TaskStatus.failed,
      error: 'Plugin package not found',
    })
  })

  it('follows the requested package through pending and running until success', async () => {
    fetchTask
      .mockResolvedValueOnce(task(TaskStatus.pending))
      .mockResolvedValueOnce(task(TaskStatus.running))
      .mockResolvedValueOnce(task(TaskStatus.success))
    const completed = vi.fn()
    const result = checkTaskStatus().check(params).then(completed)

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchTask).toHaveBeenCalledExactlyOnceWith('task-1')
    expect(completed).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchTask).toHaveBeenCalledTimes(2)
    expect(completed).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    await result
    expect(fetchTask).toHaveBeenNthCalledWith(3, 'task-1')
    expect(completed).toHaveBeenCalledExactlyOnceWith({ status: TaskStatus.success })
  })

  it('stops one checker before its first request without stopping another installation', async () => {
    fetchTask.mockResolvedValue(task(TaskStatus.success))
    const stopped = checkTaskStatus()
    const active = checkTaskStatus()
    stopped.stop()

    await expect(stopped.check(params)).resolves.toEqual({ status: TaskStatus.success })
    expect(fetchTask).not.toHaveBeenCalled()
    await expect(active.check({ ...params, taskId: 'task-2' })).resolves.toEqual({
      status: TaskStatus.success,
    })
    expect(fetchTask).toHaveBeenCalledExactlyOnceWith('task-2')
  })

  it('does not fetch again when stopped during the polling interval', async () => {
    fetchTask.mockResolvedValue(task(TaskStatus.running))
    const checker = checkTaskStatus()
    const result = checker.check(params)
    await vi.advanceTimersByTimeAsync(0)
    checker.stop()
    await vi.advanceTimersByTimeAsync(10_000)

    await expect(result).resolves.toEqual({ status: TaskStatus.success })
    expect(fetchTask).toHaveBeenCalledExactlyOnceWith('task-1')
  })
})
