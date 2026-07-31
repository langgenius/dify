import type { FormEvent } from 'react'
import type { ModelAndParameter } from '../configuration/debug/types'
import type {
  WorkflowHiddenStartVariable,
  WorkflowLaunchInputValue,
} from '@/app/components/app/overview/app-card-utils'
import type { CollaborationUpdate } from '@/app/components/workflow/collaboration/types/collaboration'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import type { PublishWorkflowParams } from '@/types/workflow'
import { Button } from '@langgenius/dify-ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { use, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WorkflowLaunchDialog } from '@/app/components/app/overview/app-card-sections'
import {
  buildWorkflowLaunchUrl,
  createWorkflowLaunchInitialValues,
  isWorkflowLaunchInputSupported,
} from '@/app/components/app/overview/app-card-utils'
import { useStore as useAppStore } from '@/app/components/app/store'
import { trackEvent } from '@/app/components/base/amplitude'
import { useCanManageTools } from '@/app/components/tools/hooks/use-tool-permissions'
import { WorkflowToolDrawer } from '@/app/components/tools/workflow-tool'
import { useConfigureButton } from '@/app/components/tools/workflow-tool/hooks/use-configure-button'
import { collaborationManager } from '@/app/components/workflow/collaboration/core/collaboration-manager'
import { webSocketClient } from '@/app/components/workflow/collaboration/core/websocket-manager'
import { WorkflowContext } from '@/app/components/workflow/context'
import { appDefaultIconBackground } from '@/config'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { AccessMode } from '@/models/access-control'
import { useAppWhiteListSubjects, useGetUserCanAccessApp } from '@/service/access-control'
import { fetchAppDetail, publishToCreatorsPlatform } from '@/service/apps'
import { appDetailQueryKeyPrefix } from '@/service/use-apps'
import {
  appWorkflowQueryOptions,
  useAppWorkflow,
  useInvalidateAppWorkflow,
  useUpdateWorkflow,
} from '@/service/use-workflow'
import { AppModeEnum } from '@/types/app'
import { getAppACLCapabilities } from '@/utils/permission'
import AccessControl from '../app-access-control'
import { PublisherEnvironmentFlow } from './environment-deployment-flow'
import { PublisherEnvironmentTabs } from './environment-tabs'
import { APP_PUBLISH_HOTKEY } from './hotkeys'
import {
  PublisherAccessSection,
  PublisherActionsSection,
  PublisherSummarySection,
} from './sections'
import {
  addPublisherEnvironmentAtom,
  appPublisherEnvironmentsAtom,
  AppPublisherStateBoundary,
  BUILT_IN_ENVIRONMENT_ID,
  joinedPublisherEnvironmentIdsAtom,
  selectedEnvironmentDeploymentAtom,
  selectedEnvironmentDeploymentIsErrorAtom,
  selectedEnvironmentDeploymentIsLoadingAtom,
  selectedPublisherEnvironmentAtom,
  selectedPublisherEnvironmentIdAtom,
} from './state'
import {
  getDisabledFunctionTooltip,
  getPublisherAppUrl,
  isPublisherAccessConfigured,
} from './utils'
import VersionInfoModal from './version-info-modal'

