import type { CSSProperties, ReactNode } from 'react'
import type { ModelAndParameter } from '../configuration/debug/types'
import type { AppPublisherProps } from './index'
import type { PublishWorkflowParams } from '@/types/workflow'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { AppModeEnum } from '@/types/app'
import { APP_PUBLISH_HOTKEY } from './hotkeys'
import PublishWithMultipleModel from './publish-with-multiple-model'
import SuggestedAction from './suggested-action'
import { ACCESS_MODE_MAP } from './utils'

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
  isChatApp: boolean
  published: boolean
  upgradeHighlightStyle: CSSProperties
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
  showDeployAction?: boolean
  showRunConfig?: boolean
  workflowToolIsLoading: boolean
  workflowToolMessage?: string
  workflowToolOutdated?: boolean
  onConfigureWorkflowTool: () => void
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

export const PublisherSummarySection = ({
  debugWithMultipleModel = false,
  draftUpdatedAt,
  formatTimeFromNow,
  handlePublish,
  handleRestore,
  isChatApp,
  multipleModelConfigs = [],
  publishDisabled = false,
  published,
  publishedAt,
  startNodeLimitExceeded = false,
  upgradeHighlightStyle,
}: SummarySectionProps) => {
  const { t } = useTranslation()

  return (
    <div className="p-4 pt-3">
      <div className="flex h-6 items-center system-xs-medium-uppercase text-text-tertiary">
        {publishedAt
          ? t(($) => $['common.latestPublished'], { ns: 'workflow' })
          : t(($) => $['common.currentDraftUnpublished'], { ns: 'workflow' })}
      </div>
      {publishedAt ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center system-sm-medium text-text-secondary">
            {t(($) => $['common.publishedAt'], { ns: 'workflow' })} {formatTimeFromNow(publishedAt)}
          </div>
          {isChatApp && (
            <Button
              variant="secondary-accent"
              size="small"
              onClick={handleRestore}
              disabled={published}
            >
              {t(($) => $['common.restore'], { ns: 'workflow' })}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center system-sm-medium text-text-secondary">
          {t(($) => $['common.autoSaved'], { ns: 'workflow' })} ·
          {Boolean(draftUpdatedAt) && formatTimeFromNow(draftUpdatedAt!)}
        </div>
      )}
      {debugWithMultipleModel ? (
        <PublishWithMultipleModel
          multipleModelConfigs={multipleModelConfigs}
          onSelect={(item) => handlePublish(item)}
        />
      ) : (
        <>
          <Button
            variant="primary"
            className="mt-3 w-full"
            onClick={() => handlePublish()}
            disabled={publishDisabled || published}
          >
            {published ? (
              t(($) => $['common.published'], { ns: 'workflow' })
            ) : (
              <div className="flex gap-1">
                <span>{t(($) => $['common.publishUpdate'], { ns: 'workflow' })}</span>
                <KbdGroup>
                  {APP_PUBLISH_HOTKEY.split('+').map((key) => (
                    <Kbd key={key} color="white">
                      {formatForDisplay(key)}
                    </Kbd>
                  ))}
                </KbdGroup>
              </div>
            )}
          </Button>
          {startNodeLimitExceeded && (
            <div className="mt-3 flex flex-col items-stretch">
              <p className="text-sm/5 font-semibold text-transparent" style={upgradeHighlightStyle}>
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

const ActionTooltip = ({
  disabled,
  tooltip,
  children,
}: {
  disabled: boolean
  tooltip?: ReactNode
  children: ReactNode
}) => {
  if (!tooltip) return <>{children}</>

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className={cn('flex w-full', disabled && 'cursor-not-allowed *:pointer-events-none')}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent role="tooltip">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

const WorkflowToolActionStatus = ({
  isLoading,
  outdated,
  published,
}: {
  isLoading: boolean
  outdated: boolean
  published: boolean
}) => {
  const { t } = useTranslation()

  if (!published)
    return (
      <span
        role="status"
        aria-label={t(($) => $['common.configureRequired'], { ns: 'workflow' })}
        className="rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase whitespace-nowrap text-text-tertiary"
      >
        {t(($) => $['common.configureRequired'], { ns: 'workflow' })}
      </span>
    )

  if (isLoading)
    return (
      <span
        role="status"
        aria-label={t(($) => $.loading, { ns: 'appApi' })}
        className="i-ri-loader-2-line size-4 animate-spin motion-reduce:animate-none"
      />
    )

  return (
    <span className="relative flex size-4 items-center justify-center">
      <span aria-hidden className="i-ri-equalizer-2-line size-3.5" />
      {outdated && (
        <StatusDot
          role="status"
          aria-label={t(($) => $['common.workflowAsToolTip'], { ns: 'workflow' })}
          className="absolute -top-1 -right-1"
          size="small"
          status="warning"
        />
      )}
    </span>
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
  publishedAt,
  showDeployAction = false,
  showRunConfig = false,
  toolPublished = false,
  workflowToolAvailable = true,
  workflowToolIsLoading,
  workflowToolMessage,
  workflowToolOutdated = false,
  onConfigureWorkflowTool,
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
  const workflowToolDescription =
    workflowToolMessage ??
    (toolPublished && workflowToolOutdated
      ? t(($) => $['common.workflowAsToolTip'], { ns: 'workflow' })
      : t(($) => $['common.workflowAsToolDescription'], { ns: 'workflow' }))
  const workflowToolTooltip =
    workflowToolMessage ?? (workflowToolOutdated ? workflowToolDescription : undefined)

  return (
    <div className="flex flex-col border-t-[0.5px] border-t-divider-regular p-2">
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
      {showWorkflowTool && (
        <ActionTooltip disabled={workflowToolDisabled} tooltip={workflowToolTooltip}>
          <SuggestedAction
            className="flex-1"
            disabled={workflowToolDisabled}
            description={workflowToolDescription}
            focusableWhenDisabled={Boolean(workflowToolTooltip)}
            endIcon={
              <WorkflowToolActionStatus
                isLoading={workflowToolIsLoading}
                outdated={workflowToolOutdated}
                published={toolPublished}
              />
            }
            icon={<span className="i-ri-hammer-line size-4" />}
            onClick={onConfigureWorkflowTool}
          >
            {t(($) => $['common.workflowAsTool'], { ns: 'workflow' })}
          </SuggestedAction>
        </ActionTooltip>
      )}
    </div>
  )
}
