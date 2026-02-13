import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskStatus } from '@/app/components/plugins/types'
import { usePluginTaskStatus } from '../hooks'

const mockClearTask = vi.fn().mockResolvedValue({})
const mockRefetch = vi.fn()

vi.mock('@/service/use-plugins', () => ({
  usePluginTaskList: () => ({
    pluginTasks: [
      {
        id: 'task-1',
        plugins: [
          { id: 'plugin-1', status: TaskStatus.success, taskId: 'task-1' },
          { id: 'plugin-2', status: TaskStatus.running, taskId: 'task-1' },
        ],
      },
      {
        id: 'task-2',
        plugins: [
          { id: 'plugin-3', status: TaskStatus.failed, taskId: 'task-2' },
        ],
      },
    ],
    handleRefetch: mockRefetch,
  }),
  useMutationClearTaskPlugin: () => ({
    mutateAsync: mockClearTask,
  }),
}))

describe('usePluginTaskStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should categorize plugins by status', () => {
    const { result } = renderHook(() => usePluginTaskStatus())

    expect(result.current.successPlugins).toHaveLength(1)
    expect(result.current.runningPlugins).toHaveLength(1)
    expect(result.current.errorPlugins).toHaveLength(1)
  })

  it('should compute correct length values', () => {
    const { result } = renderHook(() => usePluginTaskStatus())

    expect(result.current.totalPluginsLength).toBe(3)
    expect(result.current.runningPluginsLength).toBe(1)
    expect(result.current.errorPluginsLength).toBe(1)
    expect(result.current.successPluginsLength).toBe(1)
  })

  it('should detect isInstallingWithError state', () => {
    const { result } = renderHook(() => usePluginTaskStatus())

    // running > 0 && error > 0
    expect(result.current.isInstallingWithError).toBe(true)
    expect(result.current.isInstalling).toBe(false)
    expect(result.current.isInstallingWithSuccess).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isFailed).toBe(false)
  })

  it('should handle clear error plugin', async () => {
    const { result } = renderHook(() => usePluginTaskStatus())

    await result.current.handleClearErrorPlugin('task-2', 'plugin-3')

    expect(mockClearTask).toHaveBeenCalledWith({
      taskId: 'task-2',
      pluginId: 'plugin-3',
    })
    expect(mockRefetch).toHaveBeenCalled()
  })
})