export type AppPublisherProps = {
  disabled?: boolean
  publishDisabled?: boolean
  publishedAt?: number
  /** only needed in workflow / chatflow mode */
  draftUpdatedAt?: number
  /** Current persisted workflow draft hash, used to compare with the published workflow. */
  draftHash?: string
  /** Non-workflow editors should pass their local dirty state. */
  hasUnpublishedChanges?: boolean
  debugWithMultipleModel?: boolean
  multipleModelConfigs?: ModelAndParameter[]
  /** modelAndParameter is passed when debugWithMultipleModel is true */
  onPublish?: AppPublisherPublishHandler
  onRestore?: AppPublisherRestoreHandler
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

export type AppPublisherPublishParams = ModelAndParameter | PublishWorkflowParams

type AppPublisherPublishHandler =
  | ((params?: AppPublisherPublishParams) => Promise<unknown> | unknown)
  | ((params?: unknown) => Promise<unknown> | unknown)

type AppPublisherRestoreHandler = () => Promise<unknown> | unknown

export function AppPublisher(props: AppPublisherProps) {
  const appDetail = useAppStore((state) => state.appDetail)
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canDeploy = getAppACLCapabilities(appDetail?.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail?.maintainer,
    workspacePermissionKeys,
  }).canDeploy
  const supportsMultiEnvironment = appDetail?.mode === AppModeEnum.WORKFLOW && canDeploy

  return (
    <AppPublisherStateBoundary
      appId={appDetail?.id}
      environmentQueryEnabled={supportsMultiEnvironment}
    >
      <AppPublisherContent {...props} supportsMultiEnvironment={supportsMultiEnvironment} />
    </AppPublisherStateBoundary>
  )
}

