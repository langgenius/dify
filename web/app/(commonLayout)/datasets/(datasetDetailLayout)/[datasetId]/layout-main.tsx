'use client'
import type { FC } from 'react'
import React, { useEffect, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import type { RemixiconComponentType } from '@remixicon/react'
import {
  RiAttachmentLine,
  RiEqualizer2Fill,
  RiEqualizer2Line,
  RiFileTextFill,
  RiFileTextLine,
  RiFocus2Fill,
  RiFocus2Line,
} from '@remixicon/react'
import { RiInformation2Line } from '@remixicon/react'
import classNames from '@/utils/classnames'
import type { RelatedAppResponse } from '@/models/datasets'
import AppSideBar from '@/app/components/app-sidebar'
import Loading from '@/app/components/base/loading'
import DatasetDetailContext from '@/context/dataset-detail'
import { DataSourceType } from '@/models/datasets'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { useStore } from '@/app/components/app/store'
import { useAppContext } from '@/context/app-context'
import Tooltip from '@/app/components/base/tooltip'
import LinkedAppsPanel from '@/app/components/base/linked-apps-panel'
import { PipelineFill, PipelineLine } from '@/app/components/base/icons/src/vender/pipeline'
import { Divider } from '@/app/components/base/icons/src/vender/knowledge'
import NoLinkedAppsPanel from '@/app/components/datasets/no-linked-apps-panel'
import { useDatasetDetail, useDatasetRelatedApps } from '@/service/knowledge/use-dataset'

export type IAppDetailLayoutProps = {
  children: React.ReactNode
  params: { datasetId: string }
}

type IExtraInfoProps = {
  relatedApps?: RelatedAppResponse
  documentCount?: number
  expand: boolean
}

const ExtraInfo = React.memo(({
  relatedApps,
  documentCount,
  expand,
}: IExtraInfoProps) => {
  const { t } = useTranslation()

  const hasRelatedApps = relatedApps?.data && relatedApps?.data?.length > 0
  const relatedAppsTotal = relatedApps?.data?.length || 0

  return (
    <>
      {!expand && (
        <div className='flex items-center gap-x-0.5'>
          <div className='flex grow flex-col px-2 pb-1.5 pt-1'>
            <div className='system-md-semibold-uppercase text-text-secondary'>
              {documentCount ?? '--'}
            </div>
            <div className='system-2xs-medium-uppercase text-text-tertiary'>
              {t('common.datasetMenus.documents')}
            </div>
          </div>
          <div className='py-2 pl-0.5 pr-1.5'>
            <Divider className='text-test-divider-regular h-full w-fit' />
          </div>
          <div className='flex grow flex-col px-2 pb-1.5 pt-1'>
            <div className='system-md-semibold-uppercase text-text-secondary'>
              {relatedAppsTotal ?? '--'}
            </div>
            <Tooltip
              position='bottom-start'
              noDecoration
              needsDelay
              popupContent={
                hasRelatedApps ? (
                  <LinkedAppsPanel
                    relatedApps={relatedApps.data}
                    isMobile={expand}
                  />
                ) : <NoLinkedAppsPanel />
              }
            >
              <div className='system-2xs-medium-uppercase flex cursor-pointer items-center gap-x-0.5 text-text-tertiary'>
                <span>{t('common.datasetMenus.relatedApp')}</span>
                <RiInformation2Line className='size-3' />
              </div>
            </Tooltip>
          </div>
        </div>
      )}

      {expand && (
        <div className={classNames('uppercase text-xs text-text-tertiary font-medium pb-2 pt-4', 'flex items-center justify-center !px-0 gap-1')}>
          {relatedAppsTotal ?? '--'}
          <RiAttachmentLine className='size-4 text-text-secondary' />
        </div>
      )}
    </>
  )
})

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

  const { data: datasetRes, error, refetch: mutateDatasetRes } = useDatasetDetail(datasetId)

  const { data: relatedApps } = useDatasetRelatedApps(datasetId)

  const navigation = useMemo(() => {
    const baseNavigation = [
      { name: t('common.datasetMenus.hitTesting'), href: `/datasets/${datasetId}/hitTesting`, icon: RiFocus2Line, selectedIcon: RiFocus2Fill },
      { name: t('common.datasetMenus.settings'), href: `/datasets/${datasetId}/settings`, icon: RiEqualizer2Line, selectedIcon: RiEqualizer2Fill },
    ]

    if (datasetRes?.provider !== 'external') {
      baseNavigation.unshift(...[{
        name: t('common.datasetMenus.documents'),
        href: `/datasets/${datasetId}/documents`,
        icon: RiFileTextLine,
        selectedIcon: RiFileTextFill,
      }, {
        name: t('common.datasetMenus.pipeline'),
        href: `/datasets/${datasetId}/pipeline`,
        icon: PipelineLine as RemixiconComponentType,
        selectedIcon: PipelineFill as RemixiconComponentType,
      }])
    }
    return baseNavigation
  }, [datasetRes?.provider, datasetId, t])

  useEffect(() => {
    if (datasetRes)
      document.title = `${datasetRes.name || 'Dataset'} - Dify`
  }, [datasetRes])

  const setAppSidebarExpand = useStore(state => state.setAppSidebarExpand)

  useEffect(() => {
    const localeMode = localStorage.getItem('app-detail-collapse-or-expand') || 'expand'
    const mode = isMobile ? 'collapse' : 'expand'
    setAppSidebarExpand(isMobile ? mode : localeMode)
  }, [isMobile, setAppSidebarExpand])

  if (!datasetRes && !error)
    return <Loading type='app' />

  return (
    <div className='flex grow overflow-hidden'>
      <DatasetDetailContext.Provider value={{
        indexingTechnique: datasetRes?.indexing_technique,
        dataset: datasetRes,
        mutateDatasetRes,
      }}>
        {!hideSideBar && (
          <AppSideBar
            navigation={navigation}
            extraInfo={
              !isCurrentWorkspaceDatasetOperator
                ? mode => <ExtraInfo relatedApps={relatedApps} expand={mode === 'collapse'} documentCount={datasetRes?.document_count} />
                : undefined
            }
            iconType={datasetRes?.data_source_type === DataSourceType.NOTION ? 'notion' : 'dataset'}
          />
        )}
        <div className="grow overflow-hidden bg-background-default-subtle">{children}</div>
      </DatasetDetailContext.Provider>
    </div>
  )
}
export default React.memo(DatasetDetailLayout)
