import type { FC } from 'react'
import type { AppPublisherMenuContentProps } from './menu-content.types'
import Divider from '../../base/divider'
import Loading from '../../base/loading'
import MenuContentAccessSection from './menu-content-access-section'
import MenuContentActionsSection from './menu-content-actions-section'
import MenuContentMarketplaceSection from './menu-content-marketplace-section'
import MenuContentPublishSection from './menu-content-publish-section'

const AppPublisherMenuContent: FC<AppPublisherMenuContentProps> = ({
  appDetail,
  appURL,
  debugWithMultipleModel = false,
  disabledFunctionButton,
  disabledFunctionTooltip,
  draftUpdatedAt,
  formatTimeFromNow,
  hasHumanInputNode = false,
  hasTriggerNode = false,
  inputs,
  isAppAccessSet,
  isChatApp,
  isGettingAppWhiteListSubjects,
  isGettingUserCanAccessApp,
  missingStartNode = false,
  multipleModelConfigs = [],
  onOpenEmbedding,
  onOpenInExplore,
  onPublish,
  onPublishToMarketplace,
  onRefreshData,
  onRestore,
  onShowAppAccessControl,
  outputs,
  publishDisabled = false,
  published,
  publishedAt,
  publishingToMarketplace,
  publishLoading = false,
  startNodeLimitExceeded = false,
  systemFeatures,
  toolPublished,
  upgradeHighlightStyle,
  workflowToolAvailable: _workflowToolAvailable = true,
  workflowToolDisabled,
  workflowToolMessage,
}) => {
  const showAccessLoading = systemFeatures.webapp_auth.enabled
    && (isGettingUserCanAccessApp || isGettingAppWhiteListSubjects)

  return (
    <div className="w-[320px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5">
      <MenuContentPublishSection
        debugWithMultipleModel={debugWithMultipleModel}
        draftUpdatedAt={draftUpdatedAt}
        formatTimeFromNow={formatTimeFromNow}
        isChatApp={isChatApp}
        multipleModelConfigs={multipleModelConfigs}
        onPublish={onPublish}
        onRestore={onRestore}
        publishDisabled={publishDisabled}
        published={published}
        publishedAt={publishedAt}
        publishLoading={publishLoading}
        startNodeLimitExceeded={startNodeLimitExceeded}
        upgradeHighlightStyle={upgradeHighlightStyle}
      />
      {showAccessLoading
        ? <div className="py-2"><Loading /></div>
        : (
            <>
              <Divider className="my-0" />
              <MenuContentAccessSection
                appDetail={appDetail}
                isAppAccessSet={isAppAccessSet}
                onShowAppAccessControl={onShowAppAccessControl}
                systemFeatures={systemFeatures}
              />
              <MenuContentActionsSection
                appDetail={appDetail}
                appURL={appURL}
                disabledFunctionButton={disabledFunctionButton}
                disabledFunctionTooltip={disabledFunctionTooltip}
                hasHumanInputNode={hasHumanInputNode}
                hasTriggerNode={hasTriggerNode}
                inputs={inputs}
                missingStartNode={missingStartNode}
                onOpenEmbedding={onOpenEmbedding}
                onOpenInExplore={onOpenInExplore}
                onPublish={onPublish}
                onRefreshData={onRefreshData}
                outputs={outputs}
                published={published}
                publishedAt={publishedAt}
                toolPublished={toolPublished}
                workflowToolDisabled={workflowToolDisabled}
                workflowToolMessage={workflowToolMessage}
              />
              <MenuContentMarketplaceSection
                onPublishToMarketplace={onPublishToMarketplace}
                publishingToMarketplace={publishingToMarketplace}
                systemFeatures={systemFeatures}
              />
            </>
          )}
    </div>
  )
}

export default AppPublisherMenuContent
