import type { TFunction } from 'i18next'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'

type AccessSubjectsLike = {
  groups?: unknown[]
  members?: unknown[]
} | null | undefined

type AppDetailLike = {
  access_mode?: AccessMode
  mode?: AppModeEnum
}

type AccessModeLabel = I18nKeysByPrefix<'app', 'accessControlDialog.accessItems.'>

export const ACCESS_MODE_MAP: Record<AccessMode, { label: AccessModeLabel, icon: string }> = {
  [AccessMode.ORGANIZATION]: {
    label: 'organization',
    icon: 'i-ri-building-line',
  },
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: {
    label: 'specific',
    icon: 'i-ri-lock-line',
  },
  [AccessMode.PUBLIC]: {
    label: 'anyone',
    icon: 'i-ri-global-line',
  },
  [AccessMode.EXTERNAL_MEMBERS]: {
    label: 'external',
    icon: 'i-ri-verified-badge-line',
  },
}

export const getPublisherAppMode = (mode?: AppModeEnum) => {
  if (mode !== AppModeEnum.COMPLETION && mode !== AppModeEnum.WORKFLOW)
    return AppModeEnum.CHAT

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

export const isPublisherAccessConfigured = (appDetail: AppDetailLike | null | undefined, appAccessSubjects: AccessSubjectsLike) => {
  if (!appDetail || !appAccessSubjects)
    return true

  if (appDetail.access_mode !== AccessMode.SPECIFIC_GROUPS_MEMBERS)
    return true

  return Boolean(appAccessSubjects.groups?.length || appAccessSubjects.members?.length)
}

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
  if (!publishedAt)
    return t('notPublishedYet', { ns: 'app' })
  if (missingStartNode)
    return t('noUserInputNode', { ns: 'app' })
  if (noAccessPermission)
    return t('noAccessPermission', { ns: 'app' })

  return undefined
}
