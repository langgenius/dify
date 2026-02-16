'use client'
import type { ConfigParams } from './settings'
import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import {
  RiArrowRightSLine,
  RiBookOpenLine,
  RiBuildingLine,
  RiEqualizer2Line,
  RiExternalLinkLine,
  RiGlobalLine,
  RiLockLine,
  RiPaintBrushLine,
  RiVerifiedBadgeLine,
  RiWindowLine,
} from '@remixicon/react'
import { usePathname, useRouter } from 'next/navigation'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppBasic from '@/app/components/app-sidebar/basic'
import { useStore as useAppStore } from '@/app/components/app/store'
import Button from '@/app/components/base/button'
import Confirm from '@/app/components/base/confirm'
import CopyFeedback from '@/app/components/base/copy-feedback'
import Divider from '@/app/components/base/divider'
import ShareQRCode from '@/app/components/base/qrcode'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import SecretKeyButton from '@/app/components/develop/secret-key/secret-key-button'
import Indicator from '@/app/components/header/indicator'
import { BlockEnum } from '@/app/components/workflow/types'
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useDocLink } from '@/context/i18n'
import { AccessMode } from '@/models/access-control'
import { useAppWhiteListSubjects } from '@/service/access-control'
import { fetchAppDetailDirect } from '@/service/apps'
import { useAppWorkflow } from '@/service/use-workflow'
import { AppModeEnum } from '@/types/app'
import { asyncRunSafe } from '@/utils'
import { basePath } from '@/utils/var'
import AccessControl from '../app-access-control'
import CustomizeModal from './customize'
import EmbeddedModal from './embedded'
import SettingsModal from './settings'
import style from './style.module.css'

export type IAppCardProps = {
  className?: string
  appInfo: AppDetailResponse & Partial<AppSSO>
  isInPanel?: boolean
  cardType?: 'api' | 'webapp'
  customBgColor?: string
  triggerModeDisabled?: boolean // true when Trigger Node mode needs UI locked to avoid conflicting actions
  triggerModeMessage?: React.ReactNode // contextual copy explaining why the card is disabled in trigger mode
  onChangeStatus: (val: boolean) => Promise<void>
  onSaveSiteConfig?: (params: ConfigParams) => Promise<void>
  onGenerateCode?: () => Promise<void>
}

