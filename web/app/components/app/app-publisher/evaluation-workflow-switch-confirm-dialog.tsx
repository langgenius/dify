'use client'

import type { EvaluationWorkflowAssociatedTarget, EvaluationWorkflowAssociatedTargetType } from '@/types/evaluation'
import type { I18nKeysWithPrefix } from '@/types/i18n'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import Link from '@/next/link'

type EvaluationWorkflowSwitchConfirmDialogProps = {
  open: boolean
  targets: EvaluationWorkflowAssociatedTarget[]
  loading?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

const TARGET_TYPE_META: Record<EvaluationWorkflowAssociatedTargetType, {
  icon: string
  iconClassName: string
  labelKey: I18nKeysWithPrefix<'workflow', 'common.switchToStandardWorkflowConfirm.targetTypes.'>
  href: (targetId: string) => string
}> = {
  app: {
    icon: 'i-ri-flow-chart',
    iconClassName: 'bg-components-icon-bg-teal-soft text-util-colors-teal-teal-600',
    labelKey: 'common.switchToStandardWorkflowConfirm.targetTypes.app',
    href: targetId => `/app/${targetId}/workflow`,
  },
  snippets: {
    icon: 'i-ri-edit-2-line',
    iconClassName: 'bg-components-icon-bg-violet-soft text-util-colors-violet-violet-600',
    labelKey: 'common.switchToStandardWorkflowConfirm.targetTypes.snippets',
    href: targetId => `/snippets/${targetId}/orchestrate`,
  },
  knowledge_base: {
    icon: 'i-ri-book-2-line',
    iconClassName: 'bg-components-icon-bg-indigo-soft text-util-colors-blue-blue-600',
    labelKey: 'common.switchToStandardWorkflowConfirm.targetTypes.knowledge_base',
    href: targetId => `/datasets/${targetId}/documents`,
  },
}

const getTargetMeta = (targetType: EvaluationWorkflowAssociatedTargetType) => {
  return TARGET_TYPE_META[targetType] ?? TARGET_TYPE_META.app
}

const DependentTargetItem = ({
  target,
}: {
  target: EvaluationWorkflowAssociatedTarget
}) => {
  const { t } = useTranslation()
  const meta = getTargetMeta(target.target_type)
  const targetName = target.target_name || target.target_id

  return (
    <Link
      href={meta.href(target.target_id)}
      className="group flex w-full items-center gap-3 rounded-lg bg-background-section p-2 hover:bg-background-section-burn"
      title={targetName}
      target="_blank"
      rel="noreferrer"
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-regular',
          meta.iconClassName,
        )}
      >
        <span className={cn(meta.icon, 'size-5')} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 py-px">
        <span className="system-md-semibold truncate text-text-secondary">
          {targetName}
        </span>
        <span className="system-2xs-medium-uppercase text-text-tertiary">
          {t(meta.labelKey, { ns: 'workflow' })}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="i-ri-arrow-right-up-line size-3.5 shrink-0 text-text-quaternary opacity-0 transition-opacity group-hover:opacity-100"
      />
    </Link>
  )
}

const EvaluationWorkflowSwitchConfirmDialog = ({
  open,
  targets,
  loading = false,
  onOpenChange,
  onConfirm,
}: EvaluationWorkflowSwitchConfirmDialogProps) => {
  const { t } = useTranslation()

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[480px]">
        <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
          <AlertDialogTitle className="title-2xl-semi-bold w-full text-text-primary">
            {t('common.switchToStandardWorkflowConfirm.title', { ns: 'workflow' })}
          </AlertDialogTitle>
          <AlertDialogDescription className="system-md-regular w-full text-text-secondary">
            <span className="block">
              {t('common.switchToStandardWorkflowConfirm.activeIn', { ns: 'workflow', count: targets.length })}
            </span>
            <span className="block">
              {t('common.switchToStandardWorkflowConfirm.description', { ns: 'workflow' })}
            </span>
          </AlertDialogDescription>
        </div>

        <div className="flex flex-col gap-2 px-6 py-3">
          <div className="flex items-center gap-2">
            <span className="system-xs-medium-uppercase shrink-0 text-text-quaternary">
              {t('common.switchToStandardWorkflowConfirm.dependentWorkflows', { ns: 'workflow' })}
            </span>
            <span className="h-px min-w-0 flex-1 bg-divider-subtle" />
          </div>
          <div className="flex max-h-[188px] flex-col gap-1 overflow-y-auto">
            {targets.map(target => (
              <DependentTargetItem
                key={`${target.target_type}:${target.target_id}`}
                target={target}
              />
            ))}
          </div>
        </div>

        <AlertDialogActions>
          <AlertDialogCancelButton disabled={loading}>
            {t('operation.cancel', { ns: 'common' })}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            loading={loading}
            disabled={loading}
            onClick={onConfirm}
          >
            {t('common.switchToStandardWorkflowConfirm.switch', { ns: 'workflow' })}
          </AlertDialogConfirmButton>
        </AlertDialogActions>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default EvaluationWorkflowSwitchConfirmDialog
