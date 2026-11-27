import type { VersionInfo } from '../../types'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { installedPluginsByIdsQueryOptions } from '@/service/plugin-list-queries'

type Props = Readonly<{
  pluginIds: string[]
  enabled: boolean
}>
const useCheckInstalled = (props: Props) => {
  const { data, isLoading, error } = useQuery(installedPluginsByIdsQueryOptions(props))

  const installedInfo = useMemo(() => {
    if (!data) return undefined

    const res: Record<string, VersionInfo> = {}
    data?.plugins.forEach((plugin) => {
      res[plugin.plugin_id] = {
        installedId: plugin.id,
        installedVersion: plugin.declaration.version,
        uniqueIdentifier: plugin.plugin_unique_identifier,
      }
    })
    return res
  }, [data])
  return {
    installedInfo,
    isLoading,
    error,
  }
}

export default useCheckInstalled
