import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { buildIntegrationPath } from '@/app/components/integrations/routes'
import Link from '@/next/link'
import SuggestedAction from '../suggested-action'
import WorkflowToolDisabledReason from './disabled-reason'
import WorkflowToolLoadingStatus from './loading-status'
import WorkflowToolSetupStatus from './setup-status'
import WorkflowToolStateLabel from './state-label'

type WorkflowToolActionProps = {
  disabled: boolean
  isLoading: boolean
  message?: string
  tooltipMessage?: string
  outdated: boolean
  published: boolean
  onConfigure: () => void
}

const WorkflowToolAction = ({
  disabled,
  isLoading,
  message,
  tooltipMessage,
  outdated,
  published,
  onConfigure,
}: WorkflowToolActionProps) => {
  const { t } = useTranslation(['appApi', 'workflow', 'navigation'])
  const disabledReasonId = useId()
  const disabledReason = disabled ? message : undefined
  const tooltipReason = disabled ? (tooltipMessage ?? message) : undefined
  const workflowToolLabel = t(($) => $['common.workflowAsTool'], { ns: 'navigation' })

  if (!published || isLoading)
    return (
      <Tooltip disabled={!tooltipReason}>
        <TooltipTrigger render={<div className="w-full rounded-lg" />}>
          <SuggestedAction
            className="flex-1"
            disabled={disabled}
            focusableWhenDisabled={Boolean(tooltipReason)}
            aria-description={tooltipMessage ? tooltipReason : undefined}
            description={t(($) => $['common.workflowAsToolDescription'], { ns: 'workflow' })}
            endIcon={
              isLoading ? (
                <WorkflowToolLoadingStatus label={t(($) => $.loading, { ns: 'appApi' })} />
              ) : (
                <WorkflowToolSetupStatus
                  label={t(($) => $['common.configureRequired'], { ns: 'workflow' })}
                />
              )
            }
            icon={<span className="i-ri-hammer-line size-4" />}
            onClick={onConfigure}
          >
            {workflowToolLabel}
          </SuggestedAction>
          {disabledReason && <WorkflowToolDisabledReason message={disabledReason} />}
        </TooltipTrigger>
        <TooltipContent role="tooltip">{tooltipReason}</TooltipContent>
      </Tooltip>
    )

  const configureLabel = outdated
    ? t(($) => $['common.workflowAsToolReconfigure'], { ns: 'workflow' })
    : t(($) => $['common.configure'], { ns: 'workflow' })
  const manageInToolsLabel = t(($) => $['common.manageInTools'], { ns: 'workflow' })
  const stateLabel = outdated
    ? t(($) => $['common.workflowAsToolUpdateNeeded'], { ns: 'workflow' })
    : t(($) => $['common.workflowAsToolReady'], { ns: 'workflow' })

  return (
    <Tooltip disabled={!tooltipReason}>
      <TooltipTrigger
        render={<div className={cn('flex w-full flex-col rounded-lg', disabled && 'opacity-30')} />}
      >
        <div className="flex items-start gap-2 p-1">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-components-panel-on-panel-item-bg text-text-secondary shadow-xs"
          >
            <span className="i-ri-hammer-line size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-h-7 items-center gap-2 pe-1 pt-1 pb-1">
              <span
                className="min-w-0 flex-1 truncate system-sm-medium text-text-secondary"
                title={workflowToolLabel}
              >
                {workflowToolLabel}
              </span>
              <WorkflowToolStateLabel label={stateLabel} outdated={outdated} />
            </div>
            {outdated && (
              <p className="pe-4 pb-1 system-xs-regular text-text-warning">
                {t(($) => $['common.workflowAsToolTip'], { ns: 'workflow' })}
              </p>
            )}
            <div className="flex items-center gap-1 py-1">
              <Button
                variant="secondary"
                size="small"
                disabled={disabled}
                focusableWhenDisabled={Boolean(tooltipReason)}
                aria-describedby={disabledReason ? disabledReasonId : undefined}
                aria-description={tooltipMessage ? tooltipReason : undefined}
                className="gap-1 px-1.5"
                onClick={onConfigure}
              >
                <span aria-hidden className="i-ri-equalizer-2-line size-3.5" />
                {configureLabel}
              </Button>
              {disabled ? (
                <button
                  type="button"
                  disabled
                  className="flex h-6 cursor-not-allowed items-center gap-1 rounded-md px-2 system-xs-medium text-components-button-tertiary-text-disabled"
                >
                  {manageInToolsLabel}
                  <span aria-hidden className="i-ri-arrow-right-up-line size-3.5" />
                </button>
              ) : (
                <Link
                  href={buildIntegrationPath('workflow-tool')}
                  className="flex h-6 items-center gap-1 rounded-md px-2 system-xs-medium text-text-tertiary outline-hidden hover:bg-components-button-tertiary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                >
                  {manageInToolsLabel}
                  <span aria-hidden className="i-ri-arrow-right-up-line size-3.5" />
                </Link>
              )}
            </div>
          </div>
        </div>
        {disabledReason && (
          <WorkflowToolDisabledReason id={disabledReasonId} message={disabledReason} />
        )}
      </TooltipTrigger>
      <TooltipContent role="tooltip">{tooltipReason}</TooltipContent>
    </Tooltip>
  )
}

export default WorkflowToolAction
