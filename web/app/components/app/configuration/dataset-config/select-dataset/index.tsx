'use client'
import React, { FC, useEffect } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import Modal from '@/app/components/base/modal'
import { DataSet } from '@/models/datasets'
import TypeIcon from '../type-icon'
import Button from '@/app/components/base/button'
import { fetchDatasets } from '@/service/datasets'
import Loading from '@/app/components/base/loading'
import { formatNumber } from '@/utils/format'
import Link from 'next/link'

import s from './style.module.css'

export interface ISelectDataSetProps {
  isShow: boolean
  onClose: () => void
  selectedIds: string[]
  onSelect: (dataSet: DataSet[]) => void
}

const SelectDataSet: FC<ISelectDataSetProps> = ({
  isShow,
  onClose,
  selectedIds,
  onSelect,
}) => {
  const { t } = useTranslation()
  const [selected, setSelected] = React.useState<DataSet[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [datasets, setDataSets] = React.useState<DataSet[] | null>(null)
  const hasNoData = !datasets || datasets?.length === 0
  const canSelectMulti = true
  useEffect(() => {
    (async () => {
      const { data } = await fetchDatasets({ url: '/datasets', params: { page: 1 } })
      setDataSets(data)
      setLoaded(true)
      setSelected(data.filter((item) => selectedIds.includes(item.id)))
    })()
  }, [])
  const toggleSelect = (dataSet: DataSet) => {
    const isSelected = selected.some((item) => item.id === dataSet.id)
    if (isSelected) {
      setSelected(selected.filter((item) => item.id !== dataSet.id))
    }
    else {
      if (canSelectMulti) {
        setSelected([...selected, dataSet])
      } else {
        setSelected([dataSet])
      }
    }
  }

  const handleSelect = () => {
    onSelect(selected)
  }
  return (
    <Modal
      isShow={isShow}
      onClose={onClose}
      className='w-[400px]'
      title={t('appDebug.feature.dataSet.selectTitle')}
    >
      {!loaded && (
        <div className='flex h-[200px]'>
          <Loading type='area' />
        </div>
      )}

      {(loaded && hasNoData) && (
        <div className='flex items-center justify-center mt-6 rounded-lg space-x-1  h-[128px] text-[13px] border'
          style={{
            background: 'rgba(0, 0, 0, 0.02)',
            borderColor: 'rgba(0, 0, 0, 0.02'
          }}
        >
          <span className='text-gray-500'>{t('appDebug.feature.dataSet.noDataSet')}</span>
          <Link href="/datasets/create" className='font-normal text-[#155EEF]'>{t('appDebug.feature.dataSet.toCreate')}</Link>
        </div>
      )}

      {datasets && datasets?.length > 0 && (
        <>
          <div className='mt-7 space-y-1 max-h-[286px] overflow-y-auto'>
            {datasets.map((item) => (
              <div
                key={item.id}
                className={cn(s.item, selected.some(i => i.id === item.id) && s.selected, 'flex justify-between items-center h-10 px-2 rounded-lg bg-white border border-gray-200  cursor-pointer')}
                onClick={() => toggleSelect(item)}
              >
                <div className='flex items-center space-x-2'>
                  <TypeIcon type="upload_file" size='md' />
                  <div className='max-w-[200px] text-[13px] font-medium text-gray-800 overflow-hidden text-ellipsis whitespace-nowrap'>{item.name}</div>
                </div>

                <div className='max-w-[140px] flex text-xs text-gray-500  overflow-hidden text-ellipsis whitespace-nowrap'>
                  {formatNumber(item.word_count)} {t('appDebug.feature.dataSet.words')} · {formatNumber(item.document_count)} {t('appDebug.feature.dataSet.textBlocks')}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {loaded && (
        <div className='flex justify-between items-center mt-8'>
          <div className='text-sm  font-medium text-gray-700'>
            {selected.length > 0 && `${selected.length} ${t('appDebug.feature.dataSet.selected')}`}
          </div>
          <div className='flex space-x-2'>
            <Button className='!w-24 !h-9' onClick={onClose}>{t('common.operation.cancel')}</Button>
            <Button className='!w-24 !h-9' type='primary' onClick={handleSelect} disabled={hasNoData}>{t('common.operation.add')}</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
export default React.memo(SelectDataSet)
