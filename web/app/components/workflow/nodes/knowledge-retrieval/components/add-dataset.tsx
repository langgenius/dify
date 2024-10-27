'use client'
import { useBoolean } from 'ahooks'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import AddButton from '@/app/components/base/button/add-button'
import SelectDataset from '@/app/components/app/configuration/dataset-config/select-dataset'
import type { DataSet } from '@/models/datasets'

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
      <AddButton onClick={showModal} />
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
