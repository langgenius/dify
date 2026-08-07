'use client'
import type { FC } from 'react'
import type { DataSet } from '@/models/datasets'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SelectDataset from '@/app/components/app/configuration/dataset-config/select-dataset'

type Props = Readonly<{
  selectedIds: string[]
  modal?: boolean
  onChange: (dataSets: DataSet[]) => void
}>

const AddDataset: FC<Props> = ({ selectedIds, modal, onChange }) => {
  const { t } = useTranslation()
  const [isShowModal, setIsShowModal] = useState(false)

  const handleSelect = useCallback(
    (datasets: DataSet[]) => {
      onChange(datasets)
      setIsShowModal(false)
    },
    [onChange],
  )
  return (
    <div>
      <button
        type="button"
        aria-label={`${t(($) => $['operation.add'], { ns: 'common' })} ${t(($) => $['nodes.knowledgeRetrieval.knowledge'], { ns: 'workflow' })}`}
        className="cursor-pointer rounded-md border-none bg-transparent p-1 outline-hidden select-none hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={() => setIsShowModal(true)}
      >
        <span aria-hidden="true" className="i-ri-add-line size-4 text-text-tertiary" />
      </button>
      <SelectDataset
        isShow={isShowModal}
        modal={modal}
        onClose={() => setIsShowModal(false)}
        selectedIds={selectedIds}
        onSelect={handleSelect}
      />
    </div>
  )
}
export default React.memo(AddDataset)
