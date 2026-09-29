import type { RagPipelineDatasourceProviderResponse } from '@dify/contracts/api/console/rag/types.gen'
import { basePath } from '@/utils/var'

export function resolveDatasourceIcon(
  icon: RagPipelineDatasourceProviderResponse['declaration']['identity']['icon'],
) {
  if (
    basePath &&
    icon.startsWith('/') &&
    !icon.startsWith('//') &&
    icon !== basePath &&
    !icon.startsWith(`${basePath}/`)
  )
    return `${basePath}${icon}`

  return icon
}
