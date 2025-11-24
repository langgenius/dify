'use client'
import type { FC } from 'react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from 'next/link'
import Modal from '@/app/components/base/modal'
import type { DataSet } from '@/models/datasets'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import Badge from '@/app/components/base/badge'
import { useKnowledge } from '@/hooks/use-knowledge'
import cn from '@/utils/classnames'
import AppIcon from '@/app/components/base/app-icon'
import { useDatasetList } from '@/service/knowledge/use-dataset'

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
  const [selected, setSelected] = useState<DataSet[]>([])
  const canSelectMulti = useRef(true)
  const anchorRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver>(null)

  const { formatIndexingTechniqueAndMethod } = useKnowledge()

  const {
    data: datasetList,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isLoading,
  } = useDatasetList({
    initialPage: 1,
    limit: 20,
  })

  const allDatasets = useMemo(() => {
    return datasetList?.pages.flatMap(({ data: datasets }) => datasets) || []
  }, [datasetList])
  const hasNoData = allDatasets.length === 0

  // Set selected datasets based on selectedIds after initial loading
  useEffect(() => {
    if (!isLoading && selectedIds.length > 0) {
      const newSelected = allDatasets.filter(item => selectedIds.includes(item.id))
      setSelected(newSelected)
    }
  }, [isLoading])

  useEffect(() => {
    if (anchorRef.current) {
      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetching)
          fetchNextPage()
      }, {
        rootMargin: '100px',
      })
      observerRef.current.observe(anchorRef.current)
    }
    return () => observerRef.current?.disconnect()
  }, [anchorRef, hasNextPage, isFetching, fetchNextPage])

  const toggleSelect = (dataSet: DataSet) => {
    const isSelected = selected.some(item => item.id === dataSet.id)
    if (isSelected) {
      setSelected(selected.filter(item => item.id !== dataSet.id))
    }
    else {
      if (canSelectMulti.current)
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
      {isLoading && (
        <div className='flex h-[200px]'>
          <Loading type='area' />
        </div>
      )}

      {(!isLoading && hasNoData) && (
        <div className='mt-6 flex h-[128px] items-center justify-center space-x-1  rounded-lg border text-[13px]'
          style={{
            background: 'rgba(0, 0, 0, 0.02)',
            borderColor: 'rgba(0, 0, 0, 0.02',
          }}
        >
          <span className='text-text-tertiary'>{t('appDebug.feature.dataSet.noDataSet')}</span>
          <Link href='/datasets/create' className='font-normal text-text-accent'>{t('appDebug.feature.dataSet.toCreate')}</Link>
        </div>
      )}

      {(!isLoading && !hasNoData) && (
        <>
          <div className='mt-7 max-h-[286px] space-y-1 overflow-y-auto'>
            {allDatasets.map(item => (
              <div
                key={item.id}
                className={cn(
                  'flex h-10 cursor-pointer items-center justify-between rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-2 shadow-xs hover:border-components-panel-border hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm',
                  selected.some(i => i.id === item.id) && 'border-[1.5px] border-components-option-card-option-selected-border bg-state-accent-hover shadow-xs hover:border-components-option-card-option-selected-border hover:bg-state-accent-hover hover:shadow-xs',
                  !item.embedding_available && 'hover:border-components-panel-border-subtle hover:bg-components-panel-on-panel-item-bg hover:shadow-xs',
                )}
                onClick={() => {
                  if (!item.embedding_available)
                    return
                  toggleSelect(item)
                }}
              >
                <div className='mr-1 flex items-center overflow-hidden'>
                  <div className={cn('mr-2', !item.embedding_available && 'opacity-30')}>
                    <AppIcon
                      size='tiny'
                      iconType={item.icon_info.icon_type}
                      icon={item.icon_info.icon}
                      background={item.icon_info.icon_type === 'image' ? undefined : item.icon_info.icon_background}
                      imageUrl={item.icon_info.icon_type === 'image' ? item.icon_info.icon_url : undefined}
                    />
                  </div>
                  <div className={cn('max-w-[200px] truncate text-[13px] font-medium text-text-secondary', !item.embedding_available && '!max-w-[120px] opacity-30')}>{item.name}</div>
                  {!item.embedding_available && (
                    <span className='ml-1 shrink-0 rounded-md border border-divider-deep px-1 text-xs font-normal leading-[18px] text-text-tertiary'>{t('dataset.unavailable')}</span>
                  )}
                </div>
                {
                  item.indexing_technique && (
                    <Badge
                      className='shrink-0'
                      text={formatIndexingTechniqueAndMethod(item.indexing_technique, item.retrieval_model_dict?.search_method)}
                    />
                  )
                }
                {
                  item.provider === 'external' && (
                    <Badge className='shrink-0' text={t('dataset.externalTag')} />
                  )
                }
              </div>
            ))}
            <div ref={anchorRef} className='h-0' />
          </div>
        </>
      )}
      {!isLoading && (
        <div className='mt-8 flex items-center justify-between'>
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
