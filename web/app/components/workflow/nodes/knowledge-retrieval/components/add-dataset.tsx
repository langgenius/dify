'use client'
import type { FC } from 'react'
import type { DataSet } from '@/models/datasets'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback } from 'react'
import SelectDataset from '@/app/components/app/configuration/dataset-config/select-dataset'

type Props = {
  selectedIds: string[]
  onChange: (dataSets: DataSet[]) => void
}

const AddDataset: FC<Props> = ({
  selectedIds,
  onChange,
}) => {
  const [isShowModal, {
    setTrue: showModal,
    setFalse: hideModal,
  }] = useBoolean(false)

  const handleSelect = useCallback((datasets: DataSet[]) => {
    onChange(datasets)
    hideModal()
  }, [onChange, hideModal])
  return (
    <div>
      <div className="cursor-pointer rounded-md p-1 select-none hover:bg-state-base-hover" onClick={showModal} data-testid="add-button">
        <span className="i-ri-add-line h-4 w-4 text-text-tertiary" />
      </div>
      {isShowModal && (
        <SelectDataset
          isShow={isShowModal}
          onClose={hideModal}
          selectedIds={selectedIds}
          onSelect={handleSelect}
        />
      )}
    </div>
  )
}
export default React.memo(AddDataset)
