import type { AppPublisherProps } from '../types'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { toDeploymentVersion } from '@/app/components/app/deploy/version'
import { useStore as useAppStore } from '@/app/components/app/store'
import { WorkflowToolDrawer } from '@/app/components/tools/workflow-tool'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { AccessMode } from '@/models/access-control'
import { useGetUserCanAccessApp } from '@/service/access-control'
import { upgradeHighlightStyle } from '../built-in-publisher/constants'
import { PublisherEnvironmentTabs } from '../environment-tabs'
import { useRefreshAppEnvironmentsAfterPublisherDeploymentPolling } from '../hooks/use-refresh-app-environments-after-deployment-polling'
import {
  addPublisherEnvironmentAtom,
  appPublisherEnvironmentsAtom,
  BUILT_IN_ENVIRONMENT_ID,
  joinedPublisherEnvironmentIdsAtom,
  selectedEnvironmentDeploymentAtom,
  selectedEnvironmentDeploymentIsErrorAtom,
  selectedEnvironmentDeploymentIsLoadingAtom,
  selectedPublisherEnvironmentAtom,
  selectedPublisherEnvironmentIdAtom,
} from '../state'
import { getDisabledFunctionTooltip, getPublisherAppUrl } from '../utils'
import VersionInfoModal from '../version-info-modal'
import { PublisherPanel } from './publisher-panel'
import { useMarketplacePublish } from './use-marketplace-publish'
import { usePublishController } from './use-publish-controller'
import { useVersionInfo } from './use-version-info'
import { useWorkflowLaunch } from './use-workflow-launch'
import { useWorkflowTool } from './use-workflow-tool'

type PublisherContentProps = AppPublisherProps & {
  open: boolean
  supportsMultiEnvironment: boolean
  onOpenStateChange: (open: boolean) => void
}

