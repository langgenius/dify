import type { IAppCardProps } from './types'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useDocLink } from '@/context/i18n'
import { AccessMode } from '@/models/access-control'
import { usePathname, useRouter } from '@/next/navigation'
import { useAppWhiteListSubjects } from '@/service/access-control'
import { fetchAppDetailDirect } from '@/service/apps'
import { useAppWorkflow } from '@/service/use-workflow'
import { AppModeEnum } from '@/types/app'
import { asyncRunSafe } from '@/utils'
import { basePath } from '@/utils/var'

type AppCardOperationKey = 'launch' | 'doc' | 'embedded' | 'customize' | 'settings'
export type AppCardModalKey = 'settings' | 'embedded' | 'customize' | null

export type AppCardOperation = {
  key: AppCardOperationKey
  label: string
  iconClassName: string
  disabled: boolean
}

export type AppCardAccessDisplay = {
  iconClassName: string
  label: string
}

type UseAppCardOptions = Pick<
  IAppCardProps,
  'appInfo' | 'cardType' | 'onGenerateCode' | 'triggerModeDisabled'
>

const OPERATION_ICON_MAP: Record<AppCardOperationKey, string> = {
  launch: 'i-ri-external-link-line',
  doc: 'i-ri-book-open-line',
  embedded: 'i-ri-window-line',
  customize: 'i-ri-paint-brush-line',
  settings: 'i-ri-equalizer-2-line',
}

const ACCESS_MODE_ICON_MAP: Record<AccessMode, string> = {
  [AccessMode.ORGANIZATION]: 'i-ri-building-line',
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: 'i-ri-lock-line',
  [AccessMode.PUBLIC]: 'i-ri-global-line',
  [AccessMode.EXTERNAL_MEMBERS]: 'i-ri-verified-badge-line',
}

const ACCESS_MODE_LABEL_KEY_MAP: Partial<Record<AccessMode, string>> = {
  [AccessMode.ORGANIZATION]: 'accessControlDialog.accessItems.organization',
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: 'accessControlDialog.accessItems.specific',
  [AccessMode.PUBLIC]: 'accessControlDialog.accessItems.anyone',
  [AccessMode.EXTERNAL_MEMBERS]: 'accessControlDialog.accessItems.external',
}

