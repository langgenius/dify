'use client'
import type { SegmentImportStatus } from '@/types/dataset'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useState } from 'react'
import { useTranslation } from '#i18n'
import { PlanUpgradeModal } from '@/app/components/billing/plan-upgrade-modal'
import { Plan } from '@/app/components/billing/type'
import { useProviderContext } from '@/context/provider-context'
import { segmentImportStatus } from '@/types/dataset'

type SegmentAddProps = {
  importStatus: SegmentImportStatus | undefined
  clearImportStatus: () => void
  showNewSegmentModal: () => void
  showBatchModal: () => void
  embedding: boolean
}

export function SegmentAdd({
  importStatus,
  clearImportStatus,
  showNewSegmentModal,
  showBatchModal,
  embedding,
}: SegmentAddProps) {
  const { t } = useTranslation()
  const [isPlanUpgradeModalOpen, setIsPlanUpgradeModalOpen] = useState(false)
  const { plan, enableBilling } = useProviderContext()
  const canAddChunks = !enableBilling || plan.type !== Plan.sandbox

  const textColor = embedding
    ? 'text-components-button-secondary-accent-text-disabled'
    : 'text-components-button-secondary-accent-text'

  const openSegmentDialog = (openDialog: () => void) => {
    if (!canAddChunks) {
      setIsPlanUpgradeModalOpen(true)
      return
    }

    openDialog()
  }

  if (importStatus) {
    return (
      <>
        {(importStatus === segmentImportStatus.waiting || importStatus === segmentImportStatus.processing) && (
          <div className="relative mr-2 inline-flex items-center overflow-hidden rounded-lg border-[0.5px] border-components-progress-bar-border
            bg-components-progress-bar-border px-2.5 py-2 text-components-button-secondary-accent-text
            shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]"
          >
            <div className={cn('absolute top-0 left-0 z-0 h-full border-r-[1.5px] border-r-components-progress-bar-progress-highlight bg-components-progress-bar-progress', importStatus === segmentImportStatus.waiting ? 'w-3/12' : 'w-2/3')} />
            <span aria-hidden className="mr-1 i-ri-loader-2-line size-4 animate-spin" />
            <span className="z-10 pr-0.5 system-sm-medium">{t('list.batchModal.processing', { ns: 'datasetDocuments' })}</span>
          </div>
        )}
        {importStatus === segmentImportStatus.completed && (
          <div className="relative mr-2 inline-flex items-center overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]">
            <div className="inline-flex items-center border-r border-r-divider-subtle px-2.5 py-2 text-text-success">
              <span aria-hidden className="mr-1 i-custom-vender-solid-general-check-circle size-4" />
              <span className="pr-0.5 system-sm-medium">{t('list.batchModal.completed', { ns: 'datasetDocuments' })}</span>
            </div>
            <div className="m-1 inline-flex items-center">
              <button
                type="button"
                className="cursor-pointer rounded-md border-none bg-transparent px-1.5 py-1 text-left system-xs-medium text-components-button-ghost-text hover:bg-components-button-ghost-bg-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                onClick={clearImportStatus}
              >
                {t('list.batchModal.ok', { ns: 'datasetDocuments' })}
              </button>
            </div>
            <div className="absolute top-0 left-0 -z-10 size-full bg-dataset-chunk-process-success-bg opacity-40" />
          </div>
        )}
        {importStatus === segmentImportStatus.error && (
          <div className="relative mr-2 inline-flex items-center overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]">
            <div className="inline-flex items-center border-r border-r-divider-subtle px-2.5 py-2 text-text-destructive">
              <span aria-hidden className="mr-1 i-ri-error-warning-fill size-4" />
              <span className="pr-0.5 system-sm-medium">{t('list.batchModal.error', { ns: 'datasetDocuments' })}</span>
            </div>
            <div className="m-1 inline-flex items-center">
              <button
                type="button"
                className="cursor-pointer rounded-md border-none bg-transparent px-1.5 py-1 text-left system-xs-medium text-components-button-ghost-text hover:bg-components-button-ghost-bg-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                onClick={clearImportStatus}
              >
                {t('list.batchModal.ok', { ns: 'datasetDocuments' })}
              </button>
            </div>
            <div className="absolute top-0 left-0 -z-10 size-full bg-dataset-chunk-process-error-bg opacity-40" />
          </div>
        )}
      </>
    )
  }

  return (
    <div
      className={cn(
        'relative z-20 flex items-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]',
        embedding && 'border-components-button-secondary-border-disabled bg-components-button-secondary-bg-disabled',
      )}
    >
      <button
        type="button"
        className={`inline-flex items-center rounded-l-lg border-0 border-r border-r-divider-subtle bg-transparent px-2.5 py-2 text-left
          hover:bg-state-base-hover disabled:cursor-not-allowed disabled:hover:bg-transparent`}
        onClick={() => openSegmentDialog(showNewSegmentModal)}
        disabled={embedding}
      >
        <span aria-hidden className={cn('i-ri-add-line size-4', textColor)} />
        <span className={cn('ml-0.5 px-0.5 text-[13px] leading-[16px] font-medium capitalize', textColor)}>
          {t('list.action.addButton', { ns: 'datasetDocuments' })}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('list.action.batchAdd', { ns: 'datasetDocuments' })}
          disabled={embedding}
          className={cn(
            `rounded-l-none rounded-r-lg border-0 bg-transparent p-2 backdrop-blur-[5px]
            hover:bg-state-base-hover disabled:cursor-not-allowed disabled:bg-transparent disabled:hover:bg-transparent data-popup-open:bg-state-base-hover`,
          )}
        >
          <span aria-hidden className={cn('i-ri-arrow-down-s-line size-4', textColor)} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-end"
          sideOffset={4}
          popupClassName="min-w-[120px]"
        >
          <DropdownMenuItem
            className="system-md-regular"
            onClick={() => openSegmentDialog(showBatchModal)}
          >
            {t('list.action.batchAdd', { ns: 'datasetDocuments' })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {isPlanUpgradeModalOpen && (
        <PlanUpgradeModal
          show
          onClose={() => setIsPlanUpgradeModalOpen(false)}
          title={t('upgrade.addChunks.title', { ns: 'billing' })!}
          description={t('upgrade.addChunks.description', { ns: 'billing' })!}
        />
      )}
    </div>

  )
}
