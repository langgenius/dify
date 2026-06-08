'use client'

import type { NavItem } from '../nav/nav-selector'
import type { DataSet, IconInfo } from '@/models/datasets'
import { flatten } from 'es-toolkit/compat'
import { useTranslation } from 'react-i18next'
import { useParams, useRouter } from '@/next/navigation'
import { useDatasetDetail, useDatasetList } from '@/service/knowledge/use-dataset'
import { basePath } from '@/utils/var'
import Nav from '../nav'

const DEFAULT_DATASET_ICON_INFO = {
  icon: '📙',
  icon_type: 'emoji',
  icon_background: '#FFF4ED',
  icon_url: '',
} satisfies IconInfo

type NullableDatasetIconInfo = Partial<{
  [Key in keyof IconInfo]: IconInfo[Key] | null
}>

function normalizeDatasetIconInfo(iconInfo?: NullableDatasetIconInfo | null): IconInfo {
  return {
    icon: iconInfo?.icon ?? DEFAULT_DATASET_ICON_INFO.icon,
    icon_type: iconInfo?.icon_type ?? DEFAULT_DATASET_ICON_INFO.icon_type,
    icon_background: iconInfo?.icon_background ?? DEFAULT_DATASET_ICON_INFO.icon_background,
    icon_url: iconInfo?.icon_url ?? DEFAULT_DATASET_ICON_INFO.icon_url,
  }
}

function datasetLink(dataset: DataSet) {
  const isPipelineUnpublished = dataset.runtime_mode === 'rag_pipeline' && !dataset.is_published
  const link = isPipelineUnpublished
    ? `/datasets/${dataset.id}/pipeline`
    : `/datasets/${dataset.id}/documents`

  return dataset.provider === 'external'
    ? `/datasets/${dataset.id}/hitTesting`
    : link
}

function currentDatasetNavItem(dataset: DataSet) {
  const iconInfo = normalizeDatasetIconInfo(dataset.icon_info)

  return {
    id: dataset.id,
    name: dataset.name,
    icon: iconInfo.icon,
    icon_type: iconInfo.icon_type,
    icon_background: iconInfo.icon_background ?? null,
    icon_url: iconInfo.icon_url ?? null,
  } satisfies Omit<NavItem, 'link'>
}

function datasetNavItem(dataset: DataSet) {
  const iconInfo = normalizeDatasetIconInfo(dataset.icon_info)

  return {
    id: dataset.id,
    name: dataset.name,
    link: datasetLink(dataset),
    icon: iconInfo.icon,
    icon_type: iconInfo.icon_type,
    icon_background: iconInfo.icon_background ?? null,
    icon_url: iconInfo.icon_url ?? null,
  } satisfies NavItem
}

export function DatasetNav() {
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

  const curNav = currentDataset ? currentDatasetNavItem(currentDataset) : undefined
  const navigationItems = datasetItems.map(datasetNavItem)
  const runtimeMode = currentDataset?.runtime_mode
  const createRoute = runtimeMode === 'rag_pipeline'
    ? `${basePath}/datasets/create-from-pipeline`
    : `${basePath}/datasets/create`

  function handleLoadMore() {
    if (hasNextPage && !isFetchingNextPage)
      void fetchNextPage()
  }

  return (
    <Nav
      isApp={false}
      icon={<span aria-hidden className="i-ri-book-2-line size-4" />}
      activeIcon={<span aria-hidden className="i-ri-book-2-fill size-4" />}
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