export function PublisherContent({
  crossAxisOffset = 0,
  debugWithMultipleModel = false,
  disabled = false,
  draftUpdatedAt,
  hasHumanInputNode = false,
  hasTriggerNode = false,
  inputs,
  missingStartNode = false,
  multipleModelConfigs = [],
  onOpenStateChange,
  onPublish,
  onRefreshData,
  onRestore,
  onToggle,
  open,
  outputs,
  publishDisabled = false,
  publishedAt,
  startNodeLimitExceeded = false,
  supportsMultiEnvironment,
  toolPublished,
  workflowToolAvailable = true,
}: PublisherContentProps) {
  const { t } = useTranslation()
  const appDetail = useAppStore((state) => state.appDetail)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { formatTimeFromNow } = useFormatTimeFromNow()
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

  useRefreshAppEnvironmentsAfterPublisherDeploymentPolling(appDetail?.id)

  function closePublisher() {
    onOpenStateChange(false)
  }

  const publish = usePublishController({
    appId: appDetail?.id,
    appMode: appDetail?.mode,
    appName: appDetail?.name,
    onClose: closePublisher,
    onPublish,
    onRestore,
    publishDisabled,
    publishedAt,
    supportsMultiEnvironment,
  })

  function handleOpenChange(nextOpen: boolean) {
    if (disabled) {
      closePublisher()
      return
    }

    if (nextOpen) publish.resetPublished()
    onToggle?.(nextOpen)
    onOpenStateChange(nextOpen)
  }

  const workflowLaunch = useWorkflowLaunch(inputs)
  const marketplace = useMarketplacePublish(appDetail?.id)
  const versionInfo = useVersionInfo({
    appId: appDetail?.id,
    publishedWorkflow: publish.publishedWorkflow,
    onClosePublisher: closePublisher,
  })
  const workflowTool = useWorkflowTool({
    appDescription: appDetail?.description,
    appIcon: appDetail?.icon,
    appIconBackground: appDetail?.icon_background,
    appIconType: appDetail?.icon_type,
    appId: appDetail?.id,
    appMode: appDetail?.mode,
    appName: appDetail?.name,
    appPublished: publish.published,
    hasHumanInputNode,
    hasPublishedVersion: publish.hasPublishedVersion,
    hasTriggerNode,
    inputs,
    onClosePublisher: closePublisher,
    onPublish: publish.handlePublish,
    onRefreshData,
    outputs,
    toolPublished,
    workflowToolAvailable,
  })
  const { app_base_url: appBaseURL = '', access_token: accessToken = '' } = appDetail?.site ?? {}
  const appURL = getPublisherAppUrl({
    appBaseUrl: appBaseURL,
    accessToken,
    mode: appDetail?.mode,
  })
  const shouldLoadUserCanAccessApp = Boolean(
    appDetail?.id && open && systemFeatures.webapp_auth.enabled,
  )
  const { data: userCanAccessApp } = useGetUserCanAccessApp({
    appId: appDetail?.id,
    enabled: shouldLoadUserCanAccessApp,
  })
  const noAccessPermission = Boolean(
    systemFeatures.webapp_auth.enabled &&
    appDetail &&
    appDetail.access_mode !== AccessMode.EXTERNAL_MEMBERS &&
    !userCanAccessApp?.result,
  )
  const disabledFunctionButton =
    !publish.currentPublishedAt || missingStartNode || noAccessPermission
  const disabledFunctionTooltip = getDisabledFunctionTooltip({
    t,
    publishedAt: publish.currentPublishedAt,
    missingStartNode,
    noAccessPermission,
  })
  const latestPublishedVersion = publish.isPublishedWorkflowSuccess
    ? publish.publishedWorkflow
      ? toDeploymentVersion(
          publish.publishedWorkflow,
          t(($) => $['versionHistory.defaultName'], { ns: 'workflow' }),
          publish.publishedWorkflow.id,
        )
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
      <PublisherPanel
        builtInPublisher={{
          summary: {
            debugWithMultipleModel,
            draftUpdatedAt,
            environmentTabs,
            formatTimeFromNow,
            handlePublish: publish.handlePublish,
            handleRestore: publish.handleRestore,
            isChatApp: publish.isChatApp,
            isWorkflowApp: publish.isWorkflowApp,
            multipleModelConfigs,
            onEditVersion: versionInfo.openEditor,
            publishDisabled,
            published: publish.published,
            publishedAt: publish.currentPublishedAt,
            startNodeLimitExceeded,
            upgradeHighlightStyle,
            versionInfo: publish.publishedWorkflow,
          },
          actions: {
            appDetail,
            appURL,
            disabledFunctionButton,
            disabledFunctionTooltip,
            handleOpenRunConfig: workflowLaunch.openDialog,
            hasHumanInputNode,
            hasTriggerNode,
            marketplaceActionDisabled: !publish.currentPublishedAt,
            publishedAt: publish.currentPublishedAt,
            publishingToMarketplace: marketplace.isPublishing,
            showDeployAction: supportsMultiEnvironment,
            showMarketplaceAction: systemFeatures.enable_creators_platform,
            showRunConfig: workflowLaunch.hasHiddenVariables,
            toolPublished: workflowTool.published,
            workflowToolAvailable: workflowTool.availableForUser,
            workflowToolIsLoading: workflowTool.configuration.isLoading,
            workflowToolMessage: workflowTool.message,
            workflowToolOutdated: workflowTool.configuration.outdated,
            onConfigureWorkflowTool: workflowTool.openDrawer,
            onPublishToMarketplace: marketplace.publish,
          },
        }}
        crossAxisOffset={crossAxisOffset}
        disabled={disabled}
        environmentPublisher={{
          appId: appDetail?.id,
          deployment: selectedEnvironmentDeployment,
          environmentId: selectedEnvironmentId,
          environmentName:
            selectedEnvironment?.display_name ??
            selectedEnvironmentDeployment?.environment.display_name ??
            selectedEnvironmentId,
          environmentTabs,
          isEnvironmentInUse: selectedEnvironment?.in_use === true,
          isDeploymentError:
            isSelectedEnvironmentDeploymentError ||
            (selectedEnvironment?.in_use === false && publish.isPublishedWorkflowError),
          isDeploymentLoading:
            isSelectedEnvironmentDeploymentLoading ||
            (selectedEnvironment?.in_use === false && publish.isPublishedWorkflowLoading),
          latestVersion: latestPublishedVersion,
          onGoToPublish: () => selectEnvironment(BUILT_IN_ENVIRONMENT_ID),
        }}
        environmentPublisherKey={selectedEnvironmentId}
        open={open}
        showBuiltInPublisher={showBuiltInPublisher}
        workflowLaunch={{
          open: workflowLaunch.open,
          hiddenVariables: workflowLaunch.hiddenVariables,
          targetUrl: workflowLaunch.targetUrl,
          onOpenChange: workflowLaunch.onOpenChange,
        }}
        onOpenChange={handleOpenChange}
      />
      {versionInfo.isOpen && (
        <VersionInfoModal
          isOpen={versionInfo.isOpen}
          versionInfo={publish.publishedWorkflow ?? undefined}
          onClose={versionInfo.closeEditor}
          onPublish={versionInfo.updateVersionInfo}
        />
      )}
      {workflowTool.drawerOpen && workflowTool.canManageTools && (
        <WorkflowToolDrawer
          isAdd={!workflowTool.published}
          payload={workflowTool.configuration.payload}
          onHide={workflowTool.closeDrawer}
          onCreate={workflowTool.configuration.handleCreate}
          onSave={workflowTool.configuration.handleUpdate}
        />
      )}
    </>
  )
}