export const useAppCard = ({
  appInfo,
  cardType = 'webapp',
  onGenerateCode,
  triggerModeDisabled = false,
}: UseAppCardOptions) => {
  const router = useRouter()
  const pathname = usePathname()
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { isCurrentWorkspaceManager, isCurrentWorkspaceEditor } = useAppContext()
  const { data: currentWorkflow } = useAppWorkflow(appInfo.mode === AppModeEnum.WORKFLOW ? appInfo.id : '')
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(state => state.setAppDetail)
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const { data: appAccessSubjects } = useAppWhiteListSubjects(
    appDetail?.id,
    systemFeatures.webapp_auth.enabled && appDetail?.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS,
  )

  const [activeModal, setActiveModal] = useState<AppCardModalKey>(null)
  const [genLoading, setGenLoading] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showAccessControl, setShowAccessControl] = useState(false)

  const isApp = cardType === 'webapp'
  const isWorkflowApp = appInfo.mode === AppModeEnum.WORKFLOW
  const appUnpublished = isWorkflowApp && !currentWorkflow?.graph
  const hasStartNode = currentWorkflow?.graph?.nodes?.some(node => node.data.type === BlockEnum.Start)
  const missingStartNode = isWorkflowApp && !hasStartNode
  const hasInsufficientPermissions = isApp ? !isCurrentWorkspaceEditor : !isCurrentWorkspaceManager
  const toggleDisabled = hasInsufficientPermissions || appUnpublished || missingStartNode || triggerModeDisabled
  const runningStatus = (appUnpublished || missingStartNode) ? false : (isApp ? appInfo.enable_site : appInfo.enable_api)
  const isMinimalState = appUnpublished || missingStartNode
  const { app_base_url, access_token } = appInfo.site ?? {}
  const appMode = (appInfo.mode !== AppModeEnum.COMPLETION && appInfo.mode !== AppModeEnum.WORKFLOW)
    ? AppModeEnum.CHAT
    : appInfo.mode
  const appUrl = `${app_base_url}${basePath}/${appMode}/${access_token}`
  const apiUrl = appInfo.api_base_url
  const learnMoreUrl = docLink('/use-dify/nodes/user-input')

  const basicName = isApp
    ? t('overview.appInfo.title', { ns: 'appOverview' })
    : t('overview.apiInfo.title', { ns: 'appOverview' })
  const basicDescription = isApp
    ? t('overview.appInfo.explanation', { ns: 'appOverview' })
    : t('overview.apiInfo.explanation', { ns: 'appOverview' })
  const addressLabel = isApp
    ? t('overview.appInfo.accessibleAddress', { ns: 'appOverview' })
    : t('overview.apiInfo.accessibleAddress', { ns: 'appOverview' })

  const isAppAccessSet = useMemo(() => {
    if (!appDetail || !appAccessSubjects)
      return true

    if (appDetail.access_mode !== AccessMode.SPECIFIC_GROUPS_MEMBERS)
      return true

    return appAccessSubjects.groups?.length !== 0 || appAccessSubjects.members?.length !== 0
  }, [appAccessSubjects, appDetail])

  const accessDisplay = useMemo<AppCardAccessDisplay | null>(() => {
    if (!appDetail)
      return null

    const labelKey = ACCESS_MODE_LABEL_KEY_MAP[appDetail.access_mode]

    if (!labelKey)
      return null

    return {
      iconClassName: ACCESS_MODE_ICON_MAP[appDetail.access_mode],
      label: t(labelKey, labelKey, { ns: 'app' }) as string,
    }
  }, [appDetail, t])

  const operations = useMemo<AppCardOperation[]>(() => {
    const items: AppCardOperationKey[] = isApp ? ['launch'] : ['doc']

    if (isApp && appInfo.mode !== AppModeEnum.COMPLETION && appInfo.mode !== AppModeEnum.WORKFLOW)
      items.push('embedded')

    if (isApp)
      items.push('customize')

    if (isApp && isCurrentWorkspaceEditor)
      items.push('settings')

    return items.map((key) => {
      const label = (() => {
        switch (key) {
          case 'launch':
            return t('overview.appInfo.launch', { ns: 'appOverview' })
          case 'embedded':
            return t('overview.appInfo.embedded.entry', { ns: 'appOverview' })
          case 'customize':
            return t('overview.appInfo.customize.entry', { ns: 'appOverview' })
          case 'settings':
            return t('overview.appInfo.settings.entry', { ns: 'appOverview' })
          default:
            return t('overview.apiInfo.doc', { ns: 'appOverview' })
        }
      })()

      return {
        key,
        label,
        iconClassName: OPERATION_ICON_MAP[key],
        disabled: triggerModeDisabled ? true : key === 'settings' ? false : !runningStatus,
      }
    })
  }, [appInfo.mode, isApp, isCurrentWorkspaceEditor, runningStatus, t, triggerModeDisabled])

  const handleOperationSelect = useCallback((key: AppCardOperationKey) => {
    switch (key) {
      case 'launch':
        window.open(appUrl, '_blank')
        return
      case 'customize':
        setActiveModal('customize')
        return
      case 'settings':
        setActiveModal('settings')
        return
      case 'embedded':
        setActiveModal('embedded')
        return
      default: {
        const pathSegments = pathname.split('/')
        pathSegments.pop()
        router.push(`${pathSegments.join('/')}/develop`)
      }
    }
  }, [appUrl, pathname, router])

  const handleGenerateCode = useCallback(async () => {
    if (!onGenerateCode)
      return

    setGenLoading(true)
    await asyncRunSafe(onGenerateCode())
    setGenLoading(false)
    setShowConfirmDelete(false)
  }, [onGenerateCode])

  const handleClickAccessControl = useCallback(() => {
    if (!appDetail)
      return
    setShowAccessControl(true)
  }, [appDetail])

  const handleAccessControlUpdate = useCallback(async () => {
    if (!appDetail)
      return

    try {
      const res = await fetchAppDetailDirect({ url: '/apps', id: appDetail.id })
      setAppDetail(res)
      setShowAccessControl(false)
    }
    catch (error) {
      console.error('Failed to fetch app detail:', error)
    }
  }, [appDetail, setAppDetail])

  return {
    accessDisplay,
    activeModal,
    addressLabel,
    apiUrl,
    appMode,
    appUrl,
    basicDescription,
    basicName,
    genLoading,
    handleAccessControlUpdate,
    handleClickAccessControl,
    handleGenerateCode,
    handleOperationSelect,
    isApp,
    isAppAccessSet,
    isCurrentWorkspaceManager,
    isMinimalState,
    learnMoreUrl,
    missingStartNode,
    operations,
    runningStatus,
    setActiveModal,
    setShowAccessControl,
    setShowConfirmDelete,
    showAccessControl,
    showConfirmDelete,
    toggleDisabled,
    appBaseUrl: app_base_url,
    accessToken: access_token,
    appDetail,
    appInfo,
    appUnpublished,
    cardType,
    hasInsufficientPermissions,
    systemFeatures,
    triggerModeDisabled,
  }
}