function AppPublisherContent({
  disabled = false,
  publishDisabled = false,
  publishedAt,
  draftUpdatedAt,
  draftHash,
  hasUnpublishedChanges,
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
  supportsMultiEnvironment,
}: AppPublisherProps & { supportsMultiEnvironment: boolean }) {
  const { t } = useTranslation()

  const [open, setOpen] = useState(false)
  const [showAppAccessControl, setShowAppAccessControl] = useState(false)
  const [workflowToolDrawerOpen, setWorkflowToolDrawerOpen] = useState(false)
  const [workflowLaunchDialogOpen, setWorkflowLaunchDialogOpen] = useState(false)
  const [workflowLaunchTargetUrl, setWorkflowLaunchTargetUrl] = useState('')
  const [workflowLaunchValues, setWorkflowLaunchValues] = useState<
    Record<string, WorkflowLaunchInputValue>
  >({})
  const [publishingToMarketplace, setPublishingToMarketplace] = useState(false)
  const [editVersionInfoOpen, setEditVersionInfoOpen] = useState(false)

  const workflowStore = use(WorkflowContext)
  const appDetail = useAppStore((state) => state.appDetail)
  const setAppDetail = useAppStore((state) => state.setAppDetail)
  const canManageTools = useCanManageTools()
  const environments = useAtomValue(appPublisherEnvironmentsAtom)
  const joinedEnvironmentIds = useAtomValue(joinedPublisherEnvironmentIdsAtom)
  const selectedEnvironmentId = useAtomValue(selectedPublisherEnvironmentIdAtom)
  const selectedEnvironment = useAtomValue(selectedPublisherEnvironmentAtom)
  const selectedEnvironmentDeployment = useAtomValue(selectedEnvironmentDeploymentAtom)
  const isSelectedEnvironmentDeploymentLoading = useAtomValue(
    selectedEnvironmentDeploymentIsLoadingAtom,
  )
  const isSelectedEnvironmentDeploymentError = useAtomValue(
    selectedEnvironmentDeploymentIsErrorAtom,
  )
  const addEnvironment = useSetAtom(addPublisherEnvironmentAtom)
  const selectEnvironment = useSetAtom(selectedPublisherEnvironmentIdAtom)
  const queryClient = useQueryClient()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const { app_base_url: appBaseURL = '', access_token: accessToken = '' } = appDetail?.site ?? {}

  const appURL = getPublisherAppUrl({ appBaseUrl: appBaseURL, accessToken, mode: appDetail?.mode })
  const appMode = appDetail?.mode
  const isWorkflowApp = appMode === AppModeEnum.WORKFLOW || appMode === AppModeEnum.ADVANCED_CHAT
  const isChatApp =
    appMode === AppModeEnum.CHAT ||
    appMode === AppModeEnum.AGENT_CHAT ||
    appMode === AppModeEnum.COMPLETION
  const {
    data: publishedWorkflow,
    isError: isPublishedWorkflowError,
    isLoading: isPublishedWorkflowLoading,
    isSuccess: isPublishedWorkflowSuccess,
  } = useAppWorkflow(isWorkflowApp ? (appDetail?.id ?? '') : '')
  const currentPublishedAt =
    isWorkflowApp && isPublishedWorkflowSuccess
      ? publishedWorkflow?.created_at
        ? publishedWorkflow.created_at * 1000
        : undefined
      : publishedAt
  const { mutate: updateWorkflow } = useUpdateWorkflow()
  const hiddenLaunchVariables: WorkflowHiddenStartVariable[] = (inputs ?? []).filter(
    (input) => input.hide === true,
  )
  const supportedWorkflowLaunchVariables = hiddenLaunchVariables.filter(
    isWorkflowLaunchInputSupported,
  )
  const unsupportedWorkflowLaunchVariables = hiddenLaunchVariables.filter(
    (variable) => !isWorkflowLaunchInputSupported(variable),
  )
  const initialWorkflowLaunchValues = createWorkflowLaunchInitialValues(
    supportedWorkflowLaunchVariables,
  )

  const shouldLoadUserCanAccessApp = Boolean(
    appDetail?.id && open && systemFeatures.webapp_auth.enabled,
  )
  const { data: userCanAccessApp, isLoading: isGettingUserCanAccessApp } = useGetUserCanAccessApp({
    appId: appDetail?.id,
    enabled: shouldLoadUserCanAccessApp,
  })
  const { data: appAccessSubjects, isLoading: isGettingAppWhiteListSubjects } =
    useAppWhiteListSubjects(
      appDetail?.id,
      open &&
        systemFeatures.webapp_auth.enabled &&
        appDetail?.access_mode === AccessMode.SPECIFIC_GROUPS_MEMBERS,
    )
  const invalidateAppWorkflow = useInvalidateAppWorkflow()

  const isAppAccessSet = isPublisherAccessConfigured(appDetail, appAccessSubjects)

  const noAccessPermission = Boolean(
    systemFeatures.webapp_auth.enabled &&
    appDetail &&
    appDetail.access_mode !== AccessMode.EXTERNAL_MEMBERS &&
    !userCanAccessApp?.result,
  )
  const disabledFunctionButton = !currentPublishedAt || missingStartNode || noAccessPermission
  const disabledFunctionTooltip = getDisabledFunctionTooltip({
    t,
    publishedAt: currentPublishedAt,
    missingStartNode,
    noAccessPermission,
  })

  async function handlePublish(params?: ModelAndParameter | PublishWorkflowParams) {
    try {
      await onPublish?.(params)

      const appId = appDetail?.id
      const socket = appId ? webSocketClient.getSocket(appId) : null
      if (appId) invalidateAppWorkflow(appId)
      else console.warn('[app-publisher] missing appId, skip workflow invalidate and socket emit')
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
      } else if (appId) {
        console.warn('[app-publisher] socket not ready, skip collaboration_event emit', { appId })
      }

      trackEvent('app_published_time', {
        action_mode: 'app',
        app_id: appDetail?.id,
        app_name: appDetail?.name,
      })
    } catch (error) {
      console.warn('[app-publisher] publish failed', error)
    }
  }

  async function handleRestore() {
    try {
      await onRestore?.()
      setOpen(false)
    } catch {}
  }

  function handleOpenChange(nextOpen: boolean) {
    if (disabled) {
      setOpen(false)
      return
    }

    onToggle?.(nextOpen)
    setOpen(nextOpen)
  }

  async function handleAccessControlUpdate() {
    if (!appDetail) return
    try {
      const res = await fetchAppDetail({ url: '/apps', id: appDetail.id })
      queryClient.setQueryData([...appDetailQueryKeyPrefix, appDetail.id], res)
      setAppDetail({ ...res })
    } finally {
      setShowAppAccessControl(false)
    }
  }

  function handleOpenWorkflowLaunchDialog(targetUrl: string) {
    setWorkflowLaunchValues(initialWorkflowLaunchValues)
    setWorkflowLaunchTargetUrl(targetUrl)
    setWorkflowLaunchDialogOpen(true)
  }

  function handleWorkflowLaunchValueChange(variable: string, value: WorkflowLaunchInputValue) {
    setWorkflowLaunchValues((prev) => ({
      ...prev,
      [variable]: value,
    }))
  }

  async function handleWorkflowLaunchConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const targetUrl = await buildWorkflowLaunchUrl({
      accessibleUrl: workflowLaunchTargetUrl,
      variables: supportedWorkflowLaunchVariables,
      values: workflowLaunchValues,
    })

    window.open(targetUrl, '_blank')
    setWorkflowLaunchDialogOpen(false)
  }

  async function handlePublishToMarketplace() {
    if (!appDetail?.id || publishingToMarketplace) return
    setPublishingToMarketplace(true)
    try {
      const res = await publishToCreatorsPlatform({ appID: appDetail.id })
      if (res.redirect_url) window.open(res.redirect_url, '_blank')
    } catch {
      toast.error(t(($) => $['common.publishToMarketplaceFailed'], { ns: 'workflow' }))
    } finally {
      setPublishingToMarketplace(false)
    }
  }

  const hasPublishedVersion = Boolean(currentPublishedAt)
  const workflowHasUnpublishedChanges =
    !currentPublishedAt ||
    !draftHash ||
    !publishedWorkflow?.hash ||
    draftHash !== publishedWorkflow.hash
  const resolvedHasUnpublishedChanges =
    hasUnpublishedChanges ?? (isWorkflowApp ? workflowHasUnpublishedChanges : !currentPublishedAt)

  function handleOpenVersionInfo() {
    if (!publishedWorkflow) return

    handleOpenChange(false)
    setEditVersionInfoOpen(true)
  }

  function handleUpdateVersionInfo(params: { id?: string; title: string; releaseNotes: string }) {
    if (!appDetail?.id || !params.id) return

    updateWorkflow(
      {
        url: `/apps/${appDetail.id}/workflows/${params.id}`,
        title: params.title,
        releaseNotes: params.releaseNotes,
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['versionHistory.action.updateSuccess'], { ns: 'workflow' }))
          invalidateAppWorkflow(appDetail.id)
        },
        onError: () => {
          toast.error(t(($) => $['versionHistory.action.updateFailure'], { ns: 'workflow' }))
        },
        onSettled: () => {
          setEditVersionInfoOpen(false)
        },
      },
    )
  }

  useHotkey(APP_PUBLISH_HOTKEY, (e) => {
    if (debugWithMultipleModel) return
    e.preventDefault()
    if (publishDisabled || (hasPublishedVersion && !resolvedHasUnpublishedChanges)) return
    handlePublish()
  })

  useEffect(() => {
    const appId = appDetail?.id
    if (!appId) return

    const unsubscribe = collaborationManager.onAppPublishUpdate((update: CollaborationUpdate) => {
      const action = typeof update.data.action === 'string' ? update.data.action : undefined
      if (action === 'published') {
        void queryClient
          .fetchQuery(appWorkflowQueryOptions(appId))
          .then((publishedWorkflow) => {
            workflowStore?.getState().setPublishedAt(publishedWorkflow?.created_at ?? 0)
          })
          .catch((error) => {
            console.warn('[app-publisher] refresh published workflow failed', error)
          })
      }
    })

    return unsubscribe
  }, [appDetail?.id, queryClient, workflowStore])

  const workflowToolVisible =
    appDetail?.mode === AppModeEnum.WORKFLOW && !hasHumanInputNode && !hasTriggerNode
  const workflowToolAvailableForUser = workflowToolAvailable && canManageTools
  const workflowToolMessage =
    !hasPublishedVersion || !workflowToolAvailable
      ? t(($) => $['common.workflowAsToolDisabledHint'], { ns: 'workflow' })
      : undefined
  const workflowToolPublished = !!toolPublished
  function closeWorkflowToolDrawer() {
    setWorkflowToolDrawerOpen(false)
  }
  const workflowToolIcon = {
    content: (appDetail?.icon_type === 'image' ? '🤖' : appDetail?.icon) || '🤖',
    background:
      (appDetail?.icon_type === 'image' ? appDefaultIconBackground : appDetail?.icon_background) ||
      appDefaultIconBackground,
  }
  const workflowTool = useConfigureButton({
    enabled: workflowToolVisible && canManageTools,
    published: workflowToolPublished,
    detailNeedUpdate: workflowToolPublished && !resolvedHasUnpublishedChanges,
    workflowAppId: appDetail?.id ?? '',
    icon: workflowToolIcon,
    name: appDetail?.name ?? '',
    description: appDetail?.description ?? '',
    inputs,
    outputs,
    handlePublish,
    onRefreshData,
    onConfigured: closeWorkflowToolDrawer,
  })
  function openWorkflowToolDrawer() {
    if (!canManageTools) return

    handleOpenChange(false)
    setWorkflowToolDrawerOpen(true)
  }
  const upgradeHighlightStyle = {
    background:
      'linear-gradient(97deg, var(--components-input-border-active-prompt-1, rgba(11, 165, 236, 0.95)) -3.64%, var(--components-input-border-active-prompt-2, rgba(21, 90, 239, 0.95)) 45.14%)',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  }
  const latestPublishedVersion = isPublishedWorkflowSuccess
    ? publishedWorkflow
      ? {
          description: publishedWorkflow.marked_comment || undefined,
          id: publishedWorkflow.id,
          latest: true,
          name: publishedWorkflow.marked_name || publishedWorkflow.version,
          publishedAt: publishedWorkflow.created_at * 1000,
          publishedBy: publishedWorkflow.created_by?.name,
        }
      : null
    : undefined
  const environmentTabs = supportsMultiEnvironment ? (
    <PublisherEnvironmentTabs
      environments={environments.map((environment) => ({
        id: environment.id,
        name: environment.display_name,
      }))}
      joinedEnvironmentIds={joinedEnvironmentIds}
      selectedEnvironmentId={selectedEnvironmentId}
      onAddEnvironment={addEnvironment}
      onSelectEnvironment={selectEnvironment}
    />
  ) : undefined
  const showBuiltInPublisher =
    !supportsMultiEnvironment || selectedEnvironmentId === BUILT_IN_ENVIRONMENT_ID

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <Button variant="primary" className="py-2 pr-2 pl-3" disabled={disabled}>
              {t(($) => $['common.publish'], { ns: 'workflow' })}
              <span className="i-ri-arrow-down-s-line size-4 text-components-button-primary-text" />
            </Button>
          }
        />
        <PopoverContent
          placement="bottom-end"
          sideOffset={4}
          alignOffset={crossAxisOffset}
          popupClassName="border-none bg-transparent shadow-none"
        >
          <div className="flex max-h-[calc(100dvh-32px)] w-98 flex-col overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5">
            {showBuiltInPublisher ? (
              <>
                <PublisherSummarySection
                  debugWithMultipleModel={debugWithMultipleModel}
                  draftUpdatedAt={draftUpdatedAt}
                  environmentTabs={environmentTabs}
                  formatTimeFromNow={formatTimeFromNow}
                  handlePublish={handlePublish}
                  handleRestore={handleRestore}
                  hasUnpublishedChanges={resolvedHasUnpublishedChanges}
                  isChatApp={isChatApp}
                  isWorkflowApp={isWorkflowApp}
                  multipleModelConfigs={multipleModelConfigs}
                  onEditVersion={handleOpenVersionInfo}
                  publishDisabled={publishDisabled}
                  publishedAt={currentPublishedAt}
                  startNodeLimitExceeded={startNodeLimitExceeded}
                  upgradeHighlightStyle={upgradeHighlightStyle}
                  versionInfo={publishedWorkflow}
                />
                <PublisherAccessSection
                  enabled={systemFeatures.webapp_auth.enabled}
                  isAppAccessSet={isAppAccessSet}
                  isLoading={Boolean(
                    systemFeatures.webapp_auth.enabled &&
                    (isGettingUserCanAccessApp || isGettingAppWhiteListSubjects),
                  )}
                  accessMode={appDetail?.access_mode}
                  onClick={() => {
                    handleOpenChange(false)
                    setShowAppAccessControl(true)
                  }}
                />
                <PublisherActionsSection
                  appDetail={appDetail}
                  appURL={appURL}
                  disabledFunctionButton={disabledFunctionButton}
                  disabledFunctionTooltip={disabledFunctionTooltip}
                  handleOpenRunConfig={handleOpenWorkflowLaunchDialog}
                  hasHumanInputNode={hasHumanInputNode}
                  hasTriggerNode={hasTriggerNode}
                  marketplaceActionDisabled={!currentPublishedAt}
                  publishedAt={currentPublishedAt}
                  publishingToMarketplace={publishingToMarketplace}
                  showDeployAction={supportsMultiEnvironment}
                  showMarketplaceAction={systemFeatures.enable_creators_platform}
                  showRunConfig={hiddenLaunchVariables.length > 0}
                  toolPublished={workflowToolPublished}
                  workflowToolAvailable={workflowToolAvailableForUser}
                  workflowToolIsLoading={workflowTool.isLoading}
                  workflowToolMessage={workflowToolMessage}
                  workflowToolOutdated={workflowTool.outdated}
                  onConfigureWorkflowTool={openWorkflowToolDrawer}
                  onPublishToMarketplace={handlePublishToMarketplace}
                />
              </>
            ) : (
              <PublisherEnvironmentFlow
                key={selectedEnvironmentId}
                appId={appDetail?.id}
                deployment={selectedEnvironmentDeployment}
                environmentId={selectedEnvironmentId}
                environmentName={
                  selectedEnvironment?.display_name ??
                  selectedEnvironmentDeployment?.environment.display_name ??
                  selectedEnvironmentId
                }
                environmentTabs={environmentTabs}
                isEnvironmentInUse={selectedEnvironment?.in_use === true}
                isDeploymentError={
                  isSelectedEnvironmentDeploymentError ||
                  (selectedEnvironment?.in_use === false && isPublishedWorkflowError)
                }
                isDeploymentLoading={
                  isSelectedEnvironmentDeploymentLoading ||
                  (selectedEnvironment?.in_use === false && isPublishedWorkflowLoading)
                }
                latestVersion={latestPublishedVersion}
                onGoToPublish={() => selectEnvironment(BUILT_IN_ENVIRONMENT_ID)}
              />
            )}
          </div>
        </PopoverContent>
        {showAppAccessControl && (
          <AccessControl
            app={appDetail!}
            onConfirm={handleAccessControlUpdate}
            onClose={() => {
              setShowAppAccessControl(false)
            }}
          />
        )}
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
      {editVersionInfoOpen && (
        <VersionInfoModal
          isOpen={editVersionInfoOpen}
          versionInfo={publishedWorkflow ?? undefined}
          onClose={() => setEditVersionInfoOpen(false)}
          onPublish={handleUpdateVersionInfo}
        />
      )}
      {workflowToolDrawerOpen && canManageTools && (
        <WorkflowToolDrawer
          isAdd={!workflowToolPublished}
          payload={workflowTool.payload}
          onHide={closeWorkflowToolDrawer}
          onCreate={workflowTool.handleCreate}
          onSave={workflowTool.handleUpdate}
        />
      )}
    </>
  )
}
