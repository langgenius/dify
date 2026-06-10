'use client'

import type { NavItem } from '../nav/nav-selector'
import type { DataSet, IconInfo } from '@/models/datasets'
import { flatten } from 'es-toolkit/compat'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useRouter } from '@/next/navigation'
import { useDatasetDetail, useDatasetList } from '@/service/knowledge/use-dataset'
import { basePath } from '@/utils/var'
import Nav from '../nav'

const DEFAULT_DATASET_ICON: IconInfo = {
  icon_type: 'emoji',
  icon: '📙',
  icon_background: '#FFF4ED',
  icon_url: '',
}

type NullableDatasetIconInfo = Partial<{
  [Key in keyof IconInfo]: IconInfo[Key] | null
}>

const normalizeDatasetIconInfo = (iconInfo?: NullableDatasetIconInfo | null): IconInfo => ({
  icon_type: iconInfo?.icon_type ?? DEFAULT_DATASET_ICON.icon_type,
  icon: iconInfo?.icon ?? DEFAULT_DATASET_ICON.icon,
  icon_background: iconInfo?.icon_background ?? DEFAULT_DATASET_ICON.icon_background,
  icon_url: iconInfo?.icon_url ?? DEFAULT_DATASET_ICON.icon_url,
})

const DatasetNav = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const { datasetId } = useParams()
  const { data: currentDataset } = useDatasetDetail(datasetId as string)
  const {
    data: datasetList,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDatasetList({
    initialPage: 1,
    limit: 30,
  })
  const datasetItems = flatten(datasetList?.pages.map(datasetData => datasetData.data))

  const curNav = useMemo(() => {
    if (!currentDataset)
      return
    const iconInfo = normalizeDatasetIconInfo(currentDataset.icon_info)
    return {
      id: currentDataset.id,
      name: currentDataset.name,
      icon: iconInfo.icon,
      icon_type: iconInfo.icon_type,
      icon_background: iconInfo.icon_background ?? null,
      icon_url: iconInfo.icon_url ?? null,
    } as Omit<NavItem, 'link'>
  }, [currentDataset])

  const getDatasetLink = useCallback((dataset: DataSet) => {
    const isPipelineUnpublished = dataset.runtime_mode === 'rag_pipeline' && !dataset.is_published
    const link = isPipelineUnpublished
      ? `/datasets/${dataset.id}/pipeline`
      : `/datasets/${dataset.id}/documents`
    return dataset.provider === 'external'
      ? `/datasets/${dataset.id}/hitTesting`
      : link
  }, [])

  const navigationItems = useMemo(() => {
    return datasetItems.map((dataset) => {
      const link = getDatasetLink(dataset)
      const iconInfo = normalizeDatasetIconInfo(dataset.icon_info)
      return {
        id: dataset.id,
        name: dataset.name,
        link,
        icon: iconInfo.icon,
        icon_type: iconInfo.icon_type,
        icon_background: iconInfo.icon_background ?? null,
        icon_url: iconInfo.icon_url ?? null,
      }
    }) as NavItem[]
  }, [datasetItems, getDatasetLink])

  const createRoute = useMemo(() => {
    const runtimeMode = currentDataset?.runtime_mode
    if (runtimeMode === 'rag_pipeline')
      return `${basePath}/datasets/create-from-pipeline`
    else
      return `${basePath}/datasets/create`
  }, [currentDataset?.runtime_mode])

  const handleLoadMore = useCallback(() => {
    if (hasNextPage)
      fetchNextPage()
  }, [hasNextPage, fetchNextPage])

  return (
    <Nav
      isApp={false}
      icon={<span className="i-ri-book-2-line size-4" />}
      activeIcon={<span className="i-ri-book-2-fill size-4" />}
      text={t('menus.datasets', { ns: 'common' })}
      activeSegment="datasets"
      link="/datasets"
      curNav={curNav}
      navigationItems={navigationItems}
      createText={t('menus.newDataset', { ns: 'common' })}
      onCreate={() => router.push(createRoute)}
      onLoadMore={handleLoadMore}
      isLoadingMore={isFetchingNextPage}
    />
  )
}

export default DatasetNav
