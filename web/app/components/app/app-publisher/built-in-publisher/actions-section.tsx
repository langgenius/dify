import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { AppPublisherProps } from '../types'
import type { WorkflowKind } from '@/types/workflow'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import SuggestedAction from '../suggested-action'
import WorkflowToolAction from '../workflow-tool-action'

type PublisherActionsSectionProps = Pick<
  AppPublisherProps,
  | 'hasHumanInputNode'
  | 'hasTriggerNode'
  | 'onConvertWorkflowKind'
  | 'onPublishEvaluation'
  | 'publishedAt'
  | 'toolPublished'
  | 'workflowKindChangePending'
  | 'workflowToolAvailable'
> & {
  appId: string
  appMode: AppDetailWithSite['mode']
  appURL: string
  canViewAccessPoint: boolean
  disabledFunctionButton: boolean
  disabledFunctionTooltip?: string
  handleOpenRunConfig?: (url: string) => void
  marketplaceActionDisabled?: boolean
  publishingToMarketplace?: boolean
  published?: boolean
  showDeployAction?: boolean
  showMarketplaceAction?: boolean
  showRunConfig?: boolean
  workflowToolIsLoading: boolean
  workflowToolMessage?: string
  workflowToolOutdated?: boolean
  workflowKind?: string | null
  onConfigureWorkflowTool: () => void
  onPublishToMarketplace?: () => void
}

export function PublisherActionsSection({
  appId,
  appMode,
  appURL,
  canViewAccessPoint,
  disabledFunctionButton,
  disabledFunctionTooltip,
  handleOpenRunConfig,
  hasHumanInputNode = false,
  hasTriggerNode = false,
  marketplaceActionDisabled = false,
  onConvertWorkflowKind,
  onPublishEvaluation,
  publishedAt,
  published = false,
  publishingToMarketplace = false,
  showDeployAction = false,
  showMarketplaceAction = false,
  showRunConfig = false,
  toolPublished = false,
  workflowToolAvailable = true,
  workflowToolIsLoading,
  workflowToolMessage,
  workflowToolOutdated = false,
  workflowKind,
  workflowKindChangePending = false,
  onConfigureWorkflowTool,
  onPublishToMarketplace,
}: PublisherActionsSectionProps) {
  const { t } = useTranslation(['common', 'workflow'])

  const hasPublishedVersion = Boolean(publishedAt)
  const showOpenWebApp = !hasTriggerNode
  const showWorkflowTool = appMode === 'workflow' && !hasHumanInputNode && !hasTriggerNode
  const navigationDisabled = !hasPublishedVersion
  const workflowToolDisabled =
    !hasPublishedVersion || !workflowToolAvailable || (toolPublished && workflowToolIsLoading)
  const isEvaluationWorkflow = workflowKind === 'evaluation'
  const evaluationTargetKind: WorkflowKind = isEvaluationWorkflow ? 'standard' : 'evaluation'
  const showEvaluationWorkflowAction =
    appMode === 'workflow' &&
    (hasPublishedVersion ? Boolean(onConvertWorkflowKind) : Boolean(onPublishEvaluation))
  const evaluationWorkflowActionLabel = !hasPublishedVersion
    ? t(($) => $['common.publishAsEvaluationWorkflow'], { ns: 'workflow' })
    : isEvaluationWorkflow
      ? t(($) => $['common.switchToStandardWorkflow'], { ns: 'workflow' })
      : t(($) => $['common.switchToEvaluationWorkflow'], { ns: 'workflow' })

  const handleEvaluationWorkflowAction = () => {
    if (workflowKindChangePending || published) return

    const action = hasPublishedVersion
      ? onConvertWorkflowKind?.(evaluationTargetKind)
      : onPublishEvaluation?.()
    void Promise.resolve(action).catch(() => undefined)
  }

  return (
    <div className="flex flex-col border-t-[0.5px] border-t-divider-regular p-3">
      {showEvaluationWorkflowAction && (
        <>
          <SuggestedAction
            disabled={workflowKindChangePending || published}
            endIcon={
              workflowKindChangePending ? (
                <span aria-hidden className="i-ri-loader-2-line size-3.5 animate-spin" />
              ) : (
                <span aria-hidden className="i-ri-arrow-right-s-line size-3.5" />
              )
            }
            icon={
              <span
                className={
                  isEvaluationWorkflow ? 'i-ri-node-tree size-4' : 'i-ri-flask-line size-4'
                }
              />
            }
            onClick={handleEvaluationWorkflowAction}
          >
            {evaluationWorkflowActionLabel}
          </SuggestedAction>
          <div aria-hidden className="m-1 h-px bg-divider-subtle" />
        </>
      )}
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
          <TooltipContent>{disabledFunctionTooltip}</TooltipContent>
        </Tooltip>
      )}
      {canViewAccessPoint && (
        <SuggestedAction
          disabled={navigationDisabled}
          description={t(($) => $['common.accessPointDescription'], { ns: 'workflow' })}
          link={`/app/${appId}/access-point`}
          icon={<span className="i-custom-vender-agent-v2-access-point size-4" />}
        >
          {t(($) => $['appMenus.accessPoint'], { ns: 'common' })}
        </SuggestedAction>
      )}
      {showDeployAction && (
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
