'use client'
import type { FC } from 'react'
import type { DataSet } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useInfiniteScroll } from 'ahooks'
import * as React from 'react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Badge from '@/app/components/base/badge'
import Loading from '@/app/components/base/loading'
import { ModelFeatureEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import FeatureIcon from '@/app/components/header/account-setting/model-provider-page/model-selector/feature-icon'
import { useKnowledge } from '@/hooks/use-knowledge'
import Link from '@/next/link'
import { useInfiniteDatasets } from '@/service/knowledge/use-dataset'

type ISelectDataSetProps = {
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
  const [selectedIdsInModal, setSelectedIdsInModal] = useState(() => selectedIds)
  const canSelectMulti = true
  const { formatIndexingTechniqueAndMethod } = useKnowledge()
  const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage } = useInfiniteDatasets(
    { page: 1 },
    { enabled: isShow, staleTime: 0, refetchOnMount: 'always' },
  )
  const datasets = useMemo(() => {
    const pages = data?.pages || []
    return pages.flatMap(page => page.data.filter(item => item.indexing_technique || item.provider === 'external'))
  }, [data])
  const datasetMap = useMemo(() => new Map(datasets.map(item => [item.id, item])), [datasets])
  const selected = useMemo(() => {
    return selectedIdsInModal.map(id => datasetMap.get(id) || ({ id } as DataSet))
  }, [datasetMap, selectedIdsInModal])
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

  const toggleSelect = (dataSet: DataSet) => {
    setSelectedIdsInModal((prev) => {
      const isSelected = prev.includes(dataSet.id)
      if (isSelected)
        return prev.filter(id => id !== dataSet.id)

      return canSelectMulti ? [...prev, dataSet.id] : [dataSet.id]
    })
  }

  const handleSelect = () => {
    onSelect(selected)
  }

  const handleClose = useCallback(() => {
    setSelectedIdsInModal(selectedIds)
    onClose()
  }, [onClose, selectedIds])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open)
      handleClose()
  }, [handleClose])

  return (
    <Dialog open={isShow} onOpenChange={handleOpenChange}>
      <DialogContent className="w-100 overflow-hidden">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t('feature.dataSet.selectTitle', { ns: 'appDebug' })}
        </DialogTitle>
        <DialogCloseButton aria-label={t('operation.close', { ns: 'common' })} />
        {(isLoading && datasets.length === 0) && (
          <div className="flex h-50">
            <Loading type="area" />
          </div>
        )}

        {hasNoData && (
          <div className="mt-6 flex h-32 items-center justify-center space-x-1 rounded-lg border border-divider-subtle bg-components-panel-on-panel-item-bg text-[13px]">
            <span className="text-text-tertiary">{t('feature.dataSet.noDataSet', { ns: 'appDebug' })}</span>
            <Link href="/datasets/create" className="font-normal text-text-accent">{t('feature.dataSet.toCreate', { ns: 'appDebug' })}</Link>
          </div>
        )}

        {datasets.length > 0 && (
          <>
            <div ref={listRef} className="mt-7 max-h-71.5 space-y-1 overflow-y-auto">
              {datasets.map(item => (
                <button
                  key={item.id}
                  type="button"
                  disabled={!item.embedding_available}
                  className={cn(
                    'flex h-10 w-full cursor-pointer items-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-components-panel-on-panel-item-bg px-2 text-left shadow-xs outline-hidden hover:border-components-panel-border hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                    selectedIdsInModal.includes(item.id) && 'border-[1.5px] border-components-option-card-option-selected-border bg-state-accent-hover shadow-xs hover:border-components-option-card-option-selected-border hover:bg-state-accent-hover hover:shadow-xs',
                    !item.embedding_available && 'cursor-default hover:border-components-panel-border-subtle hover:bg-components-panel-on-panel-item-bg hover:shadow-xs',
                  )}
                  onClick={() => toggleSelect(item)}
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
                    <div className={cn('max-w-50 truncate text-[13px] font-medium text-text-secondary', !item.embedding_available && 'max-w-30! opacity-30')}>{item.name}</div>
                    {!item.embedding_available && (
                      <span className="ml-1 shrink-0 rounded-md border border-divider-deep px-1 text-xs leading-[18px] font-normal text-text-tertiary">{t('unavailable', { ns: 'dataset' })}</span>
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
                </button>
              ))}
              {isFetchingNextPage && <Loading />}
            </div>
          </>
        )}
        {!isLoading && (
          <div className="mt-8 flex items-center justify-between">
            <div className="text-sm font-medium text-text-secondary">
              {selected.length > 0 && `${selected.length} ${t('feature.dataSet.selected', { ns: 'appDebug' })}`}
            </div>
            <div className="flex space-x-2">
              <Button onClick={handleClose}>{t('operation.cancel', { ns: 'common' })}</Button>
              <Button variant="primary" onClick={handleSelect} disabled={hasNoData}>{t('operation.add', { ns: 'common' })}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(SelectDataSet)
