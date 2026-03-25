'use client'
import type { Emoji } from '@/app/components/tools/types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import type { PublishWorkflowParams } from '@/types/workflow'
import { RiArrowRightUpLine, RiHammerLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import Indicator from '@/app/components/header/indicator'
import WorkflowToolModal from '@/app/components/tools/workflow-tool'
import { cn } from '@/utils/classnames'
import Divider from '../../base/divider'
import { useConfigureButton } from './hooks/use-configure-button'

type Props = {
  disabled: boolean
  published: boolean
  detailNeedUpdate: boolean
  workflowAppId: string
  icon: Emoji
  name: string
  description: string
  inputs?: InputVar[]
  outputs?: Variable[]
  handlePublish: (params?: PublishWorkflowParams) => Promise<void>
  onRefreshData?: () => void
  disabledReason?: string
}

const WorkflowToolConfigureButton = ({
  disabled,
  published,
  detailNeedUpdate,
  workflowAppId,
  icon,
  name,
  description,
  inputs,
  outputs,
  handlePublish,
  onRefreshData,
  disabledReason,
}: Props) => {
  const { t } = useTranslation()
  const {
    showModal,
    isLoading,
    outdated,
    payload,
    isCurrentWorkspaceManager,
    openModal,
    closeModal,
    handleCreate,
    handleUpdate,
    navigateToTools,
  } = useConfigureButton({
    published,
    detailNeedUpdate,
    workflowAppId,
    icon,
    name,
    description,
    inputs,
    outputs,
    handlePublish,
    onRefreshData,
  })

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
                  onClick={() => !disabled && !published && openModal()}
                >
                  <RiHammerLine className={cn('relative h-4 w-4 text-text-secondary', !disabled && !published && 'group-hover:text-text-accent')} />
                  <div
                    title={t('common.workflowAsTool', { ns: 'workflow' }) || ''}
                    className={cn('shrink grow basis-0 truncate text-text-secondary system-sm-medium', !disabled && !published && 'group-hover:text-text-accent')}
                  >
                    {t('common.workflowAsTool', { ns: 'workflow' })}
                  </div>
                  {!published && (
                    <span className="shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 text-text-tertiary system-2xs-medium-uppercase">
                      {t('common.configureRequired', { ns: 'workflow' })}
                    </span>
                  )}
                </div>
              )
            : (
                <div
                  className="flex items-center justify-start gap-2 p-2 pl-2.5"
                >
                  <RiHammerLine className="h-4 w-4 text-text-tertiary" />
                  <div
                    title={t('common.workflowAsTool', { ns: 'workflow' }) || ''}
                    className="shrink grow basis-0 truncate text-text-tertiary system-sm-medium"
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
                  onClick={openModal}
                  disabled={!isCurrentWorkspaceManager || disabled}
                >
                  {t('common.configure', { ns: 'workflow' })}
                  {outdated && <Indicator className="ml-1" color="yellow" />}
                </Button>
                <Button
                  size="small"
                  className="w-[140px]"
                  onClick={navigateToTools}
                  disabled={disabled}
                >
                  {t('common.manageInTools', { ns: 'workflow' })}
                  <RiArrowRightUpLine className="ml-1 h-4 w-4" />
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
      {showModal && (
        <WorkflowToolModal
          isAdd={!published}
          payload={payload}
          onHide={closeModal}
          onCreate={handleCreate}
          onSave={handleUpdate}
        />
      )}
    </>
  )
}
export default WorkflowToolConfigureButton
