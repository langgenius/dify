import type { ModelAndParameter } from '../configuration/debug/types'
import type { CollaborationUpdate } from '@/app/components/workflow/collaboration/types/collaboration'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import type { EvaluationWorkflowAssociatedTarget } from '@/types/evaluation'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import type { PublishWorkflowParams, WorkflowTypeConversionTarget } from '@/types/workflow'
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
import { fetchAppDetailDirect } from '@/service/apps'
import { fetchInstalledAppList } from '@/service/explore'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useConvertWorkflowTypeMutation } from '@/service/use-apps'
import { useEvaluationWorkflowAssociatedTargets } from '@/service/use-evaluation'
import { useInvalidateAppWorkflow } from '@/service/use-workflow'
import { fetchPublishedWorkflow } from '@/service/workflow'
import { AppModeEnum, AppTypeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import { getKeyboardKeyCodeBySystem } from '../../workflow/utils'
import AccessControl from '../app-access-control'
import EvaluationWorkflowSwitchConfirmDialog from './evaluation-workflow-switch-confirm-dialog'
import {
  PublisherAccessSection,
  PublisherActionsSection,
  PublisherSummarySection,
} from './sections'
import {
  getDisabledFunctionTooltip,
  getPublisherAppUrl,
  isPublisherAccessConfigured,
} from './utils'

export type AppPublisherProps = {
  disabled?: boolean
  publishDisabled?: boolean
  publishedAt?: number
  /** only needed in workflow / chatflow mode */
  draftUpdatedAt?: number
  debugWithMultipleModel?: boolean
  multipleModelConfigs?: ModelAndParameter[]
  /** modelAndParameter is passed when debugWithMultipleModel is true */
  onPublish?: (params?: any) => Promise<any> | any
  onRestore?: () => Promise<any> | any
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

type WorkflowTypeSwitchLabelKey = I18nKeysWithPrefix<'workflow', 'common.'>

const WORKFLOW_TYPE_SWITCH_CONFIG: Record<WorkflowTypeConversionTarget, {
  targetType: WorkflowTypeConversionTarget
  publishLabelKey: WorkflowTypeSwitchLabelKey
  switchLabelKey: WorkflowTypeSwitchLabelKey
  tipKey: WorkflowTypeSwitchLabelKey
}> = {
  workflow: {
    targetType: 'evaluation',
    publishLabelKey: 'common.publishAsEvaluationWorkflow',
    switchLabelKey: 'common.switchToEvaluationWorkflow',
    tipKey: 'common.switchToEvaluationWorkflowTip',
  },
  evaluation: {
    targetType: 'workflow',
    publishLabelKey: 'common.publishAsStandardWorkflow',
    switchLabelKey: 'common.switchToStandardWorkflow',
    tipKey: 'common.switchToStandardWorkflowTip',
  },
} as const

const isWorkflowTypeConversionTarget = (type?: AppTypeEnum): type is WorkflowTypeConversionTarget => {
  return type === 'workflow' || type === 'evaluation'
}

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
  const [showEvaluationWorkflowSwitchConfirm, setShowEvaluationWorkflowSwitchConfirm] = useState(false)
  const [evaluationWorkflowSwitchTargets, setEvaluationWorkflowSwitchTargets] = useState<EvaluationWorkflowAssociatedTarget[]>([])

  const [embeddingModalOpen, setEmbeddingModalOpen] = useState(false)

  const workflowStore = useContext(WorkflowContext)
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(s => s.setAppDetail)
  const { canAccess: canAccessSnippetsAndEvaluation } = useSnippetAndEvaluationPlanAccess()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const { app_base_url: appBaseURL = '', access_token: accessToken = '' } = appDetail?.site ?? {}
  const { mutateAsync: convertWorkflowType, isPending: isConvertingWorkflowType } = useConvertWorkflowTypeMutation()

  const appURL = getPublisherAppUrl({ appBaseUrl: appBaseURL, accessToken, mode: appDetail?.mode })
  const isChatApp = [AppModeEnum.CHAT, AppModeEnum.AGENT_CHAT, AppModeEnum.COMPLETION].includes(appDetail?.mode || AppModeEnum.CHAT)
  const workflowTypeSwitchConfig = useMemo(() => {
    if (!appDetail?.workflow_kind)
      return WORKFLOW_TYPE_SWITCH_CONFIG.workflow

    if (!isWorkflowTypeConversionTarget(appDetail?.workflow_kind))
      return undefined

    return WORKFLOW_TYPE_SWITCH_CONFIG[appDetail.workflow_kind]
  }, [appDetail?.workflow_kind])
  const isEvaluationWorkflowType = appDetail?.workflow_kind === AppTypeEnum.EVALUATION
  const {
    refetch: refetchEvaluationWorkflowAssociatedTargets,
    isFetching: isFetchingEvaluationWorkflowAssociatedTargets,
  } = useEvaluationWorkflowAssociatedTargets(appDetail?.id, { enabled: false })
  const workflowTypeSwitchDisabledReason = useMemo(() => {
    if (workflowTypeSwitchConfig?.targetType !== AppTypeEnum.EVALUATION)
      return undefined

    if (!canAccessSnippetsAndEvaluation)
      return t('compliance.sandboxUpgradeTooltip', { ns: 'common' })

    if (!hasHumanInputNode && !hasTriggerNode)
      return undefined

    return t('common.switchToEvaluationWorkflowDisabledTip', { ns: 'workflow' })
  }, [canAccessSnippetsAndEvaluation, hasHumanInputNode, hasTriggerNode, t, workflowTypeSwitchConfig?.targetType])

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

  const handlePublish = useCallback(async (params?: ModelAndParameter | PublishWorkflowParams) => {
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

  const getWorkflowTypeSwitchPublishUrl = useCallback(() => {
    if (!appDetail?.id || !workflowTypeSwitchConfig)
      return undefined

    if (workflowTypeSwitchConfig.targetType === AppTypeEnum.EVALUATION)
      return `/apps/${appDetail.id}/workflows/publish/evaluation`

    return `/apps/${appDetail.id}/workflows/publish`
  }, [appDetail?.id, workflowTypeSwitchConfig])

  const performWorkflowTypeSwitch = useCallback(async () => {
    if (!appDetail?.id || !workflowTypeSwitchConfig)
      return false

    try {
      if (!publishedAt) {
        const publishUrl = getWorkflowTypeSwitchPublishUrl()
        if (!publishUrl)
          return false

        await handlePublish({
          url: publishUrl,
          title: '',
          releaseNotes: '',
        })

        const latestAppDetail = await fetchAppDetailDirect({
          url: '/apps',
          id: appDetail.id,
        })
        setAppDetail(latestAppDetail)
        setShowEvaluationWorkflowSwitchConfirm(false)
        setEvaluationWorkflowSwitchTargets([])
        return true
      }

      await convertWorkflowType({
        params: {
          appId: appDetail.id,
        },
        query: {
          target_type: workflowTypeSwitchConfig.targetType,
        },
      })

      const latestAppDetail = await fetchAppDetailDirect({
        url: '/apps',
        id: appDetail.id,
      })
      setAppDetail(latestAppDetail)

      if (publishedAt)
        setOpen(false)

      setShowEvaluationWorkflowSwitchConfirm(false)
      setEvaluationWorkflowSwitchTargets([])
      return true
    }
    catch {
      return false
    }
  }, [appDetail?.id, convertWorkflowType, getWorkflowTypeSwitchPublishUrl, handlePublish, publishedAt, setAppDetail, workflowTypeSwitchConfig])

  const handleWorkflowTypeSwitch = useCallback(async () => {
    if (!appDetail?.id || !workflowTypeSwitchConfig)
      return
    if (workflowTypeSwitchDisabledReason) {
      toast.error(workflowTypeSwitchDisabledReason)
      return
    }

    if (appDetail.workflow_kind === AppTypeEnum.EVALUATION && workflowTypeSwitchConfig.targetType === AppTypeEnum.WORKFLOW) {
      const associatedTargetsResult = await refetchEvaluationWorkflowAssociatedTargets()

      if (associatedTargetsResult.isError) {
        toast.error(t('common.switchToStandardWorkflowConfirm.loadFailed', { ns: 'workflow' }))
        return
      }

      const associatedTargets = associatedTargetsResult.data?.items ?? []
      if (associatedTargets.length > 0) {
        setEvaluationWorkflowSwitchTargets(associatedTargets)
        setShowEvaluationWorkflowSwitchConfirm(true)
        return
      }
    }

    await performWorkflowTypeSwitch()
  }, [
    appDetail?.id,
    appDetail?.workflow_kind,
    performWorkflowTypeSwitch,
    refetchEvaluationWorkflowAssociatedTargets,
    t,
    workflowTypeSwitchConfig,
    workflowTypeSwitchDisabledReason,
  ])

  const handleEvaluationWorkflowSwitchConfirmOpenChange = useCallback((nextOpen: boolean) => {
    setShowEvaluationWorkflowSwitchConfirm(nextOpen)

    if (!nextOpen)
      setEvaluationWorkflowSwitchTargets([])
  }, [])

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
              workflowTypeSwitchDisabled={publishDisabled || published || isConvertingWorkflowType || isFetchingEvaluationWorkflowAssociatedTargets || Boolean(workflowTypeSwitchDisabledReason)}
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
        />
        {showAppAccessControl && <AccessControl app={appDetail!} onConfirm={handleAccessControlUpdate} onClose={() => { setShowAppAccessControl(false) }} />}
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
