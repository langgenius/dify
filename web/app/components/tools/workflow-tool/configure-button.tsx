'use client'
import type { Emoji } from '@/app/components/tools/types'
import type { InputVar, Variable } from '@/app/components/workflow/types'
import type { PublishWorkflowParams } from '@/types/workflow'
import { RiArrowRightUpLine, RiHammerLine } from '@remixicon/react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import Indicator from '@/app/components/header/indicator'
import WorkflowToolModal from '@/app/components/tools/workflow-tool'
import { useAppContext } from '@/context/app-context'
import { cn } from '@/utils/classnames'
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

type UnpublishedCardProps = {
  disabled: boolean
  isManager: boolean
  onConfigureClick: () => void
}

const UnpublishedCard = ({ disabled, isManager, onConfigureClick }: UnpublishedCardProps) => {
  const { t } = useTranslation()

  const handleClick = () => {
    if (!disabled && isManager)
      onConfigureClick()
  }

  return (
    <div
      className="flex items-center justify-start gap-2 p-2 pl-2.5"
      onClick={handleClick}
    >
      <RiHammerLine className={cn('relative h-4 w-4 text-text-secondary', !disabled && isManager && 'group-hover:text-text-accent')} />
      <div
        title={t('common.workflowAsTool', { ns: 'workflow' }) || ''}
        className={cn('system-sm-medium shrink grow basis-0 truncate text-text-secondary', !disabled && isManager && 'group-hover:text-text-accent')}
      >
        {t('common.workflowAsTool', { ns: 'workflow' })}
      </div>
      <span className="system-2xs-medium-uppercase shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 text-text-tertiary">
        {t('common.configureRequired', { ns: 'workflow' })}
      </span>
    </div>
  )
}

type NonManagerCardProps = Record<string, never>

const NonManagerCard = (_props: NonManagerCardProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-start gap-2 p-2 pl-2.5">
      <RiHammerLine className="h-4 w-4 text-text-tertiary" />
      <div
        title={t('common.workflowAsTool', { ns: 'workflow' }) || ''}
        className="system-sm-medium shrink grow basis-0 truncate text-text-tertiary"
      >
        {t('common.workflowAsTool', { ns: 'workflow' })}
      </div>
    </div>
  )
}

type PublishedActionsProps = {
  disabled: boolean
  isManager: boolean
  outdated: boolean
  onConfigureClick: () => void
  onManageClick: () => void
}

const PublishedActions = ({ disabled, isManager, outdated, onConfigureClick, onManageClick }: PublishedActionsProps) => {
  const { t } = useTranslation()

  return (
    <div className="border-t-[0.5px] border-divider-regular px-2.5 py-2">
      <div className="flex justify-between gap-x-2">
        <Button
          size="small"
          className="w-[140px]"
          onClick={onConfigureClick}
          disabled={!isManager || disabled}
        >
          {t('common.configure', { ns: 'workflow' })}
          {outdated && <Indicator className="ml-1" color="yellow" />}
        </Button>
        <Button
          size="small"
          className="w-[140px]"
          onClick={onManageClick}
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
  )
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
  const router = useRouter()
  const { isCurrentWorkspaceManager } = useAppContext()

  const {
    showModal,
    isLoading,
    outdated,
    payload,
    openModal,
    closeModal,
    handleCreate,
    handleUpdate,
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

  const handleUnpublishedClick = () => {
    if (!disabled)
      openModal()
  }

  const handleManageClick = () => {
    router.push('/tools?category=workflow')
  }

  const cardClassName = cn(
    'group rounded-lg bg-background-section-burn transition-colors',
    disabled || !isCurrentWorkspaceManager ? 'cursor-not-allowed opacity-60 shadow-xs' : 'cursor-pointer',
    !disabled && !published && isCurrentWorkspaceManager && 'hover:bg-state-accent-hover',
  )

  const renderCardContent = () => {
    if (!isCurrentWorkspaceManager)
      return <NonManagerCard />

    if (!published) {
      return (
        <UnpublishedCard
          disabled={disabled}
          isManager={isCurrentWorkspaceManager}
          onConfigureClick={handleUnpublishedClick}
        />
      )
    }

    return (
      <div
        className="flex items-center justify-start gap-2 p-2 pl-2.5"
        onClick={openModal}
      >
        <RiHammerLine className="relative h-4 w-4 text-text-secondary" />
        <div
          title={t('common.workflowAsTool', { ns: 'workflow' }) || ''}
          className="system-sm-medium shrink grow basis-0 truncate text-text-secondary"
        >
          {t('common.workflowAsTool', { ns: 'workflow' })}
        </div>
      </div>
    )
  }

  const showContent = !published || !isLoading

  return (
    <>
      <Divider type="horizontal" className="h-px bg-divider-subtle" />
      {showContent && (
        <div className={cardClassName}>
          {renderCardContent()}
          {disabledReason && (
            <div className="mt-1 px-2.5 pb-2 text-xs leading-[18px] text-text-tertiary">
              {disabledReason}
            </div>
          )}
          {published && (
            <PublishedActions
              disabled={disabled}
              isManager={isCurrentWorkspaceManager}
              outdated={outdated}
              onConfigureClick={openModal}
              onManageClick={handleManageClick}
            />
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
