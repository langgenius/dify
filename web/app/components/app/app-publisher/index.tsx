import type { FormEvent } from 'react'
import type { ModelAndParameter } from '../configuration/debug/types'
import type { WorkflowHiddenStartVariable, WorkflowLaunchInputValue } from '@/app/components/app/overview/app-card-utils'
import type { CollaborationUpdate } from '@/app/components/workflow/collaboration/types/collaboration'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import type { PublishWorkflowParams } from '@/types/workflow'
import { Button } from '@langgenius/dify-ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useKeyPress } from 'ahooks'
import {

  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { WorkflowLaunchDialog } from '@/app/components/app/overview/app-card-sections'
import {
  buildWorkflowLaunchUrl,
  createWorkflowLaunchInitialValues,
  isWorkflowLaunchInputSupported,

} from '@/app/components/app/overview/app-card-utils'
import EmbeddedModal from '@/app/components/app/overview/embedded'
import { useStore as useAppStore } from '@/app/components/app/store'
import { trackEvent } from '@/app/components/base/amplitude'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { webSocketClient } from '@/app/components/workflow/collaboration/core/websocket-manager'
import { WorkflowContext } from '@/app/components/workflow/context'
import { useAsyncWindowOpen } from '@/hooks/use-async-window-open'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useSnippetAndEvaluationPlanAccess } from '@/hooks/use-snippet-and-evaluation-plan-access'
import { AccessMode } from '@/models/access-control'
import { useAppWhiteListSubjects, useGetUserCanAccessApp } from '@/service/access-control'
import { fetchAppDetailDirect, publishToCreatorsPlatform } from '@/service/apps'
import { fetchInstalledAppList } from '@/service/explore'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useInvalidateAppWorkflow } from '@/service/use-workflow'
import { fetchPublishedWorkflow } from '@/service/workflow'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import { getKeyboardKeyCodeBySystem } from '../../workflow/utils'
import AccessControl from '../app-access-control'
import EvaluationWorkflowSwitchConfirmDialog from './evaluation-workflow-switch-confirm-dialog'
import {
  PublisherAccessSection,
  PublisherActionsSection,
  PublisherSummarySection,
} from './sections'
import SuggestedAction from './suggested-action'
import { useWorkflowTypeSwitch } from './use-workflow-type-switch'
import {
  getDisabledFunctionTooltip,
  getPublisherAppUrl,
  isPublisherAccessConfigured,
} from './utils'

export type AppPublisherPublishParams
  = | ModelAndParameter
    | (Pick<PublishWorkflowParams, 'title' | 'releaseNotes'> & {
      url?: string
      id?: string
    })

export type AppPublisherProps = {
  disabled?: boolean
  publishDisabled?: boolean
  publishedAt?: number
  /** only needed in workflow / chatflow mode */
  draftUpdatedAt?: number
  debugWithMultipleModel?: boolean
  multipleModelConfigs?: ModelAndParameter[]
  /** modelAndParameter is passed when debugWithMultipleModel is true */
  onPublish?: (params?: AppPublisherPublishParams) => Promise<unknown> | unknown
  onRestore?: () => Promise<unknown> | unknown
  onToggle?: (state: boolean) => void
  crossAxisOffset?: number
  toolPublished?: boolean
  inputs?: InputVar[]
  outputs?: Variable[]
  onRefreshData?: () => void
  workflowToolAvailable?: boolean
  missingStartNode?: boolean
  hasTriggerNode?: boolean // Whether workflow currently contains any trigger nodes (used to hide missing-start CTA when triggers exist).
  startNodeLimitExceeded?: boolean
  hasHumanInputNode?: boolean
}

const PUBLISH_SHORTCUT = ['ctrl', '⇧', 'P']

