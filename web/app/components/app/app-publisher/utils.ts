import type { TFunction } from 'i18next'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'

export const getPublisherAppMode = (mode?: AppModeEnum) => {
  if (mode !== AppModeEnum.COMPLETION && mode !== AppModeEnum.WORKFLOW) return AppModeEnum.CHAT

  return mode
}

export const getPublisherAppUrl = ({
  appBaseUrl,
  accessToken,
  mode,
}: {
  appBaseUrl: string
  accessToken: string
  mode?: AppModeEnum
}) => `${appBaseUrl}${basePath}/${getPublisherAppMode(mode)}/${accessToken}`

export const getDisabledFunctionTooltip = ({
  t,
  publishedAt,
  missingStartNode,
  noAccessPermission,
}: {
  t: TFunction
  publishedAt?: number
  missingStartNode: boolean
  noAccessPermission: boolean
}) => {
  if (!publishedAt) return t(($) => $.notPublishedYet, { ns: 'app' })
  if (missingStartNode) return t(($) => $.noUserInputNode, { ns: 'app' })
  if (noAccessPermission) return t(($) => $.noAccessPermission, { ns: 'app' })

  return undefined
}
