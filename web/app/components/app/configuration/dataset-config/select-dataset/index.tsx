'use client'
import type { FC } from 'react'
import React, { useRef, useState } from 'react'
import { useGetState, useInfiniteScroll } from 'ahooks'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import produce from 'immer'
import TypeIcon from '../type-icon'
import Modal from '@/app/components/base/modal'
import type { DataSet } from '@/models/datasets'
import Button from '@/app/components/base/button'
import { fetchDatasets } from '@/service/datasets'
import Loading from '@/app/components/base/loading'
import Badge from '@/app/components/base/badge'
import { useKnowledge } from '@/hooks/use-knowledge'
import cn from '@/utils/classnames'

export type ISelectDataSetProps = {
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
  const [selected, setSelected] = React.useState<DataSet[]>(selectedIds.map(id => ({ id }) as any))
  const [loaded, setLoaded] = React.useState(false)
  const [datasets, setDataSets] = React.useState<DataSet[] | null>(null)
  const hasNoData = !datasets || datasets?.length === 0
  const canSelectMulti = true

  const listRef = useRef<HTMLDivElement>(null)
  const [page, setPage, getPage] = useGetState(1)
  const [isNoMore, setIsNoMore] = useState(false)
  const { formatIndexingTechniqueAndMethod } = useKnowledge()

  useInfiniteScroll(
    async () => {
      if (!isNoMore) {
        const { data, has_more } = await fetchDatasets({ url: '/datasets', params: { page } })
        setPage(getPage() + 1)
        setIsNoMore(!has_more)
        const newList = [...(datasets || []), ...data.filter(item => item.indexing_technique || item.provider === 'external')]
        setDataSets(newList)
        setLoaded(true)
        if (!selected.find(item => !item.name))
          return { list: [] }

        const newSelected = produce(selected, (draft) => {
          selected.forEach((item, index) => {
            if (!item.name) { // not fetched database
              const newItem = newList.find(i => i.id === item.id)
              if (newItem)
                draft[index] = newItem
            }
          })
        })
        setSelected(newSelected)
      }
      return { list: [] }
    },
    {
      target: listRef,
      isNoMore: () => {
        return isNoMore
      },
      reloadDeps: [isNoMore],
    },
  )

  const toggleSelect = (dataSet: DataSet) => {
    const isSelected = selected.some(item => item.id === dataSet.id)
    if (isSelected) {
      setSelected(selected.filter(item => item.id !== dataSet.id))
    }
    else {
      if (canSelectMulti)
        setSelected([...selected, dataSet])
      else
        setSelected([dataSet])
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
            borderColor: 'rgba(0, 0, 0, 0.02',
          }}
        >
          <span className='text-text-tertiary'>{t('appDebug.feature.dataSet.noDataSet')}</span>
          <Link href="/datasets/create" className='font-normal text-text-accent'>{t('appDebug.feature.dataSet.toCreate')}</Link>
        </div>
      )}

      {datasets && datasets?.length > 0 && (
        <>
          <div ref={listRef} className='mt-7 space-y-1 max-h-[286px] overflow-y-auto'>
            {datasets.map(item => (
              <div
                key={item.id}
                className={cn(
                  'flex justify-between items-center h-10 px-2 rounded-lg bg-components-panel-on-panel-item-bg border-components-panel-border-subtle border-[0.5px] shadow-xs cursor-pointer hover:border-components-panel-border hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm',
                  selected.some(i => i.id === item.id) && 'border-[1.5px] border-components-option-card-option-selected-border bg-state-accent-hover shadow-xs hover:shadow-xs hover:border-components-option-card-option-selected-border hover:bg-state-accent-hover',
                  !item.embedding_available && 'hover:border-components-panel-border-subtle hover:bg-components-panel-on-panel-item-bg hover:shadow-xs',
                )}
                onClick={() => {
                  if (!item.embedding_available)
                    return
                  toggleSelect(item)
                }}
              >
                <div className='mr-1 flex items-center'>
                  <div className={cn('mr-2', !item.embedding_available && 'opacity-30')}>
                    <TypeIcon type="upload_file" size='md' />
                  </div>
                  <div className={cn('max-w-[200px] text-[13px] font-medium text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap', !item.embedding_available && 'opacity-30 !max-w-[120px]')}>{item.name}</div>
                  {!item.embedding_available && (
                    <span className='ml-1 shrink-0 px-1 border border-divider-deep rounded-md text-text-tertiary text-xs font-normal leading-[18px]'>{t('dataset.unavailable')}</span>
                  )}
                </div>
                {
                  item.indexing_technique && (
                    <Badge
                      text={formatIndexingTechniqueAndMethod(item.indexing_technique, item.retrieval_model_dict?.search_method)}
                    />
                  )
                }
                {
                  item.provider === 'external' && (
                    <Badge text={t('dataset.externalTag')} />
                  )
                }
              </div>
            ))}
          </div>
        </>
      )}
      {loaded && (
        <div className='flex justify-between items-center mt-8'>
          <div className='text-sm  font-medium text-text-secondary'>
            {selected.length > 0 && `${selected.length} ${t('appDebug.feature.dataSet.selected')}`}
          </div>
          <div className='flex space-x-2'>
            <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
            <Button variant='primary' onClick={handleSelect} disabled={hasNoData}>{t('common.operation.add')}</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
export default React.memo(SelectDataSet)
