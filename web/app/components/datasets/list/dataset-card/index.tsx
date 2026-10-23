'use client'

import type { DatasetCardItem } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { DatasetCardTags } from '@/features/tag-management/components/dataset-card-tags'
import Link from '@/next/link'
import {
  getDatasetACLCapabilities,
  hasOnlyDatasetPreviewPermission,
  hasPermission,
} from '@/utils/permission'
import CornerLabels from './components/corner-labels'
import DatasetCardFooter from './components/dataset-card-footer'
import DatasetCardHeader from './components/dataset-card-header'
import DatasetCardModals from './components/dataset-card-modals'
import Description from './components/description'
import OperationsDropdown from './components/operations-dropdown'
import { useDatasetCardState as useDatasetCardController } from './hooks/use-dataset-card-state'

const EXTERNAL_PROVIDER = 'external'

type DatasetCardProps = {
  dataset: DatasetCardItem
  onSuccess?: () => void
  onOpenTagManagement?: () => void
  stepByStepTourActionMenuHighlightPart?: string
  stepByStepTourActionMenuOpen?: boolean
  stepByStepTourCardTarget?: string
}

const DatasetCard = ({
  dataset,
  onSuccess,
  onOpenTagManagement = () => {},
  stepByStepTourActionMenuHighlightPart,
  stepByStepTourActionMenuOpen,
  stepByStepTourCardTarget,
}: DatasetCardProps) => {
  const { t } = useTranslation(['app'])
  const nameId = useId()
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)

  const datasetCard = useDatasetCardController({ dataset, onSuccess })
  const {
    modalState,
    openRenameModal,
    closeRenameModal,
    closeConfirmDelete,
    openAccessConfig,
    closeAccessConfig,
    handleExportPipeline,
    detectIsUsedByApp,
    onConfirmDelete,
  } = datasetCard

  const isExternalProvider = dataset.provider === EXTERNAL_PROVIDER
  const isPipelineUnpublished = useMemo(() => {
    return dataset.runtime_mode === 'rag_pipeline' && !dataset.is_published
  }, [dataset.runtime_mode, dataset.is_published])
  const isPreviewOnly = hasOnlyDatasetPreviewPermission(dataset.permission_keys)
  const datasetACLCapabilities = useMemo(
    () =>
      getDatasetACLCapabilities(dataset.permission_keys, {
        currentUserId,
        resourceMaintainer: dataset.maintainer ?? undefined,
        workspacePermissionKeys,
      }),
    [dataset.maintainer, dataset.permission_keys, currentUserId, workspacePermissionKeys],
  )
  const canManageAppTags = hasPermission(workspacePermissionKeys, 'dataset.tag.manage')
  const canBindOrUnbindTags = !isPreviewOnly && (canManageAppTags || datasetACLCapabilities.canEdit)

  const showPreviewOnlyAccessWarning = () => {
    toast.warning(t(($) => $.noAccessResourcePermission, { ns: 'app' }))
  }

  const href = isExternalProvider
    ? datasetACLCapabilities.canRetrievalRecall
      ? `/datasets/${dataset.id}/hitTesting`
      : `/datasets/${dataset.id}/settings`
    : isPipelineUnpublished
      ? `/datasets/${dataset.id}/pipeline`
      : `/datasets/${dataset.id}/documents`

  const content = (
    <>
      <DatasetCardHeader dataset={dataset} nameId={nameId} />
      <Description dataset={dataset} />
    </>
  )
  // The entry's hit area stretches over the card. Tags, footer details, and operations are
  // positioned later in the card, so they stay independent controls above that area.
  const entryClassName =
    "block rounded-t-xl text-left outline-hidden before:absolute before:inset-0 before:rounded-xl before:content-['']"

  return (
    <li
      className={cn(
        "group relative isolate col-span-1 flex min-h-41.5 min-w-0 flex-col overflow-hidden rounded-xl border-[0.5px] border-solid border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3 transition-[background-color,box-shadow] duration-200 ease-in-out after:pointer-events-none after:absolute after:inset-0 after:z-1 after:rounded-xl after:content-[''] focus-within:bg-components-card-bg-alt focus-within:[--color-tag-selector-mask-bg:var(--color-tag-selector-mask-hover-bg)] has-[>[data-dataset-card-entry]:focus-visible]:after:inset-ring-2 has-[>[data-dataset-card-entry]:focus-visible]:after:inset-ring-state-accent-solid motion-reduce:transition-none",
        isPreviewOnly
          ? 'opacity-60'
          : 'hover:bg-components-card-bg-alt hover:shadow-md hover:shadow-shadow-shadow-5 hover:[--color-tag-selector-mask-bg:var(--color-tag-selector-mask-hover-bg)] has-data-popup-open:bg-components-card-bg-alt',
      )}
      data-disable-nprogress={true}
      data-step-by-step-tour-target={stepByStepTourCardTarget}
    >
      <CornerLabels dataset={dataset} />
      {isPreviewOnly ? (
        <button
          type="button"
          data-dataset-card-entry=""
          aria-labelledby={nameId}
          className={cn(entryClassName, 'w-full cursor-not-allowed')}
          onClick={showPreviewOnlyAccessWarning}
        >
          {content}
        </button>
      ) : (
        <Link
          href={href}
          data-dataset-card-entry=""
          aria-labelledby={nameId}
          className={entryClassName}
        >
          {content}
        </Link>
      )}
      <DatasetCardTags
        datasetId={dataset.id}
        embeddingAvailable={!!dataset.embedding_available}
        tags={dataset.tags}
        onOpenTagManagement={onOpenTagManagement}
        onTagsChange={onSuccess}
        canBindOrUnbindTags={canBindOrUnbindTags}
      />
      <DatasetCardFooter dataset={dataset} />
      {!isPreviewOnly && (
        <OperationsDropdown
          dataset={dataset}
          openRenameModal={openRenameModal}
          handleExportPipeline={handleExportPipeline}
          detectIsUsedByApp={detectIsUsedByApp}
          openAccessConfig={openAccessConfig}
          stepByStepTourHighlightPart={stepByStepTourActionMenuHighlightPart}
          stepByStepTourOpen={stepByStepTourActionMenuOpen}
        />
      )}
      <DatasetCardModals
        dataset={dataset}
        modalState={modalState}
        onCloseRename={closeRenameModal}
        onCloseConfirm={closeConfirmDelete}
        onCloseAccessConfig={closeAccessConfig}
        onConfirmDelete={onConfirmDelete}
        onSuccess={onSuccess}
      />
    </li>
  )
}

export default DatasetCard
