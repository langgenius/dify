import type { VersionInfo } from '../../types'

import { useMemo } from 'react'
import { useCheckInstalled as useDoCheckInstalled } from '@/service/use-plugins'

type Props = {
  pluginIds: string[]
  enabled: boolean
}
const useCheckInstalled = (props: Props) => {
  const { data, isLoading, error } = useDoCheckInstalled(props)

  const installedInfo = useMemo(() => {
    if (!data)
      return undefined

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