const AppPublisher = ({
  disabled = false,
  publishDisabled = false,
  publishedAt,
  draftUpdatedAt,
  debugWithMultipleModel = false,
  multipleModelConfigs = [],
  onPublish,
  onRestore,
  onToggle,
  crossAxisOffset = 0,
  toolPublished,
  inputs,
  outputs,
  onRefreshData,
  workflowToolAvailable = true,
  missingStartNode = false,
  hasTriggerNode = false,
  startNodeLimitExceeded = false,
  hasHumanInputNode = false,
}: AppPublisherProps) => {
  const { t } = useTranslation()

  const [published, setPublished] = useState(false)
  const [open, setOpen] = useState(false)
  const [showAppAccessControl, setShowAppAccessControl] = useState(false)

  const [embeddingModalOpen, setEmbeddingModalOpen] = useState(false)
  const [workflowLaunchDialogOpen, setWorkflowLaunchDialogOpen] = useState(false)
  const [workflowLaunchTargetUrl, setWorkflowLaunchTargetUrl] = useState('')
  const [workflowLaunchValues, setWorkflowLaunchValues] = useState<Record<string, WorkflowLaunchInputValue>>({})
  const [publishingToMarketplace, setPublishingToMarketplace] = useState(false)

  const workflowStore = useContext(WorkflowContext)
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(s => s.setAppDetail)
  const { canAccess: canAccessSnippetsAndEvaluation } = useSnippetAndEvaluationPlanAccess()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const { app_base_url: appBaseURL = '', access_token: accessToken = '' } = appDetail?.site ?? {}

  const appURL = getPublisherAppUrl({ appBaseUrl: appBaseURL, accessToken, mode: appDetail?.mode })
  const isChatApp = [AppModeEnum.CHAT, AppModeEnum.AGENT_CHAT, AppModeEnum.COMPLETION].includes(appDetail?.mode || AppModeEnum.CHAT)

  const hiddenLaunchVariables = useMemo<WorkflowHiddenStartVariable[]>(
    () => (inputs ?? []).filter(input => input.hide === true),
    [inputs],
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

  const { data: userCanAccessApp, isLoading: isGettingUserCanAccessApp, refetch } = useGetUserCanAccessApp({ appId: appDetail?.id, enabled: false })
  const { data: appAccessSubjects, isLoading: isGettingAppWhiteListSubjects } = useAppWhiteListSubjects(appDetail?.id, open && systemFeatures.webapp_auth.enabled && appDetail?.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS)
  const invalidateAppWorkflow = useInvalidateAppWorkflow()
  const openAsyncWindow = useAsyncWindowOpen()

  const isAppAccessSet = useMemo(() => isPublisherAccessConfigured(appDetail, appAccessSubjects), [appAccessSubjects, appDetail])

  const noAccessPermission = useMemo(() => Boolean(
    systemFeatures.webapp_auth.enabled
    && appDetail
    && appDetail.access_mode !== AccessMode.EXTERNAL_MEMBERS
    && !userCanAccessApp?.result,
  ), [systemFeatures, appDetail, userCanAccessApp])
  const disabledFunctionButton = useMemo(() => (!publishedAt || missingStartNode || noAccessPermission), [publishedAt, missingStartNode, noAccessPermission])
  const disabledFunctionTooltip = useMemo(() => getDisabledFunctionTooltip({
    t,
    publishedAt,
    missingStartNode,
    noAccessPermission,
  }), [missingStartNode, noAccessPermission, publishedAt, t])

  useEffect(() => {
    if (systemFeatures.webapp_auth.enabled && open && appDetail)
      refetch()
  }, [open, appDetail, refetch, systemFeatures])

  const handlePublish = useCallback(async (params?: AppPublisherPublishParams) => {
    try {
      await onPublish?.(params)
      setPublished(true)

      const appId = appDetail?.id
      const socket = appId ? webSocketClient.getSocket(appId) : null
      if (appId)
        invalidateAppWorkflow(appId)
      else
        console.warn('[app-publisher] missing appId, skip workflow invalidate and socket emit')
      if (socket) {
        const timestamp = Date.now()
        socket.emit('collaboration_event', {
          type: 'app_publish_update',
          data: {
            action: 'published',
            timestamp,
          },
          timestamp,
        })
      }
      else if (appId) {
        console.warn('[app-publisher] socket not ready, skip collaboration_event emit', { appId })
      }

      trackEvent('app_published_time', { action_mode: 'app', app_id: appDetail?.id, app_name: appDetail?.name })
    }
    catch (error) {
      console.warn('[app-publisher] publish failed', error)
      setPublished(false)
    }
  }, [appDetail, onPublish, invalidateAppWorkflow])

  const handleRestore = useCallback(async () => {
    try {
      await onRestore?.()
      setOpen(false)
    }
    catch { }
  }, [onRestore])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (disabled) {
      setOpen(false)
      return
    }

    onToggle?.(nextOpen)
    setOpen(nextOpen)

    if (nextOpen)
      setPublished(false)
  }, [disabled, onToggle])

  const handleOpenInExplore = useCallback(async () => {
    await openAsyncWindow(async () => {
      if (!appDetail?.id)
        throw new Error('App not found')
      const { installed_apps } = await fetchInstalledAppList(appDetail.id)
      if (installed_apps?.length > 0)
        return `${basePath}/explore/installed/${installed_apps[0]!.id}`
      throw new Error('No app found in Explore')
    }, {
      onError: (err) => {
        toast.error(`${err.message || err}`)
      },
    })
  }, [appDetail?.id, openAsyncWindow])

  const handleAccessControlUpdate = useCallback(async () => {
    if (!appDetail)
      return
    try {
      const res = await fetchAppDetailDirect({ url: '/apps', id: appDetail.id })
      setAppDetail(res)
    }
    finally {
      setShowAppAccessControl(false)
    }
  }, [appDetail, setAppDetail])

  const handlePublishedWorkflowTypeSwitch = useCallback(() => {
    setOpen(false)
  }, [])

  const handleOpenWorkflowLaunchDialog = useCallback((targetUrl: string) => {
    setWorkflowLaunchValues(initialWorkflowLaunchValues)
    setWorkflowLaunchTargetUrl(targetUrl)
    setWorkflowLaunchDialogOpen(true)
  }, [initialWorkflowLaunchValues])

  const handleWorkflowLaunchValueChange = useCallback((variable: string, value: WorkflowLaunchInputValue) => {
    setWorkflowLaunchValues(prev => ({
      ...prev,
      [variable]: value,
    }))
  }, [])

  const handleWorkflowLaunchConfirm = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const targetUrl = await buildWorkflowLaunchUrl({
      accessibleUrl: workflowLaunchTargetUrl,
      variables: supportedWorkflowLaunchVariables,
      values: workflowLaunchValues,
    })

    window.open(targetUrl, '_blank')
    setWorkflowLaunchDialogOpen(false)
  }, [supportedWorkflowLaunchVariables, workflowLaunchTargetUrl, workflowLaunchValues])
  const {
    evaluationWorkflowSwitchTargets,
    handleEvaluationWorkflowSwitchConfirmOpenChange,
    handleWorkflowTypeSwitch,
    isConvertingWorkflowType,
    isEvaluationWorkflowType,
    performWorkflowTypeSwitch,
    showEvaluationWorkflowSwitchConfirm,
    workflowTypeSwitchConfig,
    workflowTypeSwitchDisabled,
    workflowTypeSwitchDisabledReason,
  } = useWorkflowTypeSwitch({
    appDetail,
    canAccessSnippetsAndEvaluation,
    hasHumanInputNode,
    hasTriggerNode,
    onPublish: handlePublish,
    onPublishedSwitch: handlePublishedWorkflowTypeSwitch,
    published,
    publishedAt,
    publishDisabled,
    setAppDetail,
  })

  const handlePublishToMarketplace = useCallback(async () => {
    if (!appDetail?.id || publishingToMarketplace)
      return
    setPublishingToMarketplace(true)
    try {
      const res = await publishToCreatorsPlatform({ appID: appDetail.id })
      if (res.redirect_url)
        window.open(res.redirect_url, '_blank')
    }
    catch {
      toast.error(t('common.publishToMarketplaceFailed', { ns: 'workflow' }))
    }
    finally {
      setPublishingToMarketplace(false)
    }
  }, [appDetail?.id, publishingToMarketplace, t])

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.shift.p`, (e) => {
    e.preventDefault()
    if (publishDisabled || published)
      return
    handlePublish()
  }, { exactMatch: true, useCapture: true })

  useEffect(() => {
    const appId = appDetail?.id
    if (!appId)
      return

    const unsubscribe = collaborationManager.onAppPublishUpdate((update: CollaborationUpdate) => {
      const action = typeof update.data.action === 'string' ? update.data.action : undefined
      if (action === 'published') {
        invalidateAppWorkflow(appId)
        fetchPublishedWorkflow(`/apps/${appId}/workflows/publish`)
          .then((publishedWorkflow) => {
            if (publishedWorkflow?.created_at)
              workflowStore?.getState().setPublishedAt(publishedWorkflow.created_at)
          })
          .catch((error) => {
            console.warn('[app-publisher] refresh published workflow failed', error)
          })
      }
    })

    return unsubscribe
  }, [appDetail?.id, invalidateAppWorkflow, workflowStore])

  const hasPublishedVersion = !!publishedAt
  const workflowToolMessage = !hasPublishedVersion || !workflowToolAvailable
    ? t('common.workflowAsToolDisabledHint', { ns: 'workflow' })
    : undefined
  const upgradeHighlightStyle = useMemo(() => ({
    background: 'linear-gradient(97deg, var(--components-input-border-active-prompt-1, rgba(11, 165, 236, 0.95)) -3.64%, var(--components-input-border-active-prompt-2, rgba(21, 90, 239, 0.95)) 45.14%)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  }), [])

  return (
    <>
      <Popover
        open={open}
        onOpenChange={handleOpenChange}
      >
        <PopoverTrigger
          render={(
            <Button
              variant="primary"
              className="py-2 pr-2 pl-3"
              disabled={disabled}
            >
              {t('common.publish', { ns: 'workflow' })}
              <span className="i-ri-arrow-down-s-line h-4 w-4 text-components-button-primary-text" />
            </Button>
          )}
        />
        <PopoverContent
          placement="bottom-end"
          sideOffset={4}
          alignOffset={crossAxisOffset}
          popupClassName="border-none bg-transparent shadow-none"
        >
          <div className="w-[320px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5">
            <PublisherSummarySection
              debugWithMultipleModel={debugWithMultipleModel}
              draftUpdatedAt={draftUpdatedAt}
              formatTimeFromNow={formatTimeFromNow}
              handlePublish={handlePublish}
              handleRestore={handleRestore}
              isChatApp={isChatApp}
              multipleModelConfigs={multipleModelConfigs}
              publishDisabled={publishDisabled}
              published={published}
              publishedAt={publishedAt}
              publishShortcut={PUBLISH_SHORTCUT}
              startNodeLimitExceeded={startNodeLimitExceeded}
              upgradeHighlightStyle={upgradeHighlightStyle}
              workflowTypeSwitchConfig={workflowTypeSwitchConfig}
              workflowTypeSwitchDisabled={workflowTypeSwitchDisabled}
              workflowTypeSwitchDisabledReason={workflowTypeSwitchDisabledReason}
              onWorkflowTypeSwitch={handleWorkflowTypeSwitch}
            />
            {!isEvaluationWorkflowType && (
              <>
                <PublisherAccessSection
                  enabled={systemFeatures.webapp_auth.enabled}
                  isAppAccessSet={isAppAccessSet}
                  isLoading={Boolean(systemFeatures.webapp_auth.enabled && (isGettingUserCanAccessApp || isGettingAppWhiteListSubjects))}
                  accessMode={appDetail?.access_mode}
                  onClick={() => {
                    setShowAppAccessControl(true)
                    handleOpenChange(false)
                  }}
                />
                <PublisherActionsSection
                  appDetail={appDetail}
                  appURL={appURL}
                  disabledFunctionButton={disabledFunctionButton}
                  disabledFunctionTooltip={disabledFunctionTooltip}
                  handleEmbed={() => {
                    setEmbeddingModalOpen(true)
                    handleOpenChange(false)
                  }}
                  handleOpenInExplore={() => {
                    handleOpenChange(false)
                    handleOpenInExplore()
                  }}
                  handleOpenRunConfig={handleOpenWorkflowLaunchDialog}
                  handlePublish={handlePublish}
                  hasHumanInputNode={hasHumanInputNode}
                  hasTriggerNode={hasTriggerNode}
                  inputs={inputs}
                  missingStartNode={missingStartNode}
                  onRefreshData={onRefreshData}
                  outputs={outputs}
                  published={published}
                  publishedAt={publishedAt}
                  toolPublished={toolPublished}
                  workflowToolAvailable={workflowToolAvailable}
                  workflowToolMessage={workflowToolMessage}
                />
                {systemFeatures.enable_creators_platform && (
                  <div className="border-t border-divider-subtle p-4">
                    <SuggestedAction
                      icon={<span className="i-ri-store-line h-4 w-4" />}
                      disabled={!publishedAt || publishingToMarketplace}
                      onClick={handlePublishToMarketplace}
                    >
                      {publishingToMarketplace
                        ? t('common.publishingToMarketplace', { ns: 'workflow' })
                        : t('common.publishToMarketplace', { ns: 'workflow' })}
                    </SuggestedAction>
                  </div>
                )}
              </>
            )}
          </div>
        </PopoverContent>
        <EmbeddedModal
          siteInfo={appDetail?.site}
          isShow={embeddingModalOpen}
          onClose={() => setEmbeddingModalOpen(false)}
          appBaseUrl={appBaseURL}
          accessToken={accessToken}
          hiddenInputs={hiddenLaunchVariables}
        />
        {showAppAccessControl && <AccessControl app={appDetail!} onConfirm={handleAccessControlUpdate} onClose={() => { setShowAppAccessControl(false) }} /> }
        <WorkflowLaunchDialog
          t={t}
          open={workflowLaunchDialogOpen}
          hiddenVariables={supportedWorkflowLaunchVariables}
          unsupportedVariables={unsupportedWorkflowLaunchVariables}
          values={workflowLaunchValues}
          onOpenChange={setWorkflowLaunchDialogOpen}
          onValueChange={handleWorkflowLaunchValueChange}
          onSubmit={handleWorkflowLaunchConfirm}
        />
      </Popover>
      <EvaluationWorkflowSwitchConfirmDialog
        open={showEvaluationWorkflowSwitchConfirm}
        targets={evaluationWorkflowSwitchTargets}
        loading={isConvertingWorkflowType}
        onOpenChange={handleEvaluationWorkflowSwitchConfirmOpenChange}
        onConfirm={() => void performWorkflowTypeSwitch()}
      />
    </>
  )
}

export default memo(AppPublisher)
