'use client'
import type { FC, SVGProps } from 'react'
import React, { useEffect, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import {
  Cog8ToothIcon,
  DocumentTextIcon,
  PaperClipIcon,
} from '@heroicons/react/24/outline'
import {
  Cog8ToothIcon as Cog8ToothSolidIcon,
  // CommandLineIcon as CommandLineSolidIcon,
  DocumentTextIcon as DocumentTextSolidIcon,
} from '@heroicons/react/24/solid'
import { RiApps2AddLine, RiBookOpenLine, RiInformation2Line } from '@remixicon/react'
import s from './style.module.css'
import classNames from '@/utils/classnames'
import { fetchDatasetDetail, fetchDatasetRelatedApps } from '@/service/datasets'
import type { RelatedAppResponse } from '@/models/datasets'
import AppSideBar from '@/app/components/app-sidebar'
import Loading from '@/app/components/base/loading'
import DatasetDetailContext from '@/context/dataset-detail'
import { DataSourceType } from '@/models/datasets'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { LanguagesSupported } from '@/i18n/language'
import { useStore } from '@/app/components/app/store'
import { getLocaleOnClient } from '@/i18n'
import { useAppContext } from '@/context/app-context'
import Tooltip from '@/app/components/base/tooltip'
import LinkedAppsPanel from '@/app/components/base/linked-apps-panel'

export type IAppDetailLayoutProps = {
  children: React.ReactNode
  params: { datasetId: string }
}

const TargetIcon = ({ className }: SVGProps<SVGElement>) => {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className ?? ''}>
    <g clipPath="url(#clip0_4610_6951)">
      <path d="M10.6666 5.33325V3.33325L12.6666 1.33325L13.3332 2.66659L14.6666 3.33325L12.6666 5.33325H10.6666ZM10.6666 5.33325L7.9999 7.99988M14.6666 7.99992C14.6666 11.6818 11.6818 14.6666 7.99992 14.6666C4.31802 14.6666 1.33325 11.6818 1.33325 7.99992C1.33325 4.31802 4.31802 1.33325 7.99992 1.33325M11.3333 7.99992C11.3333 9.84087 9.84087 11.3333 7.99992 11.3333C6.15897 11.3333 4.66659 9.84087 4.66659 7.99992C4.66659 6.15897 6.15897 4.66659 7.99992 4.66659" stroke="#344054" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <defs>
      <clipPath id="clip0_4610_6951">
        <rect width="16" height="16" fill="white" />
      </clipPath>
    </defs>
  </svg>
}

const TargetSolidIcon = ({ className }: SVGProps<SVGElement>) => {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className={className ?? ''}>
    <path fillRule="evenodd" clipRule="evenodd" d="M12.7733 0.67512C12.9848 0.709447 13.1669 0.843364 13.2627 1.03504L13.83 2.16961L14.9646 2.73689C15.1563 2.83273 15.2902 3.01486 15.3245 3.22639C15.3588 3.43792 15.2894 3.65305 15.1379 3.80458L13.1379 5.80458C13.0128 5.92961 12.8433 5.99985 12.6665 5.99985H10.9426L8.47124 8.47124C8.21089 8.73159 7.78878 8.73159 7.52843 8.47124C7.26808 8.21089 7.26808 7.78878 7.52843 7.52843L9.9998 5.05707V3.33318C9.9998 3.15637 10.07 2.9868 10.1951 2.86177L12.1951 0.861774C12.3466 0.710244 12.5617 0.640794 12.7733 0.67512Z" fill="#155EEF" />
    <path d="M1.99984 7.99984C1.99984 4.68613 4.68613 1.99984 7.99984 1.99984C8.36803 1.99984 8.6665 1.70136 8.6665 1.33317C8.6665 0.964981 8.36803 0.666504 7.99984 0.666504C3.94975 0.666504 0.666504 3.94975 0.666504 7.99984C0.666504 12.0499 3.94975 15.3332 7.99984 15.3332C12.0499 15.3332 15.3332 12.0499 15.3332 7.99984C15.3332 7.63165 15.0347 7.33317 14.6665 7.33317C14.2983 7.33317 13.9998 7.63165 13.9998 7.99984C13.9998 11.3135 11.3135 13.9998 7.99984 13.9998C4.68613 13.9998 1.99984 11.3135 1.99984 7.99984Z" fill="#155EEF" />
    <path d="M5.33317 7.99984C5.33317 6.52708 6.52708 5.33317 7.99984 5.33317C8.36803 5.33317 8.6665 5.03469 8.6665 4.6665C8.6665 4.29831 8.36803 3.99984 7.99984 3.99984C5.7907 3.99984 3.99984 5.7907 3.99984 7.99984C3.99984 10.209 5.7907 11.9998 7.99984 11.9998C10.209 11.9998 11.9998 10.209 11.9998 7.99984C11.9998 7.63165 11.7014 7.33317 11.3332 7.33317C10.965 7.33317 10.6665 7.63165 10.6665 7.99984C10.6665 9.4726 9.4726 10.6665 7.99984 10.6665C6.52708 10.6665 5.33317 9.4726 5.33317 7.99984Z" fill="#155EEF" />
  </svg>
}

