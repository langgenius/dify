import type { AppPublisherProps } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { AppModeEnum } from '@/types/app'
import SuggestedAction from '../suggested-action'
import WorkflowToolAction from '../workflow-tool-action'

type PublisherActionsSectionProps = Pick<
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

export function PublisherActionsSection({
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
}: PublisherActionsSectionProps) {
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
        <Tooltip disabled={!disabledFunctionTooltip}>
          <TooltipTrigger
            render={
              <div
                className={cn(
                  'flex w-full',
                  disabledFunctionButton && 'cursor-not-allowed *:pointer-events-none',
                )}
              />
            }
          >
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
          </TooltipTrigger>
          <TooltipContent role="tooltip">{disabledFunctionTooltip}</TooltipContent>
        </Tooltip>
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