function AppCard({
  appInfo,
  isInPanel,
  cardType = 'webapp',
  customBgColor,
  triggerModeDisabled = false,
  triggerModeMessage = '',
  onChangeStatus,
  onSaveSiteConfig,
  onGenerateCode,
  className,
}: IAppCardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { isCurrentWorkspaceManager, isCurrentWorkspaceEditor } = useAppContext()
  const { data: currentWorkflow } = useAppWorkflow(appInfo.mode === AppModeEnum.WORKFLOW ? appInfo.id : '')
  const docLink = useDocLink()
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(state => state.setAppDetail)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [showEmbedded, setShowEmbedded] = useState(false)
  const [showCustomizeModal, setShowCustomizeModal] = useState(false)
  const [genLoading, setGenLoading] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showAccessControl, setShowAccessControl] = useState<boolean>(false)
  const { t } = useTranslation()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const { data: appAccessSubjects } = useAppWhiteListSubjects(appDetail?.id, systemFeatures.webapp_auth.enabled && appDetail?.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS)

  const OPERATIONS_MAP = useMemo(() => {
    const operationsMap = {
      webapp: [
        { opName: t('overview.appInfo.launch', { ns: 'appOverview' }), opIcon: RiExternalLinkLine },
      ] as { opName: string, opIcon: any }[],
      api: [{ opName: t('overview.apiInfo.doc', { ns: 'appOverview' }), opIcon: RiBookOpenLine }],
      app: [],
    }
    if (appInfo.mode !== AppModeEnum.COMPLETION && appInfo.mode !== AppModeEnum.WORKFLOW)
      operationsMap.webapp.push({ opName: t('overview.appInfo.embedded.entry', { ns: 'appOverview' }), opIcon: RiWindowLine })

    operationsMap.webapp.push({ opName: t('overview.appInfo.customize.entry', { ns: 'appOverview' }), opIcon: RiPaintBrushLine })

    if (isCurrentWorkspaceEditor)
      operationsMap.webapp.push({ opName: t('overview.appInfo.settings.entry', { ns: 'appOverview' }), opIcon: RiEqualizer2Line })

    return operationsMap
  }, [isCurrentWorkspaceEditor, appInfo, t])

  const isApp = cardType === 'webapp'
  const basicName = isApp
    ? t('overview.appInfo.title', { ns: 'appOverview' })
    : t('overview.apiInfo.title', { ns: 'appOverview' })
  const isWorkflowApp = appInfo.mode === AppModeEnum.WORKFLOW
  const appUnpublished = isWorkflowApp && !currentWorkflow?.graph
  const hasStartNode = currentWorkflow?.graph?.nodes?.some(node => node.data.type === BlockEnum.Start)
  const missingStartNode = isWorkflowApp && !hasStartNode
  const hasInsufficientPermissions = isApp ? !isCurrentWorkspaceEditor : !isCurrentWorkspaceManager
  const toggleDisabled = hasInsufficientPermissions || appUnpublished || missingStartNode || triggerModeDisabled
  const runningStatus = (appUnpublished || missingStartNode) ? false : (isApp ? appInfo.enable_site : appInfo.enable_api)
  const isMinimalState = appUnpublished || missingStartNode
  const { app_base_url, access_token } = appInfo.site ?? {}
  const appMode = (appInfo.mode !== AppModeEnum.COMPLETION && appInfo.mode !== AppModeEnum.WORKFLOW) ? AppModeEnum.CHAT : appInfo.mode
  const appUrl = `${app_base_url}${basePath}/${appMode}/${access_token}`
  const apiUrl = appInfo?.api_base_url

  const genClickFuncByName = (opName: string) => {
    switch (opName) {
      case t('overview.appInfo.launch', { ns: 'appOverview' }):
        return () => {
          window.open(appUrl, '_blank')
        }
      case t('overview.appInfo.customize.entry', { ns: 'appOverview' }):
        return () => {
          setShowCustomizeModal(true)
        }
      case t('overview.appInfo.settings.entry', { ns: 'appOverview' }):
        return () => {
          setShowSettingsModal(true)
        }
      case t('overview.appInfo.embedded.entry', { ns: 'appOverview' }):
        return () => {
          setShowEmbedded(true)
        }
      default:
        // jump to page develop
        return () => {
          const pathSegments = pathname.split('/')
          pathSegments.pop()
          router.push(`${pathSegments.join('/')}/develop`)
        }
    }
  }

  const onGenCode = async () => {
    if (onGenerateCode) {
      setGenLoading(true)
      await asyncRunSafe(onGenerateCode())
      setGenLoading(false)
    }
  }

  const [isAppAccessSet, setIsAppAccessSet] = useState(true)
  useEffect(() => {
    if (appDetail && appAccessSubjects) {
      if (appDetail.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS && appAccessSubjects.groups?.length === 0 && appAccessSubjects.members?.length === 0)
        setIsAppAccessSet(false)
      else
        setIsAppAccessSet(true)
    }
    else {
      setIsAppAccessSet(true)
    }
  }, [appAccessSubjects, appDetail])

  const handleClickAccessControl = useCallback(() => {
    if (!appDetail)
      return
    setShowAccessControl(true)
  }, [appDetail])
  const handleAccessControlUpdate = useCallback(async () => {
    try {
      const res = await fetchAppDetailDirect({ url: '/apps', id: appDetail!.id })
      setAppDetail(res)
      setShowAccessControl(false)
    }
    catch (error) {
      console.error('Failed to fetch app detail:', error)
    }
  }, [appDetail, setAppDetail])

  return (
    <div
      className={
        `${isInPanel ? 'border-l-[0.5px] border-t' : 'border-[0.5px] shadow-xs'} w-full max-w-full rounded-xl border-effects-highlight ${className ?? ''} ${isMinimalState ? 'h-12' : ''}`
      }
    >
      <div className={`${customBgColor ?? 'bg-background-default'} relative rounded-xl ${triggerModeDisabled ? 'opacity-60' : ''}`}>
        {triggerModeDisabled && (
          triggerModeMessage
            ? (
                <Tooltip
                  popupContent={triggerModeMessage}
                  popupClassName="max-w-64 rounded-xl bg-components-panel-bg px-3 py-2 text-xs text-text-secondary shadow-lg"
                  position="right"
                >
                  <div className="absolute inset-0 z-10 cursor-not-allowed rounded-xl" aria-hidden="true"></div>
                </Tooltip>
              )
            : <div className="absolute inset-0 z-10 cursor-not-allowed rounded-xl" aria-hidden="true"></div>
        )}
        <div className={`flex w-full flex-col items-start justify-center gap-3 self-stretch p-3 ${isMinimalState ? 'border-0' : 'border-b-[0.5px] border-divider-subtle'}`}>
          <div className="flex w-full items-center gap-3 self-stretch">
            <AppBasic
              iconType={cardType}
              icon={appInfo.icon}
              icon_background={appInfo.icon_background}
              name={basicName}
              hideType
              type={
                isApp
                  ? t('overview.appInfo.explanation', { ns: 'appOverview' })
                  : t('overview.apiInfo.explanation', { ns: 'appOverview' })
              }
            />
            <div className="flex shrink-0 items-center gap-1">
              <Indicator color={runningStatus ? 'green' : 'yellow'} />
              <div className={`${runningStatus ? 'text-text-success' : 'text-text-warning'} system-xs-semibold-uppercase`}>
                {runningStatus
                  ? t('overview.status.running', { ns: 'appOverview' })
                  : t('overview.status.disable', { ns: 'appOverview' })}
              </div>
            </div>
            <Tooltip
              popupContent={
                toggleDisabled
                  ? (
                      triggerModeDisabled && triggerModeMessage
                        ? triggerModeMessage
                        : (appUnpublished || missingStartNode)
                            ? (
                                <>
                                  <div className="mb-1 text-xs font-normal text-text-secondary">
                                    {t('overview.appInfo.enableTooltip.description', { ns: 'appOverview' })}
                                  </div>
                                  <div
                                    className="cursor-pointer text-xs font-normal text-text-accent hover:underline"
                                    onClick={() => window.open(docLink('/use-dify/nodes/user-input'), '_blank')}
                                  >
                                    {t('overview.appInfo.enableTooltip.learnMore', { ns: 'appOverview' })}
                                  </div>
                                </>
                              )
                            : ''
                    )
                  : ''
              }
              position="right"
              popupClassName="w-58 max-w-60 rounded-xl bg-components-panel-bg px-3.5 py-3 shadow-lg"
              offset={24}
            >
              <div>
                <Switch defaultValue={runningStatus} onChange={onChangeStatus} disabled={toggleDisabled} />
              </div>
            </Tooltip>
          </div>
          {!isMinimalState && (
            <div className="flex flex-col items-start justify-center self-stretch">
              <div className="system-xs-medium pb-1 text-text-tertiary">
                {isApp
                  ? t('overview.appInfo.accessibleAddress', { ns: 'appOverview' })
                  : t('overview.apiInfo.accessibleAddress', { ns: 'appOverview' })}
              </div>
              <div className="inline-flex h-9 w-full items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1 pl-2">
                <div className="flex h-4 min-w-0 flex-1 items-start justify-start gap-2 px-1">
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium text-text-secondary">
                    {isApp ? appUrl : apiUrl}
                  </div>
                </div>
                <CopyFeedback
                  content={isApp ? appUrl : apiUrl}
                  className="!size-6"
                />
                {isApp && <ShareQRCode content={isApp ? appUrl : apiUrl} />}
                {isApp && <Divider type="vertical" className="!mx-0.5 !h-3.5 shrink-0" />}
                {/* button copy link/ button regenerate */}
                {showConfirmDelete && (
                  <Confirm
                    type="warning"
                    title={t('overview.appInfo.regenerate', { ns: 'appOverview' })}
                    content={t('overview.appInfo.regenerateNotice', { ns: 'appOverview' })}
                    isShow={showConfirmDelete}
                    onConfirm={() => {
                      onGenCode()
                      setShowConfirmDelete(false)
                    }}
                    onCancel={() => setShowConfirmDelete(false)}
                  />
                )}
                {isApp && isCurrentWorkspaceManager && (
                  <Tooltip
                    popupContent={t('overview.appInfo.regenerate', { ns: 'appOverview' }) || ''}
                  >
                    <div
                      className="h-6 w-6 cursor-pointer rounded-md hover:bg-state-base-hover"
                      onClick={() => setShowConfirmDelete(true)}
                    >
                      <div
                        className={
                          `h-full w-full ${style.refreshIcon} ${genLoading ? style.generateLogo : ''}`
                        }
                      >
                      </div>
                    </div>
                  </Tooltip>
                )}
              </div>
            </div>
          )}
          {!isMinimalState && isApp && systemFeatures.webapp_auth.enabled && appDetail && (
            <div className="flex flex-col items-start justify-center self-stretch">
              <div className="system-xs-medium pb-1 text-text-tertiary">{t('publishApp.title', { ns: 'app' })}</div>
              <div
                className="flex h-9 w-full cursor-pointer items-center gap-x-0.5  rounded-lg bg-components-input-bg-normal py-1 pl-2.5 pr-2"
                onClick={handleClickAccessControl}
              >
                <div className="flex grow items-center gap-x-1.5 pr-1">
                  {appDetail?.access_mode === AccessMode.ORGANIZATION
                    && (
                      <>
                        <RiBuildingLine className="h-4 w-4 shrink-0 text-text-secondary" />
                        <p className="system-sm-medium text-text-secondary">{t('accessControlDialog.accessItems.organization', { ns: 'app' })}</p>
                      </>
                    )}
                  {appDetail?.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS
                    && (
                      <>
                        <RiLockLine className="h-4 w-4 shrink-0 text-text-secondary" />
                        <p className="system-sm-medium text-text-secondary">{t('accessControlDialog.accessItems.specific', { ns: 'app' })}</p>
                      </>
                    )}
                  {appDetail?.access_mode === AccessMode.PUBLIC
                    && (
                      <>
                        <RiGlobalLine className="h-4 w-4 shrink-0 text-text-secondary" />
                        <p className="system-sm-medium text-text-secondary">{t('accessControlDialog.accessItems.anyone', { ns: 'app' })}</p>
                      </>
                    )}
                  {appDetail?.access_mode === AccessMode.EXTERNAL_MEMBERS
                    && (
                      <>
                        <RiVerifiedBadgeLine className="h-4 w-4 shrink-0 text-text-secondary" />
                        <p className="system-sm-medium text-text-secondary">{t('accessControlDialog.accessItems.external', { ns: 'app' })}</p>
                      </>
                    )}
                </div>
                {!isAppAccessSet && <p className="system-xs-regular shrink-0 text-text-tertiary">{t('publishApp.notSet', { ns: 'app' })}</p>}
                <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                  <RiArrowRightSLine className="h-4 w-4 text-text-quaternary" />
                </div>
              </div>
            </div>
          )}
        </div>
        {!isMinimalState && (
          <div className="flex items-center gap-1 self-stretch p-3">
            {!isApp && <SecretKeyButton appId={appInfo.id} />}
            {OPERATIONS_MAP[cardType].map((op) => {
              const disabled
                = triggerModeDisabled
                  ? true
                  : op.opName === t('overview.appInfo.settings.entry', { ns: 'appOverview' })
                    ? false
                    : !runningStatus
              return (
                <Button
                  className="mr-1 min-w-[88px]"
                  size="small"
                  variant="ghost"
                  key={op.opName}
                  onClick={genClickFuncByName(op.opName)}
                  disabled={disabled}
                >
                  <Tooltip
                    popupContent={
                      t('overview.appInfo.preUseReminder', { ns: 'appOverview' }) ?? ''
                    }
                    popupClassName={disabled ? 'mt-[-8px]' : '!hidden'}
                  >
                    <div className="flex items-center justify-center gap-[1px]">
                      <op.opIcon className="h-3.5 w-3.5" />
                      <div className={`${(runningStatus || !disabled) ? 'text-text-tertiary' : 'text-components-button-ghost-text-disabled'} system-xs-medium px-[3px]`}>{op.opName}</div>
                    </div>
                  </Tooltip>
                </Button>
              )
            })}
          </div>
        )}
      </div>
      {isApp
        ? (
            <>
              <SettingsModal
                isChat={appMode === AppModeEnum.CHAT}
                appInfo={appInfo}
                isShow={showSettingsModal}
                onClose={() => setShowSettingsModal(false)}
                onSave={onSaveSiteConfig}
              />
              <EmbeddedModal
                siteInfo={appInfo.site}
                isShow={showEmbedded}
                onClose={() => setShowEmbedded(false)}
                appBaseUrl={app_base_url}
                accessToken={access_token}
              />
              <CustomizeModal
                isShow={showCustomizeModal}
                onClose={() => setShowCustomizeModal(false)}
                appId={appInfo.id}
                api_base_url={appInfo.api_base_url}
                mode={appInfo.mode}
              />
              {
                showAccessControl && (
                  <AccessControl
                    app={appDetail!}
                    onConfirm={handleAccessControlUpdate}
                    onClose={() => { setShowAccessControl(false) }}
                  />
                )
              }
            </>
          )
        : null}
    </div>
  )
}

export default AppCard