type IExtraInfoProps = {
  isMobile: boolean
  relatedApps?: RelatedAppResponse
  expand: boolean
}

const ExtraInfo = ({ isMobile, relatedApps, expand }: IExtraInfoProps) => {
  const locale = getLocaleOnClient()
  const [isShowTips, { toggle: toggleTips, set: setShowTips }] = useBoolean(!isMobile)
  const { t } = useTranslation()

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
            needsDelay
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

        {isMobile && <div className={classNames(s.subTitle, 'flex items-center justify-center !px-0 gap-1')}>
          {relatedAppsTotal || '--'}
          <PaperClipIcon className='h-4 w-4 text-gray-700' />
        </div>}
      </>
    )}
    {!hasRelatedApps && !expand && (
      <Tooltip
        position='right'
        noDecoration
        needsDelay
        popupContent={
          <div className='w-[240px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-4'>
            <div className='inline-flex rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle p-2'>
              <RiApps2AddLine className='h-4 w-4 text-text-tertiary' />
            </div>
            <div className='my-2 text-xs text-text-tertiary'>{t('common.datasetMenus.emptyTip')}</div>
            <a
              className='mt-2 inline-flex cursor-pointer items-center text-xs text-text-accent'
              href={
                locale === LanguagesSupported[1]
                  ? 'https://docs.dify.ai/v/zh-hans/guides/knowledge-base/integrate-knowledge-within-application'
                  : 'https://docs.dify.ai/guides/knowledge-base/integrate-knowledge-within-application'
              }
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
      { name: t('common.datasetMenus.hitTesting'), href: `/datasets/${datasetId}/hitTesting`, icon: TargetIcon, selectedIcon: TargetSolidIcon },
      // { name: 'api & webhook', href: `/datasets/${datasetId}/api`, icon: CommandLineIcon, selectedIcon: CommandLineSolidIcon },
      { name: t('common.datasetMenus.settings'), href: `/datasets/${datasetId}/settings`, icon: Cog8ToothIcon, selectedIcon: Cog8ToothSolidIcon },
    ]

    if (datasetRes?.provider !== 'external') {
      baseNavigation.unshift({
        name: t('common.datasetMenus.documents'),
        href: `/datasets/${datasetId}/documents`,
        icon: DocumentTextIcon,
        selectedIcon: DocumentTextSolidIcon,
      })
    }
    return baseNavigation
  }, [datasetRes?.provider, datasetId, t])

  useEffect(() => {
    if (datasetRes)
      document.title = `${datasetRes.name || 'Dataset'} - Dify`
  }, [datasetRes])

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
