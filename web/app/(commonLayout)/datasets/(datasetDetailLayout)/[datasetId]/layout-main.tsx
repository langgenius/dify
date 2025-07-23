'use client'
import type { FC } from 'react'
import React, { useEffect, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import {
  RiEqualizer2Fill,
  RiEqualizer2Line,
  RiFileTextFill,
  RiFileTextLine,
  RiFocus2Fill,
  RiFocus2Line,
} from '@remixicon/react'
import {
  PaperClipIcon,
} from '@heroicons/react/24/outline'
import { RiApps2AddLine, RiBookOpenLine, RiInformation2Line } from '@remixicon/react'
import classNames from '@/utils/classnames'
import { fetchDatasetDetail, fetchDatasetRelatedApps } from '@/service/datasets'
import type { RelatedAppResponse } from '@/models/datasets'
import AppSideBar from '@/app/components/app-sidebar'
import Loading from '@/app/components/base/loading'
import DatasetDetailContext from '@/context/dataset-detail'
import { DataSourceType } from '@/models/datasets'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useStore } from '@/app/components/app/store'
import { useDocLink } from '@/context/i18n'
import { useAppContext } from '@/context/app-context'
import Tooltip from '@/app/components/base/tooltip'
import LinkedAppsPanel from '@/app/components/base/linked-apps-panel'
import useDocumentTitle from '@/hooks/use-document-title'

export type IAppDetailLayoutProps = {
  children: React.ReactNode
  params: { datasetId: string }
}

type IExtraInfoProps = {
  isMobile: boolean
  relatedApps?: RelatedAppResponse
  expand: boolean
}

const ExtraInfo = ({ isMobile, relatedApps, expand }: IExtraInfoProps) => {
  const [isShowTips, { toggle: toggleTips, set: setShowTips }] = useBoolean(!isMobile)
  const { t } = useTranslation()
  const docLink = useDocLink()

  const hasRelatedApps = relatedApps?.data && relatedApps?.data?.length > 0
  const relatedAppsTotal = relatedApps?.data?.length || 0

  useEffect(() => {
    setShowTips(!isMobile)
  }, [isMobile, setShowTips])

  return <div>
    {hasRelatedApps && (
      <>
        {!isMobile && (
          <Tooltip
            position='right'
            noDecoration
            popupContent={
              <LinkedAppsPanel
                relatedApps={relatedApps.data}
                isMobile={isMobile}
              />
            }
          >
            <div className='system-xs-medium-uppercase inline-flex cursor-pointer items-center space-x-1 text-text-secondary'>
              <span>{relatedAppsTotal || '--'} {t('common.datasetMenus.relatedApp')}</span>
              <RiInformation2Line className='h-4 w-4' />
            </div>
          </Tooltip>
        )}

        {isMobile && <div className={classNames('pb-2 pt-4 text-xs font-medium uppercase text-text-tertiary', 'flex items-center justify-center gap-1 !px-0')}>
          {relatedAppsTotal || '--'}
          <PaperClipIcon className='h-4 w-4 text-text-secondary' />
        </div>}
      </>
    )}
    {!hasRelatedApps && !expand && (
      <Tooltip
        position='right'
        noDecoration
        popupContent={
          <div className='w-[240px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-4'>
            <div className='inline-flex rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle p-2'>
              <RiApps2AddLine className='h-4 w-4 text-text-tertiary' />
            </div>
            <div className='my-2 text-xs text-text-tertiary'>{t('common.datasetMenus.emptyTip')}</div>
            <a
              className='mt-2 inline-flex cursor-pointer items-center text-xs text-text-accent'
              href={docLink('/guides/knowledge-base/integrate-knowledge-within-application')}
              target='_blank' rel='noopener noreferrer'
            >
              <RiBookOpenLine className='mr-1 text-text-accent' />
              {t('common.datasetMenus.viewDoc')}
            </a>
          </div>
        }
      >
        <div className='system-xs-medium-uppercase inline-flex cursor-pointer items-center space-x-1 text-text-secondary'>
          <span>{t('common.datasetMenus.noRelatedApp')}</span>
          <RiInformation2Line className='h-4 w-4' />
        </div>
      </Tooltip>
    )}
  </div>
}

const DatasetDetailLayout: FC<IAppDetailLayoutProps> = (props) => {
  const {
    children,
    params: { datasetId },
  } = props
  const pathname = usePathname()
  const hideSideBar = /documents\/create$/.test(pathname)
  const { t } = useTranslation()
  const { isCurrentWorkspaceDatasetOperator } = useAppContext()

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const { data: datasetRes, error, mutate: mutateDatasetRes } = useSWR({
    url: 'fetchDatasetDetail',
    datasetId,
  }, apiParams => fetchDatasetDetail(apiParams.datasetId))

  const { data: relatedApps } = useSWR({
    action: 'fetchDatasetRelatedApps',
    datasetId,
  }, apiParams => fetchDatasetRelatedApps(apiParams.datasetId))

  const navigation = useMemo(() => {
    const baseNavigation = [
      { name: t('common.datasetMenus.hitTesting'), href: `/datasets/${datasetId}/hitTesting`, icon: RiFocus2Line, selectedIcon: RiFocus2Fill },
      { name: t('common.datasetMenus.settings'), href: `/datasets/${datasetId}/settings`, icon: RiEqualizer2Line, selectedIcon: RiEqualizer2Fill },
    ]

    if (datasetRes?.provider !== 'external') {
      baseNavigation.unshift({
        name: t('common.datasetMenus.documents'),
        href: `/datasets/${datasetId}/documents`,
        icon: RiFileTextLine,
        selectedIcon: RiFileTextFill,
      })
    }
    return baseNavigation
  }, [datasetRes?.provider, datasetId, t])

  useDocumentTitle(datasetRes?.name || t('common.menus.datasets'))

  const setAppSiderbarExpand = useStore(state => state.setAppSiderbarExpand)

  useEffect(() => {
    const localeMode = localStorage.getItem('app-detail-collapse-or-expand') || 'expand'
    const mode = isMobile ? 'collapse' : 'expand'
    setAppSiderbarExpand(isMobile ? mode : localeMode)
  }, [isMobile, setAppSiderbarExpand])

  if (!datasetRes && !error)
    return <Loading type='app' />

  return (
    <div className='flex grow overflow-hidden'>
      {!hideSideBar && <AppSideBar
        title={datasetRes?.name || '--'}
        icon={datasetRes?.icon || 'https://static.dify.ai/images/dataset-default-icon.png'}
        icon_background={datasetRes?.icon_background || '#F5F5F5'}
        desc={datasetRes?.description || '--'}
        isExternal={datasetRes?.provider === 'external'}
        navigation={navigation}
        extraInfo={!isCurrentWorkspaceDatasetOperator ? mode => <ExtraInfo isMobile={mode === 'collapse'} relatedApps={relatedApps} expand={mode === 'collapse'} /> : undefined}
        iconType={datasetRes?.data_source_type === DataSourceType.NOTION ? 'notion' : 'dataset'}
      />}
      <DatasetDetailContext.Provider value={{
        indexingTechnique: datasetRes?.indexing_technique,
        dataset: datasetRes,
        mutateDatasetRes: () => mutateDatasetRes(),
      }}>
        <div className="grow overflow-hidden bg-background-default-subtle">{children}</div>
      </DatasetDetailContext.Provider>
    </div>
  )
}
export default React.memo(DatasetDetailLayout)
