'use client'

import type { Plugin } from '@/app/components/plugins/types'
import { useCallback } from 'react'
import checkTaskStatus from '@/app/components/plugins/install-plugin/base/check-task-status'
import useRefreshPluginList from '@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list'
import { TaskStatus } from '@/app/components/plugins/types'
import { useInstallPackageFromMarketPlace } from '@/service/use-plugins'

export type SilentMarketplaceInstallResult =
  | { status: 'failed'; error?: string }
  | { status: 'success' }

const inFlightInstalls = new Map<string, Promise<SilentMarketplaceInstallResult>>()

const toErrorMessage = (error: unknown) => {
  if (typeof error === 'string' && error) return error
  if (error instanceof Error && error.message) return error.message
  return undefined
}

export const useSilentMarketplaceInstall = () => {
  const { mutateAsync: installPackageFromMarketPlace } = useInstallPackageFromMarketPlace()
  const { refreshPluginList } = useRefreshPluginList()

  const install = useCallback(
    (plugin: Plugin) => {
      const uniqueIdentifier = plugin.latest_package_identifier
      const inFlight = inFlightInstalls.get(uniqueIdentifier)
      if (inFlight) return inFlight

      const pending = (async (): Promise<SilentMarketplaceInstallResult> => {
        try {
          const response = await installPackageFromMarketPlace(uniqueIdentifier)
          if (response.all_installed) {
            refreshPluginList(plugin)
            return { status: 'success' }
          }
          if (!response.task_id) return { status: 'failed' }

          const { check } = checkTaskStatus()
          const { status, error } = await check({
            taskId: response.task_id,
            pluginUniqueIdentifier: uniqueIdentifier,
          })
          if (status === TaskStatus.failed) return { status: 'failed', error }

          refreshPluginList(plugin)
          return { status: 'success' }
        } catch (error) {
          return { status: 'failed', error: toErrorMessage(error) }
        }
      })().finally(() => {
        inFlightInstalls.delete(uniqueIdentifier)
      })

      inFlightInstalls.set(uniqueIdentifier, pending)
      return pending
    },
    [installPackageFromMarketPlace, refreshPluginList],
  )

  return { install }
}
