'use client'
import type { WorkflowLaunchInputValue } from './app-card-utils'
import type { ConfigParams } from './settings'
import type { AppDetailResponse } from '@/models/app'
import type { AppSSO } from '@/types/app'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Switch } from '@langgenius/dify-ui/switch'
import { useSuspenseQuery } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppBasic from '@/app/components/app-sidebar/basic'
import { useStore as useAppStore } from '@/app/components/app/store'
import SecretKeyButton from '@/app/components/develop/secret-key/secret-key-button'
import Indicator from '@/app/components/header/indicator'
import { useAppContext } from '@/context/app-context'
import { useDocLink } from '@/context/i18n'
import { AccessMode } from '@/models/access-control'
import { usePathname, useRouter } from '@/next/navigation'
import { useAppWhiteListSubjects } from '@/service/access-control'
import { fetchAppDetailDirect } from '@/service/apps'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useAppWorkflow } from '@/service/use-workflow'
import { AppModeEnum } from '@/types/app'
import { asyncRunSafe } from '@/utils'
import {
  AppCardAccessControlSection,
  AppCardDialogs,
  AppCardOperations,
  AppCardUrlSection,
  createAppCardOperations,
  WorkflowLaunchDialog,
} from './app-card-sections'
import {
  buildWorkflowLaunchUrl,
  createWorkflowLaunchInitialValues,
  getAppCardDisplayState,
  getAppCardOperationKeys,
  getAppHiddenLaunchVariables,
  isAppAccessConfigured,
  isWorkflowLaunchInputSupported,
} from './app-card-utils'

