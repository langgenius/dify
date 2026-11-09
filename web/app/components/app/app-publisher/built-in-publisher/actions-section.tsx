import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { AppPublisherProps } from '../types'
import type { WorkflowKind } from '@/types/workflow'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import SuggestedAction from '../suggested-action'
import WorkflowToolAction from '../workflow-tool-action'

type PublisherActionsSectionProps = Pick<
  AppPublisherProps,
  | 'hasTriggerNode'
  | 'onConvertWorkflowKind'
  | 'onPublishEvaluation'
  | 'publishedAt'
  | 'toolPublished'
  | 'workflowKindChangePending'
  | 'workflowToolAvailable'
> & {
  appDetail?: Pick<AppDetailWithSite, 'mode' | 'workflow_kind'>
  appId: string
  appURL: string
  canViewAccessPoint: boolean
  disabledFunctionButton: boolean
  disabledFunctionTooltip?: string
  handleOpenRunConfig?: (url: string) => void
  marketplaceActionDisabled?: boolean
  publishingToMarketplace?: boolean
  published?: boolean
  isPublishing?: boolean
  showDeployAction?: boolean
  showMarketplaceAction?: boolean
  showRunConfig?: boolean
  showWorkflowTool: boolean
  workflowToolIsLoading: boolean
  workflowToolMessage?: string
  workflowToolOutdated?: boolean
  workflowKind?: string | null
  onConfigureWorkflowTool: () => void
  onPublishToMarketplace?: () => void
}

export function PublisherActionsSection({
  appDetail,
  appId,
  appURL,
  canViewAccessPoint,
  disabledFunctionButton,
  disabledFunctionTooltip,
  handleOpenRunConfig,
  hasTriggerNode = false,
  marketplaceActionDisabled = false,
  onConvertWorkflowKind,
  onPublishEvaluation,
  publishedAt,
  published = false,
  isPublishing = false,
  publishingToMarketplace = false,
  showDeployAction = false,
  showMarketplaceAction = false,
  showRunConfig = false,
  showWorkflowTool,
  toolPublished = false,
  workflowToolAvailable = true,
  workflowToolIsLoading,
  workflowToolMessage,
  workflowToolOutdated = false,
  workflowKindChangePending = false,
  onConfigureWorkflowTool,
  onPublishToMarketplace,
}: PublisherActionsSectionProps) {
  const { t } = useTranslation(['common', 'workflow'])

  const hasPublishedVersion = Boolean(publishedAt)
  const showOpenWebApp = !hasTriggerNode
  const navigationDisabled = !hasPublishedVersion
  const workflowToolDisabled =
    !hasPublishedVersion || !workflowToolAvailable || (toolPublished && workflowToolIsLoading)
  const isEvaluationWorkflow = appDetail?.workflow_kind === 'evaluation'
  const evaluationTargetKind: WorkflowKind = isEvaluationWorkflow ? 'standard' : 'evaluation'
  const showEvaluationWorkflowAction =
    appDetail?.mode === 'workflow' &&
    (hasPublishedVersion ? Boolean(onConvertWorkflowKind) : Boolean(onPublishEvaluation))
  const evaluationWorkflowActionLabel = !hasPublishedVersion
    ? t(($) => $['common.publishAsEvaluationWorkflow'], { ns: 'workflow' })
    : isEvaluationWorkflow
      ? t(($) => $['common.switchToStandardWorkflow'], { ns: 'workflow' })
      : t(($) => $['common.switchToEvaluationWorkflow'], { ns: 'workflow' })
  const evaluationWorkflowInfoLabel = `${t(($) => $['operation.viewDetails'])}: ${evaluationWorkflowActionLabel}`
  const [isKindChangeConfirmOpen, setIsKindChangeConfirmOpen] = useState(false)

  const handleEvaluationWorkflowAction = () => {
    if (workflowKindChangePending || isPublishing || published) return
    // Switching changes how a published workflow can be used, so confirm it first.
    if (hasPublishedVersion) {
      setIsKindChangeConfirmOpen(true)
      return
    }
    void Promise.resolve(onPublishEvaluation?.()).catch(() => undefined)
  }

  const handleConfirmKindChange = () => {
    setIsKindChangeConfirmOpen(false)
    void Promise.resolve(onConvertWorkflowKind?.(evaluationTargetKind)).catch(() => undefined)
  }

  return (
    <div className="flex flex-col border-t-[0.5px] border-t-divider-regular p-3">
      {showEvaluationWorkflowAction && (
        <>
          <div className="relative">
            <SuggestedAction
              disabled={workflowKindChangePending || isPublishing || published}
              endIcon={
                <span className="flex items-center gap-1">
                  <span aria-hidden className="size-4" />
                  {workflowKindChangePending && (
                    <span aria-hidden className="i-ri-loader-2-line size-3.5 animate-spin" />
                  )}
                </span>
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
            <Infotip>
              <InfotipTrigger
                aria-label={evaluationWorkflowInfoLabel}
                className={cn(
                  'absolute top-1/2 -translate-y-1/2',
                  workflowKindChangePending ? 'end-7' : 'end-3',
                )}
              />
              {/* Open below so the explanation covers neither the Publish button nor this label. */}
              <InfotipContent
                side="bottom"
                align="end"
                aria-label={evaluationWorkflowInfoLabel}
                className="max-w-72"
              >
                {t(($) => $['common.evaluationWorkflowDescription'], { ns: 'workflow' })}
              </InfotipContent>
            </Infotip>
          </div>
          {hasPublishedVersion && (
            <AlertDialog open={isKindChangeConfirmOpen} onOpenChange={setIsKindChangeConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{evaluationWorkflowActionLabel}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {isEvaluationWorkflow
                      ? t(($) => $['common.switchToStandardWorkflowDescription'], {
                          ns: 'workflow',
                        })
                      : t(($) => $['common.evaluationWorkflowDescription'], { ns: 'workflow' })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancelButton>
                    {t(($) => $['operation.cancel'])}
                  </AlertDialogCancelButton>
                  <AlertDialogConfirmButton tone="default" onClick={handleConfirmKindChange}>
                    {t(($) => $['operation.confirm'])}
                  </AlertDialogConfirmButton>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
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
