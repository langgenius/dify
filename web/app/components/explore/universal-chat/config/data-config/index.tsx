'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import { isEqual } from 'lodash-es'
import produce from 'immer'
import FeaturePanel from '@/app/components/app/configuration/base/feature-panel'
import OperationBtn from '@/app/components/app/configuration/base/operation-btn'
import CardItem from '@/app/components/app/configuration/dataset-config/card-item'
import SelectDataSet from '@/app/components/app/configuration/dataset-config/select-dataset'
import type { DataSet } from '@/models/datasets'

type Props = {
  readonly?: boolean
  dataSets: DataSet[]
  onChange?: (data: DataSet[]) => void
}

const DatasetConfig: FC<Props> = ({
  readonly,
  dataSets,
  onChange,
}) => {
  const { t } = useTranslation()

  const selectedIds = dataSets.map(item => item.id)

  const hasData = dataSets.length > 0
  const [isShowSelectDataSet, { setTrue: showSelectDataSet, setFalse: hideSelectDataSet }] = useBoolean(false)
  const handleSelect = (data: DataSet[]) => {
    if (isEqual(data.map(item => item.id), dataSets.map(item => item.id))) {
      hideSelectDataSet()
      return
    }

    if (data.find(item => !item.name)) { // has not loaded selected dataset
      const newSelected = produce(data, (draft) => {
        data.forEach((item, index) => {
          if (!item.name) { // not fetched database
            const newItem = dataSets.find(i => i.id === item.id)
            if (newItem)
              draft[index] = newItem
          }
        })
      })
      onChange?.(newSelected)
    }
    else {
      onChange?.(data)
    }
    hideSelectDataSet()
  }
  const onRemove = (id: string) => {
    onChange?.(dataSets.filter(item => item.id !== id))
  }

  return (
    <FeaturePanel
      className='mt-3'
      title={t('appDebug.feature.dataSet.title')}
      headerRight={!readonly && <OperationBtn type="add" onClick={showSelectDataSet} />}
      hasHeaderBottomBorder={!hasData}
    >
      {hasData
        ? (
          <div className='max-h-[220px] overflow-y-auto'>
            {dataSets.map(item => (
              <CardItem
                className="mb-2 !w-full"
                key={item.id}
                config={item}
                onRemove={onRemove}
                readonly={readonly}
                // TODO: readonly remove btn
              />
            ))}
          </div>
        )
        : (
          <div className='pt-2 pb-1 text-xs text-gray-500'>{t('appDebug.feature.dataSet.noData')}</div>
        )}

      {isShowSelectDataSet && (
        <SelectDataSet
          isShow={isShowSelectDataSet}
          onClose={hideSelectDataSet}
          selectedIds={selectedIds}
          onSelect={handleSelect}
        />
      )}
    </FeaturePanel>
  )
}
export default React.memo(DatasetConfig)