export type IAppCardProps = {
  className?: string
  appInfo: AppDetailResponse & Partial<AppSSO>
  isInPanel?: boolean
  cardType?: 'api' | 'webapp'
  customBgColor?: string
  triggerModeDisabled?: boolean
  triggerModeMessage?: React.ReactNode
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
  const shouldFetchWorkflow = appInfo.mode === AppModeEnum.WORKFLOW || appInfo.mode === AppModeEnum.ADVANCED_CHAT
  const { data: currentWorkflow } = useAppWorkflow(shouldFetchWorkflow ? appInfo.id : '')
  const docLink = useDocLink()
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(state => state.setAppDetail)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [showEmbedded, setShowEmbedded] = useState(false)
  const [showCustomizeModal, setShowCustomizeModal] = useState(false)
  const [genLoading, setGenLoading] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showAccessControl, setShowAccessControl] = useState(false)
  const [showWorkflowLaunchDialog, setShowWorkflowLaunchDialog] = useState(false)
  const [workflowLaunchValues, setWorkflowLaunchValues] = useState<Record<string, WorkflowLaunchInputValue>>({})
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: appAccessSubjects } = useAppWhiteListSubjects(
    appDetail?.id,
    systemFeatures.webapp_auth.enabled && appDetail?.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS,
  )

  const cardState = getAppCardDisplayState({
    appInfo,
    cardType,
    currentWorkflow,
    isCurrentWorkspaceEditor,
    isCurrentWorkspaceManager,
    triggerModeDisabled,
  })

  const isApp = cardState.isApp
  const basicName = isApp
    ? t('overview.appInfo.title', { ns: 'appOverview' })
    : t('overview.apiInfo.title', { ns: 'appOverview' })

  const isAppAccessSet = useMemo(
    () => isAppAccessConfigured(appDetail, appAccessSubjects),
    [appAccessSubjects, appDetail],
  )
  const hiddenLaunchVariables = useMemo(
    () => getAppHiddenLaunchVariables({
      appInfo,
      currentWorkflow,
    }) || [],
    [appInfo, currentWorkflow],
  )
  const supportedWorkflowLaunchVariables = useMemo(
    () => hiddenLaunchVariables.filter(isWorkflowLaunchInputSupported),
    [hiddenLaunchVariables],
  )
  const unsupportedWorkflowLaunchVariables = useMemo(
    () => hiddenLaunchVariables.filter(variable => !isWorkflowLaunchInputSupported(variable)),
    [hiddenLaunchVariables],
  )
  const initialWorkflowLaunchValues = useMemo(
    () => createWorkflowLaunchInitialValues(supportedWorkflowLaunchVariables),
    [supportedWorkflowLaunchVariables],
  )

  const onGenCode = async () => {
    if (!onGenerateCode)
      return

    setGenLoading(true)
    await asyncRunSafe(onGenerateCode())
    setGenLoading(false)
  }

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

  const operationKeys = useMemo(() => getAppCardOperationKeys({
    cardType,
    appMode: cardState.appMode,
    isCurrentWorkspaceEditor,
  }), [cardState.appMode, cardType, isCurrentWorkspaceEditor])

  const handleLaunch = useCallback(() => {
    window.open(cardState.accessibleUrl, '_blank')
  }, [cardState.accessibleUrl])

  const handleOpenWorkflowLaunchDialog = useCallback(() => {
    setWorkflowLaunchValues(initialWorkflowLaunchValues)
    setShowWorkflowLaunchDialog(true)
  }, [initialWorkflowLaunchValues])

  const handleWorkflowLaunchValueChange = useCallback((variable: string, value: WorkflowLaunchInputValue) => {
    setWorkflowLaunchValues(prev => ({
      ...prev,
      [variable]: value,
    }))
  }, [])

  const handleWorkflowLaunchConfirm = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const targetUrl = await buildWorkflowLaunchUrl({
      accessibleUrl: cardState.accessibleUrl,
      variables: supportedWorkflowLaunchVariables,
      values: workflowLaunchValues,
    })

    window.open(targetUrl, '_blank')
    setShowWorkflowLaunchDialog(false)
  }, [cardState.accessibleUrl, supportedWorkflowLaunchVariables, workflowLaunchValues])

  const handleOpenCustomize = useCallback(() => {
    setShowCustomizeModal(true)
  }, [])

  const handleOpenSettings = useCallback(() => {
    setShowSettingsModal(true)
  }, [])

  const handleOpenEmbedded = useCallback(() => {
    setShowEmbedded(true)
  }, [])

  const handleOpenDevelop = useCallback(() => {
    const pathSegments = pathname.split('/')
    pathSegments.pop()
    router.push(`${pathSegments.join('/')}/develop`)
  }, [pathname, router])

  const operations = useMemo(() => createAppCardOperations({
    operationKeys,
    t,
    runningStatus: cardState.runningStatus,
    triggerModeDisabled,
    onLaunch: handleLaunch,
    onEmbedded: handleOpenEmbedded,
    onCustomize: handleOpenCustomize,
    onSettings: handleOpenSettings,
    onDevelop: handleOpenDevelop,
  }), [
    cardState.runningStatus,
    handleLaunch,
    handleOpenCustomize,
    handleOpenDevelop,
    handleOpenEmbedded,
    handleOpenSettings,
    operationKeys,
    t,
    triggerModeDisabled,
  ])

  const missingStartNodeContent = cardState.appUnpublished || cardState.missingStartNode
    ? (
        <>
          <div className="mb-1 text-xs font-normal text-text-secondary">
            {t('overview.appInfo.enableTooltip.description', { ns: 'appOverview' })}
          </div>
          <button
            type="button"
            className="cursor-pointer rounded-sm text-xs font-normal text-text-accent outline-hidden hover:underline focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
            onClick={() => window.open(docLink('/use-dify/nodes/user-input'), '_blank')}
          >
            {t('overview.appInfo.enableTooltip.learnMore', { ns: 'appOverview' })}
          </button>
        </>
      )
    : ''

  const statusPopoverContent = cardState.toggleDisabled
    ? (
        triggerModeDisabled && triggerModeMessage
          ? triggerModeMessage
          : missingStartNodeContent
      )
    : ''

  return (
    <div
      className={`${isInPanel ? 'border-t border-l-[0.5px]' : 'border-[0.5px] shadow-xs'} w-full max-w-full rounded-xl border-effects-highlight ${className ?? ''} ${cardState.isMinimalState ? 'h-12' : ''}`}
    >
      <div className={`${customBgColor ?? 'bg-background-default'} relative rounded-xl ${triggerModeDisabled ? 'opacity-60' : ''}`}>
        {triggerModeDisabled && (
          triggerModeMessage
            ? (
                <Popover>
                  <PopoverTrigger
                    openOnHover
                    aria-label={typeof triggerModeMessage === 'string' ? triggerModeMessage : basicName}
                    render={<button type="button" className="absolute inset-0 z-10 cursor-not-allowed rounded-xl outline-hidden focus-visible:ring-1 focus-visible:ring-components-input-border-hover" />}
                  />
                  <PopoverContent
                    placement="right"
                    popupClassName="max-w-64 rounded-xl bg-components-panel-bg px-3 py-2 text-xs text-text-secondary shadow-lg"
                  >
                    {triggerModeMessage}
                  </PopoverContent>
                </Popover>
              )
            : <div className="absolute inset-0 z-10 cursor-not-allowed rounded-xl" aria-hidden="true" />
        )}
        <div className={`flex w-full flex-col items-start justify-center gap-3 self-stretch p-3 ${cardState.isMinimalState ? 'border-0' : 'border-b-[0.5px] border-divider-subtle'}`}>
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
              <Indicator color={cardState.runningStatus ? 'green' : 'yellow'} />
              <div className={`${cardState.runningStatus ? 'text-text-success' : 'text-text-warning'} system-xs-semibold-uppercase`}>
                {cardState.runningStatus
                  ? t('overview.status.running', { ns: 'appOverview' })
                  : t('overview.status.disable', { ns: 'appOverview' })}
              </div>
            </div>
            {cardState.toggleDisabled && statusPopoverContent
              ? (
                  <Popover>
                    <PopoverTrigger
                      openOnHover
                      nativeButton={false}
                      aria-label={typeof statusPopoverContent === 'string' ? statusPopoverContent : t('overview.appInfo.enableTooltip.description', { ns: 'appOverview' })}
                      render={(
                        <div>
                          <Switch checked={cardState.runningStatus} onCheckedChange={onChangeStatus} disabled={cardState.toggleDisabled} />
                        </div>
                      )}
                    />
                    <PopoverContent
                      placement="right"
                      sideOffset={24}
                      popupClassName="w-58 max-w-60 rounded-xl bg-components-panel-bg px-3.5 py-3 shadow-lg"
                    >
                      {statusPopoverContent}
                    </PopoverContent>
                  </Popover>
                )
              : (
                  <Switch checked={cardState.runningStatus} onCheckedChange={onChangeStatus} disabled={cardState.toggleDisabled} />
                )}
          </div>
          {!cardState.isMinimalState && (
            <AppCardUrlSection
              t={t}
              isApp={isApp}
              accessibleUrl={cardState.accessibleUrl}
              showConfirmDelete={showConfirmDelete}
              isCurrentWorkspaceManager={isCurrentWorkspaceManager}
              genLoading={genLoading}
              onRegenerate={() => {
                onGenCode()
                setShowConfirmDelete(false)
              }}
              onShowRegenerateConfirm={() => setShowConfirmDelete(true)}
              onHideRegenerateConfirm={() => setShowConfirmDelete(false)}
            />
          )}
          {!cardState.isMinimalState && isApp && systemFeatures.webapp_auth.enabled && appDetail && (
            <AppCardAccessControlSection
              t={t}
              appDetail={appDetail}
              isAppAccessSet={isAppAccessSet}
              onClick={handleClickAccessControl}
            />
          )}
        </div>
        {!cardState.isMinimalState && (
          <div className="flex items-center gap-1 self-stretch p-3">
            {!isApp && <SecretKeyButton appId={appInfo.id} />}
            <AppCardOperations
              t={t}
              operations={operations}
              launchConfigAction={hiddenLaunchVariables.length > 0
                ? {
                    label: t('operation.config', { ns: 'common' }),
                    disabled: triggerModeDisabled || !cardState.runningStatus,
                    onClick: handleOpenWorkflowLaunchDialog,
                  }
                : undefined}
            />
          </div>
        )}
      </div>
      <AppCardDialogs
        isApp={isApp}
        appInfo={appInfo}
        appMode={cardState.appMode}
        showSettingsModal={showSettingsModal}
        showEmbedded={showEmbedded}
        showCustomizeModal={showCustomizeModal}
        showAccessControl={showAccessControl}
        appDetail={appDetail}
        onCloseSettings={() => setShowSettingsModal(false)}
        onCloseEmbedded={() => setShowEmbedded(false)}
        onCloseCustomize={() => setShowCustomizeModal(false)}
        onCloseAccessControl={() => setShowAccessControl(false)}
        onSaveSiteConfig={onSaveSiteConfig}
        onConfirmAccessControl={handleAccessControlUpdate}
        hiddenInputs={hiddenLaunchVariables}
      />
      <WorkflowLaunchDialog
        t={t}
        open={showWorkflowLaunchDialog}
        hiddenVariables={supportedWorkflowLaunchVariables}
        unsupportedVariables={unsupportedWorkflowLaunchVariables}
        values={workflowLaunchValues}
        onOpenChange={setShowWorkflowLaunchDialog}
        onValueChange={handleWorkflowLaunchValueChange}
        onSubmit={handleWorkflowLaunchConfirm}
      />
    </div>
  )
}

export default AppCard
