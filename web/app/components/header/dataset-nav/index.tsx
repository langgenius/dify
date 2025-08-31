'use client'

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useRouter } from 'next/navigation'
import {
  RiBook2Fill,
  RiBook2Line,
} from '@remixicon/react'
import { flatten } from 'lodash-es'
import Nav from '../nav'
import type { NavItem } from '../nav/nav-selector'
import { basePath } from '@/utils/var'
import { useDatasetDetail, useDatasetList } from '@/service/knowledge/use-dataset'

const DatasetNav = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const { datasetId } = useParams()
  const { data: currentDataset } = useDatasetDetail(datasetId as string)
  const {
    data: datasetList,
    fetchNextPage,
    hasNextPage,
  } = useDatasetList({
    initialPage: 1,
    limit: 30,
  })
  const datasetItems = flatten(datasetList?.pages.map(datasetData => datasetData.data))

  const handleLoadMore = useCallback(() => {
    if (hasNextPage)
      fetchNextPage()
  }, [hasNextPage, fetchNextPage])

  return (
    <Nav
      isApp={false}
      icon={<RiBook2Line className='h-4 w-4' />}
      activeIcon={<RiBook2Fill className='h-4 w-4' />}
      text={t('common.menus.datasets')}
      activeSegment='datasets'
      link='/datasets'
      curNav={currentDataset && {
        id: currentDataset.id,
        name: currentDataset.name,
        icon: currentDataset.icon_info.icon,
        icon_type: currentDataset.icon_info.icon_type,
        icon_background: currentDataset.icon_info.icon_background,
        icon_url: currentDataset.icon_info.icon_url,
      } as Omit<NavItem, 'link'>}
      navigationItems={datasetItems.map(dataset => ({
        id: dataset.id,
        name: dataset.name,
        link: dataset.provider === 'external' ? `/datasets/${dataset.id}/hitTesting` : `/datasets/${dataset.id}/documents`,
        icon: dataset.icon_info.icon,
        icon_type: dataset.icon_info.icon_type,
        icon_background: dataset.icon_info.icon_background,
        icon_url: dataset.icon_info.icon_url,
      })) as NavItem[]}
      createText={t('common.menus.newDataset')}
      onCreate={() => router.push(`${basePath}/datasets/create`)}
      onLoadMore={handleLoadMore}
    />
  )
}

export default DatasetNav
