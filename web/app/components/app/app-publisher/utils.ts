import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import type { TFunction } from 'i18next'
import { basePath } from '@/utils/var'

export const getPublisherAppMode = (mode?: AppMode) => {
  if (mode !== 'completion' && mode !== 'workflow') return 'chat'

  return mode
}

export const getPublisherAppUrl = ({
  appBaseUrl,
  accessToken,
  mode,
}: {
  appBaseUrl: string
  accessToken: string
  mode?: AppMode
}) => `${appBaseUrl}${basePath}/${getPublisherAppMode(mode)}/${accessToken}`

export const getDisabledFunctionTooltip = ({
  t,
  publishedAt,
  missingStartNode,
  noAccessPermission,
}: {
  t: TFunction<['app']>
  publishedAt?: number
  missingStartNode: boolean
  noAccessPermission: boolean
}) => {
  if (!publishedAt) return t(($) => $.notPublishedYet, { ns: 'app' })
  if (missingStartNode) return t(($) => $.noUserInputNode, { ns: 'app' })
  if (noAccessPermission) return t(($) => $.noAccessPermission, { ns: 'app' })

  return undefined
}
