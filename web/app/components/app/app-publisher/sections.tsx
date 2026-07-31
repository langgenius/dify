import type { CSSProperties, ReactNode } from 'react'
import type { ModelAndParameter } from '../configuration/debug/types'
import type { AppPublisherProps } from './index'
import type { PublishWorkflowParams, VersionHistory } from '@/types/workflow'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { AppModeEnum } from '@/types/app'
import ActionTooltip from './action-tooltip'
import { APP_PUBLISH_HOTKEY } from './hotkeys'
import PublishWithMultipleModel from './publish-with-multiple-model'
import SuggestedAction from './suggested-action'
import { ACCESS_MODE_MAP } from './utils'
import WorkflowToolAction from './workflow-tool-action'

type SummarySectionProps = Pick<
  AppPublisherProps,
  | 'debugWithMultipleModel'
  | 'draftUpdatedAt'
  | 'multipleModelConfigs'
  | 'publishDisabled'
  | 'publishedAt'
  | 'startNodeLimitExceeded'
> & {
  formatTimeFromNow: (value: number) => string
  handlePublish: (params?: ModelAndParameter | PublishWorkflowParams) => Promise<void>
  handleRestore: () => Promise<void>
  environmentTabs?: ReactNode
  hasUnpublishedChanges?: boolean
  isChatApp: boolean
  isWorkflowApp?: boolean
  onEditVersion?: () => void
  upgradeHighlightStyle: CSSProperties
  versionInfo?: VersionHistory | null
}

type AccessSectionProps = {
  enabled: boolean
  isAppAccessSet: boolean
  isLoading: boolean
  accessMode?: keyof typeof ACCESS_MODE_MAP
  onClick: () => void
}

type ActionsSectionProps = Pick<
  AppPublisherProps,
  'hasHumanInputNode' | 'hasTriggerNode' | 'publishedAt' | 'toolPublished' | 'workflowToolAvailable'
> & {
  appDetail:
    | {
        id?: string
        icon?: string
        icon_type?: string | null
        icon_background?: string | null
        description?: string
        mode?: AppModeEnum
        name?: string
      }
    | null
    | undefined
  appURL: string
  disabledFunctionButton: boolean
  disabledFunctionTooltip?: string
  handleOpenRunConfig?: (url: string) => void
  marketplaceActionDisabled?: boolean
  publishingToMarketplace?: boolean
  showDeployAction?: boolean
  showMarketplaceAction?: boolean
  showRunConfig?: boolean
  workflowToolIsLoading: boolean
  workflowToolMessage?: string
  workflowToolOutdated?: boolean
  onConfigureWorkflowTool: () => void
  onPublishToMarketplace?: () => void
}

export const AccessModeDisplay = ({ mode }: { mode?: keyof typeof ACCESS_MODE_MAP }) => {
  const { t } = useTranslation()

  if (!mode || !ACCESS_MODE_MAP[mode]) return null

  const { icon, label } = ACCESS_MODE_MAP[mode]

  return (
    <>
      <span className={`${icon} size-4 shrink-0 text-text-secondary`} />
      <div className="grow truncate">
        <span className="system-sm-medium text-text-secondary">
          {t(($) => $[`accessControlDialog.accessItems.${label}`], { ns: 'app' })}
        </span>
      </div>
    </>
  )
}

export const PublisherTimelineMarker = ({ position }: { position: 'top' | 'bottom' }) => (
  <span
    className={cn(
      'relative flex w-4 shrink-0 items-start p-1',
      position === 'top' ? 'self-stretch' : 'h-4',
    )}
  >
    <span
      aria-hidden
      className="relative z-1 size-2 rounded-full border-2 border-text-quaternary bg-components-panel-bg"
    />
    <span
      aria-hidden
      className={cn(
        'absolute left-1/2 w-0.5 -translate-x-1/2 bg-divider-subtle',
        position === 'top' ? 'top-3.5 -bottom-3.5' : '-top-3.5 h-4',
      )}
    />
  </span>
)

