import type { ParserMarketplaceUpgrade } from '@dify/contracts/api/console/workspaces/types.gen'
import type { MutationFilters } from '@tanstack/react-query'
import type { PluginDetail } from '@/app/components/plugins/types'
import {
  queryOptions,
  skipToken,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import checkTaskStatus from '@/app/components/plugins/install-plugin/base/check-task-status'
import { PluginCategoryEnum, TaskStatus } from '@/app/components/plugins/types'
import { consoleClient, consoleQuery } from '@/service/console'
import {
  startMarketplacePluginUpgrade,
  useInvalidateInstalledPluginList,
} from '@/service/use-plugins'
import { getErrorMessage } from '@/utils/error-message'

type UpgradeReceipt = { taskId: string; identifier: string; category: PluginCategoryEnum }
const receipts = queryOptions<Record<string, UpgradeReceipt>>({
  queryKey: ['plugins', 'pending-version-upgrades'],
  queryFn: skipToken,
  initialData: {},
  gcTime: Infinity,
})

async function hasInstallTask(taskId: string, signal: AbortSignal) {
  const pageSize = 100
  for (let page = 1; ; page++) {
    const { tasks } = await consoleClient.workspaces.current.plugin.tasks.get(
      { query: { page, page_size: pageSize } },
      { signal, context: { silent: true } },
    )
    signal.throwIfAborted()
    if (tasks.some((task) => task.id === taskId)) return true
    if (tasks.length < pageSize) return false
  }
}

export function usePluginVersionUpgrade(pluginId: string) {
  const queryClient = useQueryClient()
  const { t } = useTranslation(['common'])
  const invalidateInstalled = useInvalidateInstalledPluginList()
  const refresh = (category: PluginCategoryEnum, refetchType: 'active' | 'none') => {
    void invalidateInstalled(category, refetchType)
    const workspace = consoleQuery.workspaces.current
    void queryClient.invalidateQueries({
      queryKey: workspace.plugin.list.installations.ids.post.key(),
      refetchType,
    })
    if (category === PluginCategoryEnum.agent) {
      void queryClient.invalidateQueries({
        queryKey: workspace.agentProviders.get.key(),
        refetchType,
      })
      void queryClient.invalidateQueries({
        queryKey: workspace.agentProvider.byProviderName.get.key(),
        refetchType,
      })
    }
  }
  const { data: receipt } = useQuery({ ...receipts, select: (jobs) => jobs[pluginId] })
  const key = ['plugins', 'version-upgrade', pluginId] as const
  const options = queryOptions({
    queryKey: key,
    retry: false,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const pending = queryClient.getQueryData(receipts.queryKey)?.[pluginId]
      if (!pending) throw new Error('Missing plugin upgrade task')
      const result = await checkTaskStatus()
        .check({
          taskId: pending.taskId,
          pluginUniqueIdentifier: pending.identifier,
          signal,
        })
        .catch(async (error: unknown) => {
          signal.throwIfAborted()
          // A completed install task may have been cleared while the panel was closed.
          const installed = await queryClient.query(
            consoleQuery.workspaces.current.plugin.list.installations.ids.post.queryOptions({
              input: { body: { plugin_ids: [pluginId] } },
              staleTime: 0,
            }),
          )
          signal.throwIfAborted()
          if (
            installed.plugins.some(
              (plugin) => plugin.plugin_unique_identifier === pending.identifier,
            )
          )
            return { status: TaskStatus.success }
          if (await hasInstallTask(pending.taskId, signal)) throw error
          return { status: TaskStatus.failed, error: getErrorMessage(error) }
        })
      queryClient.setQueryData(receipts.queryKey, (jobs) => {
        const next = { ...jobs }
        delete next[pluginId]
        return next
      })
      if (result.status !== TaskStatus.failed) refresh(pending.category, 'active')
      return result
    },
  })
  const task = useQuery({
    ...options,
    enabled: () => Boolean(queryClient.getQueryData(receipts.queryKey)?.[pluginId]),
  })
  const mutationKey = consoleQuery.workspaces.current.plugin.upgrade.marketplace.post.mutationKey()
  const filter: MutationFilters = {
    mutationKey,
    predicate: ({ state }) => {
      const input = state.variables as { body?: ParserMarketplaceUpgrade } | undefined
      return input?.body?.original_plugin_unique_identifier?.split(':')[0] === pluginId
    },
  }
  const submitting = useIsMutating(filter)
  const upgrade = useMutation({
    mutationKey,
    mutationFn: async ({
      body,
      category,
    }: {
      body: ParserMarketplaceUpgrade
      category: PluginCategoryEnum
    }) => {
      const identifier = body.new_plugin_unique_identifier
      if (!queryClient.getQueryData(receipts.queryKey)?.[pluginId]) {
        const response = await startMarketplacePluginUpgrade(queryClient, body)
        if (response.all_installed || response.task?.status === TaskStatus.success) {
          refresh(category, 'active')
          return
        }
        if (response.task?.status === TaskStatus.failed) {
          const failed = response.task.plugins.find(
            (item) => item.plugin_unique_identifier === identifier,
          )
          throw new Error(failed?.message || t(($) => $.error))
        }
        if (!response.task_id) throw new Error(t(($) => $.error))

        // Retain the accepted job across panel unmounts. The last query observer cancels polling.
        queryClient.setQueryData(receipts.queryKey, (jobs) => ({
          ...jobs,
          [pluginId]: {
            taskId: response.task_id,
            identifier,
            category,
          },
        }))
        refresh(category, 'none')
      }
      if (!queryClient.getQueryCache().find({ queryKey: key, exact: true })?.getObserversCount())
        return
      const result = await queryClient.query(options)
      if (result.status === 'failed') throw new Error(result.error || t(($) => $.error))
    },
  })
  const submit = (plugin: PluginDetail, identifier: string, onSuccess: () => void) => {
    const pending = queryClient.getQueryData(receipts.queryKey)?.[pluginId]
    if ((pending && pending.identifier !== identifier) || queryClient.isMutating(filter)) return
    upgrade.mutate(
      {
        body: {
          original_plugin_unique_identifier: plugin.plugin_unique_identifier,
          new_plugin_unique_identifier: identifier,
        },
        category: plugin.declaration.category,
      },
      { onSuccess },
    )
  }
  return {
    upgrade,
    tracking: submitting > 0 || task.isFetching,
    pendingIdentifier: receipt?.identifier,
    submit,
  }
}
