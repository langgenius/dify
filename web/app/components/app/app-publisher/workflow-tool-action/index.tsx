import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
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
  outdated: boolean
  published: boolean
  onConfigure: () => void
}

const WorkflowToolAction = ({
  disabled,
  isLoading,
  message,
  outdated,
  published,
  onConfigure,
}: WorkflowToolActionProps) => {
  const { t } = useTranslation()
  const disabledReason = disabled ? message : undefined
  const workflowToolLabel = t(($) => $['common.workflowAsTool'], { ns: 'workflow' })

  if (!published || isLoading)
    return (
      <div className={cn('w-full rounded-lg')}>
        <SuggestedAction
          className="flex-1"
          disabled={disabled}
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
      </div>
    )

  const configureLabel = outdated
    ? t(($) => $['common.workflowAsToolReconfigure'], { ns: 'workflow' })
    : t(($) => $['common.configure'], { ns: 'workflow' })
  const manageInToolsLabel = t(($) => $['common.manageInTools'], { ns: 'workflow' })
  const stateLabel = outdated
    ? t(($) => $['common.workflowAsToolUpdateNeeded'], { ns: 'workflow' })
    : t(($) => $['common.workflowAsToolReady'], { ns: 'workflow' })

  return (
    <div className={cn('flex w-full flex-col rounded-lg', disabled && 'opacity-30')}>
      <div className="flex items-start gap-2 p-1">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-components-panel-on-panel-item-bg text-text-secondary shadow-xs"
        >
          <span className="i-ri-hammer-line size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-h-7 items-center gap-2 pt-1 pr-1 pb-1">
            <span className="min-w-0 flex-1 truncate system-sm-medium text-text-secondary">
              {workflowToolLabel}
            </span>
            <WorkflowToolStateLabel label={stateLabel} outdated={outdated} />
          </div>
          {outdated && (
            <p className="pr-4 pb-1 system-xs-regular text-text-warning">
              {t(($) => $['common.workflowAsToolTip'], { ns: 'workflow' })}
            </p>
          )}
          <div className="flex items-center gap-1 py-1">
            <Button
              variant="secondary"
              size="small"
              disabled={disabled}
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
      {disabledReason && <WorkflowToolDisabledReason message={disabledReason} />}
    </div>
  )
}

export default WorkflowToolAction
