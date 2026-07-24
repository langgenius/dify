import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskStatus } from '../../../types'
import checkTaskStatus from '../check-task-status'

const mockCheckTaskStatus = vi.fn()
vi.mock('@/service/plugins', () => ({
  checkTaskStatus: (...args: unknown[]) => mockCheckTaskStatus(...args),
}))

// Mock sleep to avoid actual waiting in tests
vi.mock('@/utils', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}))

describe('checkTaskStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns success when plugin status is success', async () => {
    mockCheckTaskStatus.mockResolvedValue({
      task: {
        plugins: [
          { plugin_unique_identifier: 'test-plugin', status: TaskStatus.success, message: '' },
        ],
      },
    })

    const { check } = checkTaskStatus()
    const result = await check({ taskId: 'task-1', pluginUniqueIdentifier: 'test-plugin' })
    expect(result.status).toBe(TaskStatus.success)
  })

  it('returns failed when plugin status is failed', async () => {
    mockCheckTaskStatus.mockResolvedValue({
      task: {
        plugins: [
          { plugin_unique_identifier: 'test-plugin', status: TaskStatus.failed, message: 'Install failed' },
        ],
      },
    })

    const { check } = checkTaskStatus()
    const result = await check({ taskId: 'task-1', pluginUniqueIdentifier: 'test-plugin' })
    expect(result.status).toBe(TaskStatus.failed)
    expect(result.error).toBe('Install failed')
  })

  it('returns failed when plugin is not found in task', async () => {
    mockCheckTaskStatus.mockResolvedValue({
      task: {
        plugins: [
          { plugin_unique_identifier: 'other-plugin', status: TaskStatus.success, message: '' },
        ],
      },
    })

    const { check } = checkTaskStatus()
    const result = await check({ taskId: 'task-1', pluginUniqueIdentifier: 'test-plugin' })
    expect(result.status).toBe(TaskStatus.failed)
    expect(result.error).toBe('Plugin package not found')
  })

  it('polls recursively when status is running, then resolves on success', async () => {
    let callCount = 0
    mockCheckTaskStatus.mockImplementation(() => {
      callCount++
      if (callCount < 3) {
        return Promise.resolve({
          task: {
            plugins: [
              { plugin_unique_identifier: 'test-plugin', status: TaskStatus.running, message: '' },
            ],
          },
        })
      }
      return Promise.resolve({
        task: {
          plugins: [
            { plugin_unique_identifier: 'test-plugin', status: TaskStatus.success, message: '' },
          ],
        },
      })
    })

    const { check } = checkTaskStatus()
    const result = await check({ taskId: 'task-1', pluginUniqueIdentifier: 'test-plugin' })
    expect(result.status).toBe(TaskStatus.success)
    expect(mockCheckTaskStatus).toHaveBeenCalledTimes(3)
  })

  it('stop() causes early return with success', async () => {
    const { check, stop } = checkTaskStatus()
    stop()
    const result = await check({ taskId: 'task-1', pluginUniqueIdentifier: 'test-plugin' })
    expect(result.status).toBe(TaskStatus.success)
    expect(mockCheckTaskStatus).not.toHaveBeenCalled()
  })

  it('returns different instances with independent state', async () => {
    const checker1 = checkTaskStatus()
    const checker2 = checkTaskStatus()

    checker1.stop()

    mockCheckTaskStatus.mockResolvedValue({
      task: {
        plugins: [
          { plugin_unique_identifier: 'test-plugin', status: TaskStatus.success, message: '' },
        ],
      },
    })

    const result1 = await checker1.check({ taskId: 'task-1', pluginUniqueIdentifier: 'test-plugin' })
    const result2 = await checker2.check({ taskId: 'task-2', pluginUniqueIdentifier: 'test-plugin' })

    expect(result1.status).toBe(TaskStatus.success)
    expect(result2.status).toBe(TaskStatus.success)
    expect(mockCheckTaskStatus).toHaveBeenCalledTimes(1)
  })
})
