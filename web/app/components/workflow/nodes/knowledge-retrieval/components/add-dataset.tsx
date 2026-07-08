'use client'
import type { FC } from 'react'
import type { DataSet } from '@/models/datasets'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import SelectDataset from '@/app/components/app/configuration/dataset-config/select-dataset'

type Props = Readonly<{
  selectedIds: string[]
  modal?: boolean
  selectedDatasets?: DataSet[]
  onChange: (dataSets: DataSet[]) => void
}>

const AddDataset: FC<Props> = ({
  selectedIds,
  modal,
  selectedDatasets,
  onChange,
}) => {
  const { t } = useTranslation()
  const [isShowModal, {
    setTrue: showModal,
    setFalse: hideModal,
  }] = useBoolean(false)

  const handleSelect = useCallback((datasets: DataSet[]) => {
    onChange(datasets)
    hideModal()
  }, [onChange, hideModal])

  const currentSelectedIds = useMemo(() => {
    return selectedDatasets?.length ? selectedDatasets.map(dataset => dataset.id) : selectedIds
  }, [selectedDatasets, selectedIds])

  return (
    <div>
      <button
        type="button"
        aria-label={`${t('operation.add', { ns: 'common' })} ${t('nodes.knowledgeRetrieval.knowledge', { ns: 'workflow' })}`}
        className="cursor-pointer rounded-md border-none bg-transparent p-1 outline-hidden select-none hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={showModal}
      >
        <span aria-hidden="true" className="i-ri-add-line size-4 text-text-tertiary" />
      </button>
      <SelectDataset
        isShow={isShowModal}
        modal={modal}
        onClose={hideModal}
        selectedIds={currentSelectedIds}
        selectedDatasets={selectedDatasets}
        onSelect={handleSelect}
      />
    </div>
  )
}
export default React.memo(AddDataset)
