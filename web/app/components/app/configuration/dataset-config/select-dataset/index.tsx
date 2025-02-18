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
        <div className='mt-6 flex h-[128px] items-center justify-center space-x-1  rounded-lg border text-[13px]'
          style={{
            background: 'rgba(0, 0, 0, 0.02)',
            borderColor: 'rgba(0, 0, 0, 0.02',
          }}
        >
          <span className='text-text-tertiary'>{t('appDebug.feature.dataSet.noDataSet')}</span>
          <Link href="/datasets/create" className='text-text-accent font-normal'>{t('appDebug.feature.dataSet.toCreate')}</Link>
        </div>
      )}

      {datasets && datasets?.length > 0 && (
        <>
          <div ref={listRef} className='mt-7 max-h-[286px] space-y-1 overflow-y-auto'>
            {datasets.map(item => (
              <div
                key={item.id}
                className={cn(
                  'bg-components-panel-on-panel-item-bg border-components-panel-border-subtle shadow-xs hover:border-components-panel-border hover:bg-components-panel-on-panel-item-bg-hover flex h-10 cursor-pointer items-center justify-between rounded-lg border-[0.5px] px-2 hover:shadow-sm',
                  selected.some(i => i.id === item.id) && 'border-components-option-card-option-selected-border bg-state-accent-hover shadow-xs hover:shadow-xs hover:border-components-option-card-option-selected-border hover:bg-state-accent-hover border-[1.5px]',
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
                  <div className={cn('text-text-secondary max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium', !item.embedding_available && '!max-w-[120px] opacity-30')}>{item.name}</div>
                  {!item.embedding_available && (
                    <span className='border-divider-deep text-text-tertiary ml-1 shrink-0 rounded-md border px-1 text-xs font-normal leading-[18px]'>{t('dataset.unavailable')}</span>
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
        <div className='mt-8 flex items-center justify-between'>
          <div className='text-text-secondary  text-sm font-medium'>
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
