'use client'
import type { FC } from 'react'
import type { DataSet } from '@/models/datasets'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback } from 'react'
import SelectDataset from '@/app/components/app/configuration/dataset-config/select-dataset'
import AddButton from '@/app/components/base/button/add-button'

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
