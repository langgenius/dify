'use client'
import type { FC } from 'react'
import type { DataSet } from '@/models/datasets'
import { useInfiniteScroll } from 'ahooks'
import Link from 'next/link'
import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import Modal from '@/app/components/base/modal'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import FeatureIcon from '@/app/components/header/account-setting/model-provider-page/model-selector/feature-icon'
import { useKnowledge } from '@/hooks/use-knowledge'
import { useInfiniteDatasets } from '@/service/knowledge/use-dataset'
import { cn } from '@/utils/classnames'

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
  const canSelectMulti = true
  const { formatIndexingTechniqueAndMethod } = useKnowledge()
  const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage } = useInfiniteDatasets(
    { page: 1 },
    { enabled: isShow, staleTime: 0, refetchOnMount: 'always' },
  )
  const pages = data?.pages || []
  const datasets = useMemo(() => {
    return pages.flatMap(page => page.data.filter(item => item.indexing_technique || item.provider === 'external'))
  }, [pages])
  const hasNoData = !isLoading && datasets.length === 0

  const listRef = useRef<HTMLDivElement>(null)
  const isNoMore = hasNextPage === false

  useInfiniteScroll(
    async () => {
      if (!hasNextPage || isFetchingNextPage)
        return { list: [] }
      await fetchNextPage()
      return { list: [] }
    },
    {
      target: listRef,
      isNoMore: () => isNoMore,
      reloadDeps: [isNoMore, isFetchingNextPage],
    },
  )

  const prevSelectedIdsRef = useRef<string[]>([])
  const hasUserModifiedSelectionRef = useRef(false)
  useEffect(() => {
    if (isShow)
      hasUserModifiedSelectionRef.current = false
  }, [isShow])
  useEffect(() => {
    const prevSelectedIds = prevSelectedIdsRef.current
    const idsChanged = selectedIds.length !== prevSelectedIds.length
      || selectedIds.some((id, idx) => id !== prevSelectedIds[idx])

    if (!selectedIds.length && (!hasUserModifiedSelectionRef.current || idsChanged)) {
      setSelected([])
      prevSelectedIdsRef.current = selectedIds
      hasUserModifiedSelectionRef.current = false
      return
    }

    if (!idsChanged && hasUserModifiedSelectionRef.current)
      return

    setSelected((prev) => {
      const prevMap = new Map(prev.map(item => [item.id, item]))
      const nextSelected = selectedIds
        .map(id => datasets.find(item => item.id === id) || prevMap.get(id))
        .filter(Boolean) as DataSet[]
      return nextSelected
    })
    prevSelectedIdsRef.current = selectedIds
    hasUserModifiedSelectionRef.current = false
  }, [datasets, selectedIds])

  const toggleSelect = (dataSet: DataSet) => {
    hasUserModifiedSelectionRef.current = true
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
      className="w-[400px]"
      title={t('feature.dataSet.selectTitle', { ns: 'appDebug' })}
    >
      {(isLoading && datasets.length === 0) && (
        <div className="flex h-[200px]">
          <Loading type="area" />
        </div>
      )}

      {hasNoData && (
        <div
          className="mt-6 flex h-[128px] items-center justify-center space-x-1  rounded-lg border text-[13px]"
          style={{
            background: 'rgba(0, 0, 0, 0.02)',
            borderColor: 'rgba(0, 0, 0, 0.02',
          }}
        >
          <span className="text-text-tertiary">{t('feature.dataSet.noDataSet', { ns: 'appDebug' })}</span>
          <Link href="/datasets/create" className="font-normal text-text-accent">{t('feature.dataSet.toCreate', { ns: 'appDebug' })}</Link>
        </div>
      )}

      {datasets.length > 0 && (
        <>
          <div ref={listRef} className="mt-7 max-h-[286px] space-y-1 overflow-y-auto">
            {datasets.map(item => (
              <div
                key={item.id}
                className={cn(
                  'flex h-10 cursor-pointer items-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-2 shadow-xs hover:border-components-panel-border hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm',
                  selected.some(i => i.id === item.id) && 'border-[1.5px] border-components-option-card-option-selected-border bg-state-accent-hover shadow-xs hover:border-components-option-card-option-selected-border hover:bg-state-accent-hover hover:shadow-xs',
                  !item.embedding_available && 'hover:border-components-panel-border-subtle hover:bg-components-panel-on-panel-item-bg hover:shadow-xs',
                )}
                onClick={() => {
                  if (!item.embedding_available)
                    return
                  toggleSelect(item)
                }}
              >
                <div className="mr-1 flex grow items-center overflow-hidden">
                  <div className={cn('mr-2', !item.embedding_available && 'opacity-30')}>
                    <AppIcon
                      size="tiny"
                      iconType={item.icon_info.icon_type}
                      icon={item.icon_info.icon}
                      background={item.icon_info.icon_type === 'image' ? undefined : item.icon_info.icon_background}
                      imageUrl={item.icon_info.icon_type === 'image' ? item.icon_info.icon_url : undefined}
                    />
                  </div>
                  <div className={cn('max-w-[200px] truncate text-[13px] font-medium text-text-secondary', !item.embedding_available && '!max-w-[120px] opacity-30')}>{item.name}</div>
                  {!item.embedding_available && (
                    <span className="ml-1 shrink-0 rounded-md border border-divider-deep px-1 text-xs font-normal leading-[18px] text-text-tertiary">{t('unavailable', { ns: 'dataset' })}</span>
                  )}
                </div>
                {item.is_multimodal && (
                  <div className="mr-1 shrink-0">
                    <FeatureIcon feature={ModelFeatureEnum.vision} />
                  </div>
                )}
                {
                  !!item.indexing_technique && (
                    <Badge
                      className="shrink-0"
                      text={formatIndexingTechniqueAndMethod(item.indexing_technique, item.retrieval_model_dict?.search_method)}
                    />
                  )
                }
                {
                  item.provider === 'external' && (
                    <Badge className="shrink-0" text={t('externalTag', { ns: 'dataset' })} />
                  )
                }
              </div>
            ))}
            {isFetchingNextPage && <Loading />}
          </div>
        </>
      )}
      {!isLoading && (
        <div className="mt-8 flex items-center justify-between">
          <div className="text-sm  font-medium text-text-secondary">
            {selected.length > 0 && `${selected.length} ${t('feature.dataSet.selected', { ns: 'appDebug' })}`}
          </div>
          <div className="flex space-x-2">
            <Button onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
            <Button variant="primary" onClick={handleSelect} disabled={hasNoData}>{t('operation.add', { ns: 'common' })}</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
export default React.memo(SelectDataSet)
