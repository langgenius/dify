import { skipToken } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export function pluginAssetQueryOptions(
  fileName: string | undefined,
  pluginUniqueIdentifier: string | undefined,
) {
  const isAssetFile = fileName?.startsWith('./_assets') || fileName?.startsWith('_assets')

  return consoleQuery.workspaces.current.plugin.asset.get.queryOptions({
    input:
      pluginUniqueIdentifier && fileName && isAssetFile
        ? {
            query: {
              plugin_unique_identifier: pluginUniqueIdentifier,
              file_name: fileName.replace(/^\.\/_assets\//, '').replace(/^_assets\//, ''),
            },
          }
        : skipToken,
  })
}
