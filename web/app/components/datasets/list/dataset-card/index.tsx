'use client'
import type { KeyboardEvent, MouseEvent } from 'react'
import type { DataSet } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { DatasetCardTags } from '@/features/tag-management/components/dataset-card-tags'
import { useRouter } from '@/next/navigation'
import { getDatasetACLCapabilities, hasOnlyDatasetPreviewPermission, hasPermission } from '@/utils/permission'
import CornerLabels from './components/corner-labels'
import DatasetCardFooter from './components/dataset-card-footer'
import DatasetCardHeader from './components/dataset-card-header'
import DatasetCardModals from './components/dataset-card-modals'
import Description from './components/description'
import OperationsDropdown from './components/operations-dropdown'
import { useDatasetCardState as useDatasetCardController } from './hooks/use-dataset-card-state'

const EXTERNAL_PROVIDER = 'external'

type DatasetCardProps = {
  dataset: DataSet
  onSuccess?: () => void
  onOpenTagManagement?: () => void
}

const DatasetCard = ({
  dataset,
  onSuccess,
  onOpenTagManagement = () => {},
}: DatasetCardProps) => {
  const { t } = useTranslation()
  const { push } = useRouter()
  const currentUserId = useAtomValue(userProfileIdAtom)
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
  const datasetACLCapabilities = useMemo(() => getDatasetACLCapabilities(dataset.permission_keys, {
    currentUserId,
    resourceMaintainer: dataset.maintainer,
    workspacePermissionKeys,
  }), [dataset.maintainer, dataset.permission_keys, currentUserId, workspacePermissionKeys])
  const canManageAppTags = hasPermission(workspacePermissionKeys, 'dataset.tag.manage')
  const canBindOrUnbindTags = !isPreviewOnly && (canManageAppTags || datasetACLCapabilities.canEdit)

  const showPreviewOnlyAccessWarning = () => {
    toast.warning(t($ => $.noAccessResourcePermission, { ns: 'app' }))
  }

  const handleCardClick = (e: MouseEvent) => {
    e.preventDefault()
    if (isPreviewOnly) {
      showPreviewOnlyAccessWarning()
      return
    }

    if (isExternalProvider) {
      push(datasetACLCapabilities.canRetrievalRecall
        ? `/datasets/${dataset.id}/hitTesting`
        : `/datasets/${dataset.id}/settings`)
    }
    else if (isPipelineUnpublished) {
      push(`/datasets/${dataset.id}/pipeline`)
    }
    else {
      push(`/datasets/${dataset.id}/documents`)
    }
  }

  const handlePreviewOnlyCardKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!isPreviewOnly || (e.key !== 'Enter' && e.key !== ' '))
      return

    e.preventDefault()
    showPreviewOnlyAccessWarning()
  }

  const handleTagAreaClick = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
  }
  const cardClassName = cn(
    'group relative col-span-1 flex h-41.5 flex-col overflow-hidden rounded-xl border-[0.5px] border-solid border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3 transition-[background-color,box-shadow] duration-200 ease-in-out',
    isPreviewOnly
      ? 'cursor-not-allowed opacity-60 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden'
      : 'cursor-pointer hover:bg-components-card-bg-alt hover:shadow-md hover:shadow-shadow-shadow-5',
  )

  return (
    <>
      <div
        role={isPreviewOnly ? 'button' : undefined}
        tabIndex={isPreviewOnly ? 0 : undefined}
        aria-disabled={isPreviewOnly ? 'true' : undefined}
        aria-label={isPreviewOnly ? dataset.name : undefined}
        className={cardClassName}
        data-disable-nprogress={true}
        onClick={handleCardClick}
        onKeyDown={handlePreviewOnlyCardKeyDown}
      >
        <CornerLabels dataset={dataset} />
        <DatasetCardHeader dataset={dataset} />
        <Description dataset={dataset} />
        <DatasetCardTags
          datasetId={dataset.id}
          embeddingAvailable={dataset.embedding_available}
          tags={dataset.tags}
          onClick={handleTagAreaClick}
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
          />
        )}
      </div>
      <DatasetCardModals
        dataset={dataset}
        modalState={modalState}
        onCloseRename={closeRenameModal}
        onCloseConfirm={closeConfirmDelete}
        onCloseAccessConfig={closeAccessConfig}
        onConfirmDelete={onConfirmDelete}
        onSuccess={onSuccess}
      />
    </>
  )
}

export default DatasetCard
