import type {
  PluginInstallTaskStartResponse,
  PluginTasksResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { RouterUtils } from '@orpc/tanstack-query'
import type { QueryClient } from '@tanstack/react-query'
import type { ConsoleClient } from './index'

// The installation task list always reads the first page of recent tasks.
export const pluginTaskListInput = { query: { page: 1, page_size: 100 } }

// Show a started task right away instead of waiting for the next task list poll.
export function upsertStartedPluginTask(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  response: PluginInstallTaskStartResponse,
) {
  const startedTask = response.task
  if (!startedTask) return

  client.setQueryData(
    query.workspaces.current.plugin.tasks.get.queryKey({ input: pluginTaskListInput }),
    (previous: PluginTasksResponse | undefined) => {
      if (!previous) return { tasks: [startedTask] }

      const existingTaskIndex = previous.tasks.findIndex((task) => task.id === startedTask.id)
      if (existingTaskIndex === -1) return { tasks: [startedTask, ...previous.tasks] }

      return {
        tasks: previous.tasks.map((task) => (task.id === startedTask.id ? startedTask : task)),
      }
    },
  )
}
