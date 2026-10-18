import { skipToken } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export function pluginAssetQueryOptions(
  fileName: string | undefined,
  pluginUniqueIdentifier: string | undefined,
) {
  const isAssetFile = /^(?:\.\/|\/)?_assets\//.test(fileName ?? '')

  return consoleQuery.workspaces.current.plugin.asset.get.queryOptions({
    input:
      pluginUniqueIdentifier && fileName && isAssetFile
        ? {
            query: {
              plugin_unique_identifier: pluginUniqueIdentifier,
              file_name: fileName.replace(/^(?:\.\/|\/)?_assets\//, ''),
            },
          }
        : skipToken,
  })
}
