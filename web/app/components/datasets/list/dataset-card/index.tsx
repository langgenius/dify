'use client'
import type { DataSet } from '@/models/datasets'
import { useMemo } from 'react'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { DatasetCardTags } from '@/features/tag-management/components/dataset-card-tags'
import { useRouter } from '@/next/navigation'
import { getDatasetACLCapabilities } from '@/utils/permission'
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
  const { push } = useRouter()
  const currentUserId = useAppContextWithSelector(state => state.userProfile?.id)
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)

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
  const datasetACLCapabilities = useMemo(() => getDatasetACLCapabilities(dataset.permission_keys, {
    currentUserId,
    resourceMaintainer: dataset.maintainer,
    workspacePermissionKeys,
  }), [dataset.maintainer, dataset.permission_keys, currentUserId, workspacePermissionKeys])

  const handleCardClick = (e: React.MouseEvent) => {
    e.preventDefault()
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

  const handleTagAreaClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
  }

  return (
    <>
      <div
        className="group relative col-span-1 flex h-41.5 cursor-pointer flex-col overflow-hidden rounded-xl border-[0.5px] border-solid border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3 transition-[background-color,box-shadow] duration-200 ease-in-out hover:bg-components-card-bg-alt hover:shadow-md hover:shadow-shadow-shadow-5"
        data-disable-nprogress={true}
        onClick={handleCardClick}
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
          canBindOrUnbindTags={datasetACLCapabilities.canEdit}
        />
        <DatasetCardFooter dataset={dataset} />
        <OperationsDropdown
          dataset={dataset}
          openRenameModal={openRenameModal}
          handleExportPipeline={handleExportPipeline}
          detectIsUsedByApp={detectIsUsedByApp}
          openAccessConfig={openAccessConfig}
        />
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