export const PublisherSummarySection = ({
  debugWithMultipleModel = false,
  draftUpdatedAt,
  environmentTabs,
  formatTimeFromNow,
  handlePublish,
  handleRestore,
  hasUnpublishedChanges,
  isChatApp,
  isWorkflowApp = false,
  multipleModelConfigs = [],
  onEditVersion,
  publishDisabled = false,
  publishedAt,
  startNodeLimitExceeded = false,
  upgradeHighlightStyle,
  versionInfo,
}: SummarySectionProps) => {
  const { t } = useTranslation()
  const hasPublishedVersion = Boolean(publishedAt)
  const resolvedHasUnpublishedChanges = hasUnpublishedChanges ?? !hasPublishedVersion
  const publishedTimestamp =
    publishedAt || (versionInfo?.created_at ? versionInfo.created_at * 1000 : undefined)
  const publisherName = versionInfo?.created_by.name
  const markedName = versionInfo?.marked_name
  const markedComment = versionInfo?.marked_comment
  const publishButtonDisabled =
    publishDisabled || (hasPublishedVersion && !resolvedHasUnpublishedChanges)
  const publishButtonLabel = !hasPublishedVersion
    ? t(($) => $['common.publish'], { ns: 'workflow' })
    : resolvedHasUnpublishedChanges
      ? t(($) => $['common.publishUpdate'], { ns: 'workflow' })
      : t(($) => $['common.published'], { ns: 'workflow' })

  return (
    <div className="flex flex-col gap-3 p-4">
      {environmentTabs}
      <div className="flex items-start gap-1 px-1 py-0.5">
        <PublisherTimelineMarker position="top" />
        {!hasPublishedVersion ? (
          <p className="min-w-0 flex-1 system-xs-regular text-text-tertiary">
            {t(($) => $['common.notPublishedYet'], { ns: 'workflow' })}
          </p>
        ) : isWorkflowApp ? (
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-h-4 min-w-0 items-center gap-1">
              <span className="truncate system-sm-semibold text-text-secondary">
                {markedName || versionInfo?.version}
              </span>
              <span aria-hidden className="system-xs-regular text-text-tertiary">
                ·
              </span>
              {markedName ? (
                <button
                  type="button"
                  className="flex size-4 shrink-0 items-center justify-center rounded text-text-tertiary outline-hidden hover:text-text-accent focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  aria-label={t(($) => $['versionHistory.editVersionInfo'], { ns: 'workflow' })}
                  disabled={!versionInfo || !onEditVersion}
                  onClick={onEditVersion}
                >
                  <span aria-hidden className="i-ri-edit-line size-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1 rounded text-text-accent outline-hidden hover:text-text-accent-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-wait"
                  disabled={!versionInfo || !onEditVersion}
                  onClick={onEditVersion}
                >
                  <span aria-hidden className="i-ri-edit-line size-3.5 shrink-0" />
                  <span className="truncate system-xs-medium">
                    {t(($) => $['versionHistory.nameIt'], { ns: 'workflow' })}
                  </span>
                </button>
              )}
            </div>
            {markedComment && (
              <>
                <p className="line-clamp-3 system-xs-regular wrap-break-word text-text-tertiary">
                  {markedComment}
                </p>
                <span aria-hidden className="my-1 h-px w-4 bg-divider-regular" />
              </>
            )}
            {publishedTimestamp && (
              <p className="system-xs-regular text-text-tertiary">
                {publisherName
                  ? t(($) => $['common.publishedBy'], {
                      ns: 'workflow',
                      time: formatTimeFromNow(publishedTimestamp),
                      author: publisherName,
                    })
                  : `${t(($) => $['common.publishedAt'], { ns: 'workflow' })} ${formatTimeFromNow(publishedTimestamp)}`}
              </p>
            )}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col">
              <p className="truncate system-sm-semibold text-text-secondary">
                {t(($) => $['common.latestPublished'], { ns: 'workflow' })}
              </p>
              {publishedTimestamp && (
                <p className="truncate system-xs-regular text-text-tertiary">
                  {publisherName
                    ? t(($) => $['common.publishedBy'], {
                        ns: 'workflow',
                        time: formatTimeFromNow(publishedTimestamp),
                        author: publisherName,
                      })
                    : `${t(($) => $['common.publishedAt'], { ns: 'workflow' })} ${formatTimeFromNow(publishedTimestamp)}`}
                </p>
              )}
            </div>
            {isChatApp && (
              <Button
                variant="secondary"
                size="small"
                className="h-6 shrink-0 gap-1"
                onClick={handleRestore}
                disabled={!resolvedHasUnpublishedChanges}
              >
                <span aria-hidden className="i-ri-reset-left-line size-3.5" />
                {t(($) => $['common.restore'], { ns: 'workflow' })}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex w-full flex-col">
        {debugWithMultipleModel ? (
          <PublishWithMultipleModel
            disabled={publishDisabled}
            multipleModelConfigs={multipleModelConfigs}
            onSelect={(item) => handlePublish(item)}
          />
        ) : (
          <>
            <Button
              variant="primary"
              className="w-full"
              onClick={() => handlePublish()}
              disabled={publishButtonDisabled}
            >
              {publishDisabled ? (
                publishButtonLabel
              ) : (
                <span className="flex items-center gap-1">
                  <span>{publishButtonLabel}</span>
                  <KbdGroup aria-hidden>
                    {APP_PUBLISH_HOTKEY.split('+').map((key) => (
                      <Kbd key={key} color="white" disabled={publishButtonDisabled}>
                        {formatForDisplay(key)}
                      </Kbd>
                    ))}
                  </KbdGroup>
                </span>
              )}
            </Button>
            {startNodeLimitExceeded && (
              <div className="mt-3 flex flex-col items-stretch">
                <p
                  className="text-sm/5 font-semibold text-transparent"
                  style={upgradeHighlightStyle}
                >
                  <span className="block">
                    {t(($) => $['publishLimit.startNodeTitlePrefix'], { ns: 'workflow' })}
                  </span>
                  <span className="block">
                    {t(($) => $['publishLimit.startNodeTitleSuffix'], { ns: 'workflow' })}
                  </span>
                </p>
                <p className="mt-1 text-xs/4 text-text-secondary">
                  {t(($) => $['publishLimit.startNodeDesc'], { ns: 'workflow' })}
                </p>
                <UpgradeBtn isShort className="mt-2.25 mb-3 h-8 w-23.25 self-start" />
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-1 py-0.5 pr-0.5 pl-1">
        <PublisherTimelineMarker position="bottom" />
        <p className="min-w-0 flex-1 truncate system-xs-regular text-text-tertiary">
          {resolvedHasUnpublishedChanges ? (
            <>
              {t(($) => $['common.unpublishedChanges'], { ns: 'workflow' })}
              {isWorkflowApp && Boolean(draftUpdatedAt) && (
                <>
                  {' · '}
                  {t(($) => $['common.savedAt'], {
                    ns: 'workflow',
                    time: formatTimeFromNow(draftUpdatedAt!),
                  })}
                </>
              )}
            </>
          ) : (
            t(($) => $['common.noChanges'], { ns: 'workflow' })
          )}
        </p>
      </div>
    </div>
  )
}

export const PublisherAccessSection = ({
  enabled,
  isAppAccessSet,
  isLoading,
  accessMode,
  onClick,
}: AccessSectionProps) => {
  const { t } = useTranslation()

  if (isLoading)
    return (
      <div className="py-2">
        <Loading />
      </div>
    )

  return (
    <>
      <Divider className="my-0" />
      {enabled && (
        <div className="p-4 pt-3">
          <div className="flex h-6 items-center">
            <p className="system-xs-medium text-text-tertiary">
              {t(($) => $['publishApp.title'], { ns: 'app' })}
            </p>
          </div>
          <button
            type="button"
            className="flex h-8 w-full cursor-pointer items-center gap-x-0.5 rounded-lg border-0 bg-components-input-bg-normal py-1 pr-2 pl-2.5 text-left outline-hidden hover:bg-primary-50 hover:text-text-accent focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={onClick}
          >
            <div className="flex grow items-center gap-x-1.5 overflow-hidden pr-1">
              <AccessModeDisplay mode={accessMode} />
            </div>
            {!isAppAccessSet && (
              <p className="shrink-0 system-xs-regular text-text-tertiary">
                {t(($) => $['publishApp.notSet'], { ns: 'app' })}
              </p>
            )}
            <div className="flex size-4 shrink-0 items-center justify-center">
              <span className="i-ri-arrow-right-s-line size-4 text-text-quaternary" />
            </div>
          </button>
          {!isAppAccessSet && (
            <p className="mt-1 system-xs-regular text-text-warning">
              {t(($) => $['publishApp.notSetDesc'], { ns: 'app' })}
            </p>
          )}
        </div>
      )}
    </>
  )
}

export const PublisherActionsSection = ({
  appDetail,
  appURL,
  disabledFunctionButton,
  disabledFunctionTooltip,
  handleOpenRunConfig,
  hasHumanInputNode = false,
  hasTriggerNode = false,
  marketplaceActionDisabled = false,
  publishedAt,
  publishingToMarketplace = false,
  showDeployAction = false,
  showMarketplaceAction = false,
  showRunConfig = false,
  toolPublished = false,
  workflowToolAvailable = true,
  workflowToolIsLoading,
  workflowToolMessage,
  workflowToolOutdated = false,
  onConfigureWorkflowTool,
  onPublishToMarketplace,
}: ActionsSectionProps) => {
  const { t } = useTranslation()

  const appId = appDetail?.id
  const hasPublishedVersion = Boolean(publishedAt)
  const showOpenWebApp = !hasTriggerNode
  const showDeploy = Boolean(showDeployAction && appId)
  const showWorkflowTool =
    appDetail?.mode === AppModeEnum.WORKFLOW && !hasHumanInputNode && !hasTriggerNode
  const navigationDisabled = !hasPublishedVersion || !appId
  const workflowToolDisabled =
    !hasPublishedVersion || !workflowToolAvailable || (toolPublished && workflowToolIsLoading)

  return (
    <div className="flex flex-col border-t-[0.5px] border-t-divider-regular p-3">
      {showOpenWebApp && (
        <ActionTooltip disabled={disabledFunctionButton} tooltip={disabledFunctionTooltip}>
          <SuggestedAction
            className="flex-1"
            disabled={disabledFunctionButton}
            description={
              disabledFunctionButton && disabledFunctionTooltip
                ? disabledFunctionTooltip
                : t(($) => $['common.openWebAppDescription'], { ns: 'workflow' })
            }
            external
            focusableWhenDisabled={Boolean(disabledFunctionTooltip)}
            link={appURL}
            icon={<span className="i-ri-planet-line size-4" />}
            actionButton={
              showRunConfig && handleOpenRunConfig
                ? {
                    ariaLabel: t(($) => $['operation.config'], { ns: 'common' }),
                    icon: <span className="i-ri-settings-2-line size-4" />,
                    onClick: () => handleOpenRunConfig(appURL),
                  }
                : undefined
            }
          >
            {t(($) => $['common.openWebApp'], { ns: 'workflow' })}
          </SuggestedAction>
        </ActionTooltip>
      )}
      <SuggestedAction
        disabled={navigationDisabled}
        description={t(($) => $['common.accessPointDescription'], { ns: 'workflow' })}
        link={appId ? `/app/${appId}/access-point` : undefined}
        icon={<span className="i-custom-vender-agent-v2-access-point size-4" />}
      >
        {t(($) => $['appMenus.accessPoint'], { ns: 'common' })}
      </SuggestedAction>
      {showDeploy && (
        <SuggestedAction
          disabled={navigationDisabled}
          description={t(($) => $['common.deployDescription'], { ns: 'workflow' })}
          link={`/app/${appId}/deploy`}
          icon={<span className="i-ri-instance-line size-4" />}
        >
          {t(($) => $['appMenus.deploy'], { ns: 'common' })}
        </SuggestedAction>
      )}
      {showMarketplaceAction && (
        <SuggestedAction
          disabled={marketplaceActionDisabled || publishingToMarketplace || !onPublishToMarketplace}
          description={t(($) => $['common.publishToMarketplaceDescription'], {
            ns: 'workflow',
          })}
          icon={<span className="i-ri-store-2-line size-4" />}
          onClick={onPublishToMarketplace}
        >
          {publishingToMarketplace
            ? t(($) => $['common.publishingToMarketplace'], { ns: 'workflow' })
            : t(($) => $['common.publishToMarketplace'], { ns: 'workflow' })}
        </SuggestedAction>
      )}
      {showWorkflowTool && (
        <>
          <div aria-hidden className="m-1 h-px bg-divider-subtle" />
          <WorkflowToolAction
            disabled={workflowToolDisabled}
            isLoading={workflowToolIsLoading}
            message={workflowToolMessage}
            outdated={workflowToolOutdated}
            published={toolPublished}
            onConfigure={onConfigureWorkflowTool}
          />
        </>
      )}
    </div>
  )
}
