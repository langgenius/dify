import type { ModelAndParameter } from '../configuration/debug/types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import type { PublishWorkflowParams } from '@/types/workflow'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import EmbeddedModal from '@/app/components/app/overview/embedded'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import AccessControl from '../app-access-control'
import AppPublisherMenuContent from './menu-content'
import { useAppPublisher } from './use-app-publisher'

export type AppPublisherProps = {
  disabled?: boolean
  publishDisabled?: boolean
  publishedAt?: number
  /** only needed in workflow / chatflow mode */
  draftUpdatedAt?: number
  debugWithMultipleModel?: boolean
  multipleModelConfigs?: ModelAndParameter[]
  /** modelAndParameter is passed when debugWithMultipleModel is true */
  onPublish?: (params?: ModelAndParameter | PublishWorkflowParams) => Promise<void> | void
  onRestore?: () => Promise<void> | void
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
  publishLoading?: boolean
  hasHumanInputNode?: boolean
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
  publishLoading = false,
  hasHumanInputNode = false,
}: AppPublisherProps) => {
  const { t } = useTranslation()
  const state = useAppPublisher({
    disabled,
    publishDisabled,
    publishedAt,
    draftUpdatedAt,
    debugWithMultipleModel,
    multipleModelConfigs,
    onPublish,
    onRestore,
    onToggle,
    crossAxisOffset,
    toolPublished,
    inputs,
    outputs,
    onRefreshData,
    workflowToolAvailable,
    missingStartNode,
    hasTriggerNode,
    startNodeLimitExceeded,
    publishLoading,
    hasHumanInputNode,
  })

  return (
    <>
      <PortalToFollowElem
        open={state.open}
        onOpenChange={state.setOpen}
        placement="bottom-end"
        offset={{
          mainAxis: 4,
          crossAxis: state.crossAxisOffset,
        }}
      >
        <PortalToFollowElemTrigger onClick={state.handleTrigger}>
          <Button
            variant="primary"
            className="py-2 pl-3 pr-2"
            disabled={state.disabled || state.publishLoading}
            loading={state.publishLoading}
          >
            {t('common.publish', { ns: 'workflow' })}
            <span className="i-ri-arrow-down-s-line h-4 w-4 text-components-button-primary-text" />
          </Button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-[11]">
          <AppPublisherMenuContent
            publishedAt={state.publishedAt}
            draftUpdatedAt={state.draftUpdatedAt}
            debugWithMultipleModel={state.debugWithMultipleModel}
            multipleModelConfigs={state.multipleModelConfigs}
            publishDisabled={state.publishDisabled}
            publishLoading={state.publishLoading}
            toolPublished={state.toolPublished}
            inputs={state.inputs}
            outputs={state.outputs}
            onRefreshData={state.onRefreshData}
            workflowToolAvailable={state.workflowToolAvailable}
            hasTriggerNode={state.hasTriggerNode}
            missingStartNode={state.missingStartNode}
            startNodeLimitExceeded={state.startNodeLimitExceeded}
            hasHumanInputNode={state.hasHumanInputNode}
            appDetail={state.appDetail}
            appURL={state.appURL}
            disabledFunctionButton={state.disabledFunctionButton}
            disabledFunctionTooltip={state.disabledFunctionTooltip}
            formatTimeFromNow={state.formatTimeFromNow}
            isAppAccessSet={state.isAppAccessSet}
            isChatApp={state.isChatApp}
            isGettingAppWhiteListSubjects={state.isGettingAppWhiteListSubjects}
            isGettingUserCanAccessApp={state.isGettingUserCanAccessApp}
            onOpenEmbedding={state.handleOpenEmbedding}
            onOpenInExplore={state.handleOpenInExplore}
            onPublish={state.handlePublish}
            onPublishToMarketplace={state.handlePublishToMarketplace}
            onRestore={state.handleRestore}
            onShowAppAccessControl={state.showAppAccessControlModal}
            published={state.published}
            publishingToMarketplace={state.publishingToMarketplace}
            systemFeatures={state.systemFeatures}
            upgradeHighlightStyle={state.upgradeHighlightStyle}
            workflowToolDisabled={state.workflowToolDisabled}
            workflowToolMessage={state.workflowToolMessage}
          />
        </PortalToFollowElemContent>
        <EmbeddedModal
          siteInfo={state.appDetail?.site}
          isShow={state.embeddingModalOpen}
          onClose={state.closeEmbeddingModal}
          appBaseUrl={state.appBaseURL}
          accessToken={state.accessToken}
        />
        {state.showAppAccessControl && state.appDetail && (
          <AccessControl
            app={state.appDetail}
            onConfirm={state.handleAccessControlUpdate}
            onClose={state.closeAppAccessControl}
          />
        )}
      </PortalToFollowElem>
    </>
  )
}

export default memo(AppPublisher)
