'use client'
import type { DataSet } from '@/models/datasets'
import { useHover } from 'ahooks'
import { useRouter } from 'next/navigation'
import { useMemo, useRef } from 'react'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import CornerLabels from './components/corner-labels'
import DatasetCardFooter from './components/dataset-card-footer'
import DatasetCardHeader from './components/dataset-card-header'
import DatasetCardModals from './components/dataset-card-modals'
import Description from './components/description'
import OperationsPopover from './components/operations-popover'
import TagArea from './components/tag-area'
import { useDatasetCardState } from './hooks/use-dataset-card-state'

const EXTERNAL_PROVIDER = 'external'

type DatasetCardProps = {
  dataset: DataSet
  onSuccess?: () => void
}

const DatasetCard = ({
  dataset,
  onSuccess,
}: DatasetCardProps) => {
  const { push } = useRouter()

  const isCurrentWorkspaceDatasetOperator = useAppContextWithSelector(state => state.isCurrentWorkspaceDatasetOperator)
  const tagSelectorRef = useRef<HTMLDivElement>(null)
  const isHoveringTagSelector = useHover(tagSelectorRef)

  const {
    tags,
    setTags,
    modalState,
    openRenameModal,
    closeRenameModal,
    closeConfirmDelete,
    handleExportPipeline,
    detectIsUsedByApp,
    onConfirmDelete,
  } = useDatasetCardState({ dataset, onSuccess })

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
        <TagArea
          ref={tagSelectorRef}
          dataset={dataset}
          tags={tags}
          setTags={setTags}
          onSuccess={onSuccess}
          isHoveringTagSelector={isHoveringTagSelector}
          onClick={handleTagAreaClick}
        />
        <DatasetCardFooter dataset={dataset} />
        <OperationsPopover
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
