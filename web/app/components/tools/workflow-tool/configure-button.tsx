'use client'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import Indicator from '@/app/components/header/indicator'
import { useRouter } from '@/next/navigation'
import Divider from '../../base/divider'

type Props = {
  disabled: boolean
  published: boolean
  isLoading: boolean
  outdated: boolean
  isCurrentWorkspaceManager: boolean
  onConfigure: () => void
  disabledReason?: string
}

const WorkflowToolConfigureButton = ({
  disabled,
  published,
  isLoading,
  outdated,
  isCurrentWorkspaceManager,
  onConfigure,
  disabledReason,
}: Props) => {
  const { t } = useTranslation()
  const router = useRouter()

  return (
    <>
      <Divider type="horizontal" className="h-px bg-divider-subtle" />
      {(!published || !isLoading) && (
        <div className={cn(
          'group rounded-lg bg-background-section-burn transition-colors',
          disabled || !isCurrentWorkspaceManager ? 'cursor-not-allowed opacity-60 shadow-xs' : 'cursor-pointer',
          !disabled && !published && isCurrentWorkspaceManager && 'hover:bg-state-accent-hover',
        )}
        >
          {isCurrentWorkspaceManager
            ? (
                <div
                  className="flex items-center justify-start gap-2 p-2 pl-2.5"
                  onClick={() => {
                    if (!disabled && !published)
                      onConfigure()
                  }}
                >
                  <span className={cn('relative i-ri-hammer-line h-4 w-4 text-text-secondary', !disabled && !published && 'group-hover:text-text-accent')} />
                  <div
                    title={t('common.workflowAsTool', { ns: 'workflow' }) || ''}
                    className={cn('shrink grow basis-0 truncate system-sm-medium text-text-secondary', !disabled && !published && 'group-hover:text-text-accent')}
                  >
                    {t('common.workflowAsTool', { ns: 'workflow' })}
                  </div>
                  {!published && (
                    <span className="shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
                      {t('common.configureRequired', { ns: 'workflow' })}
                    </span>
                  )}
                </div>
              )
            : (
                <div
                  className="flex items-center justify-start gap-2 p-2 pl-2.5"
                >
                  <span className="i-ri-hammer-line h-4 w-4 text-text-tertiary" />
                  <div
                    title={t('common.workflowAsTool', { ns: 'workflow' }) || ''}
                    className="shrink grow basis-0 truncate system-sm-medium text-text-tertiary"
                  >
                    {t('common.workflowAsTool', { ns: 'workflow' })}
                  </div>
                </div>
              )}
          {disabledReason && (
            <div className="mt-1 px-2.5 pb-2 text-xs leading-[18px] text-text-tertiary">
              {disabledReason}
            </div>
          )}
          {published && (
            <div className="border-t-[0.5px] border-divider-regular px-2.5 py-2">
              <div className="flex justify-between gap-x-2">
                <Button
                  size="small"
                  className="w-[140px]"
                  onClick={onConfigure}
                  disabled={!isCurrentWorkspaceManager || disabled}
                >
                  {t('common.configure', { ns: 'workflow' })}
                  {outdated && <Indicator className="ml-1" color="yellow" />}
                </Button>
                <Button
                  size="small"
                  className="w-[140px]"
                  onClick={() => router.push('/tools?category=workflow')}
                  disabled={disabled}
                >
                  {t('common.manageInTools', { ns: 'workflow' })}
                  <span className="ml-1 i-ri-arrow-right-up-line h-4 w-4" />
                </Button>
              </div>
              {outdated && (
                <div className="mt-1 text-xs leading-[18px] text-text-warning">
                  {t('common.workflowAsToolTip', { ns: 'workflow' })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {published && isLoading && <div className="pt-2"><Loading type="app" /></div>}
    </>
  )
}
export default WorkflowToolConfigureButton
