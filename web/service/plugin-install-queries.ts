import type {
  PluginInstallTask,
  PluginTasksResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { PluginTask } from '@/app/components/plugins/types'
import { TaskStatus } from '@/app/components/plugins/types'
import { consoleQuery } from '@/service/console'
import { pluginTaskListInput } from '@/service/console/plugin-task-cache'

type PluginTaskList = {
  tasks: PluginTask[]
}

const isUnfinishedPluginTask = (task: { status: string }) =>
  task.status === TaskStatus.pending || task.status === TaskStatus.running

// Each plugin status records its task so a single status can be cleared.
const normalizePluginTask = (task: PluginInstallTask): PluginTask => ({
  ...task,
  plugins: task.plugins.map((plugin) => ({
    ...plugin,
    taskId: task.id,
  })),
})

// Module scope keeps the projection stable so the selected data is only rebuilt when the cache changes.
const selectPluginTaskList = ({ tasks }: PluginTasksResponse): PluginTaskList => ({
  tasks: tasks.map(normalizePluginTask),
})

// A refetch that starts right after an install can miss the task the start response added.
const preserveLocalUnfinishedPluginTasks = <
  T extends { tasks: Array<{ id: string; status: string }> },
>(
  previousData: T | undefined,
  nextData: T,
): T => {
  if (!previousData) return nextData

  const nextTaskIds = new Set(nextData.tasks.map((task) => task.id))
  const missingUnfinishedTasks = previousData.tasks.filter(
    (task) => !nextTaskIds.has(task.id) && isUnfinishedPluginTask(task),
  )
  if (!missingUnfinishedTasks.length) return nextData

  return {
    ...nextData,
    tasks: [...missingUnfinishedTasks, ...nextData.tasks],
  }
}

export function pluginTaskListQueryOptions({ enabled }: { enabled: boolean }) {
  return consoleQuery.workspaces.current.plugin.tasks.get.queryOptions({
    input: pluginTaskListInput,
    enabled,
    select: selectPluginTaskList,
    structuralSharing: (previousData, nextData) =>
      preserveLocalUnfinishedPluginTasks(
        previousData as PluginTasksResponse | undefined,
        nextData as PluginTasksResponse,
      ),
    refetchInterval: (query) => {
      const taskDone = query.state.data?.tasks.every(
        (task) => task.status === TaskStatus.success || task.status === TaskStatus.failed,
      )
      return taskDone ? false : 5000
    },
  })
}
