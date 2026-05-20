'use client'
import type { DataSet } from '@/models/datasets'
import { useMemo } from 'react'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { DatasetCardTags } from '@/features/tag-management/components/dataset-card-tags'
import { useRouter } from '@/next/navigation'
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

  const isCurrentWorkspaceDatasetOperator = useAppContextWithSelector(state => state.isCurrentWorkspaceDatasetOperator)

  const datasetCard = useDatasetCardController({ dataset, onSuccess })
  const {
    modalState,
    openRenameModal,
    closeRenameModal,
    closeConfirmDelete,
    handleExportPipeline,
    detectIsUsedByApp,
    onConfirmDelete,
  } = datasetCard

  const isExternalProvider = dataset.provider === EXTERNAL_PROVIDER
  const isPipelineUnpublished = useMemo(() => {
    return dataset.runtime_mode === 'rag_pipeline' && !dataset.is_published
  }, [dataset.runtime_mode, dataset.is_published])

  const handleCardClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (isExternalProvider)
      push(`/datasets/${dataset.id}/hitTesting`)
    else if (isPipelineUnpublished)
      push(`/datasets/${dataset.id}/pipeline`)
    else
      push(`/datasets/${dataset.id}/documents`)
  }

  const handleTagAreaClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
  }

  return (
    <>
      <div
        className="group relative col-span-1 flex h-[190px] cursor-pointer flex-col rounded-xl border-[0.5px] border-solid border-components-card-border bg-components-card-bg shadow-xs shadow-shadow-shadow-3 transition-all duration-200 ease-in-out hover:bg-components-card-bg-alt hover:shadow-md hover:shadow-shadow-shadow-5"
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
        />
        <DatasetCardFooter dataset={dataset} />
        <OperationsDropdown
          dataset={dataset}
          isCurrentWorkspaceDatasetOperator={isCurrentWorkspaceDatasetOperator}
          openRenameModal={openRenameModal}
          handleExportPipeline={handleExportPipeline}
          detectIsUsedByApp={detectIsUsedByApp}
        />
      </div>
      <DatasetCardModals
        dataset={dataset}
        modalState={modalState}
        onCloseRename={closeRenameModal}
        onCloseConfirm={closeConfirmDelete}
        onConfirmDelete={onConfirmDelete}
        onSuccess={onSuccess}
      />
    </>
  )
}

export default DatasetCard
