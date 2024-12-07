'use client'
import type { FC, SVGProps } from 'react'
import React, { useEffect, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import {
  Cog8ToothIcon,
  // CommandLineIcon,
  Squares2X2Icon,
  // eslint-disable-next-line sort-imports
  PuzzlePieceIcon,
  DocumentTextIcon,
  PaperClipIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline'
import {
  Cog8ToothIcon as Cog8ToothSolidIcon,
  // CommandLineIcon as CommandLineSolidIcon,
  DocumentTextIcon as DocumentTextSolidIcon,
} from '@heroicons/react/24/solid'
import Link from 'next/link'
import s from './style.module.css'
import classNames from '@/utils/classnames'
import { fetchDatasetDetail, fetchDatasetRelatedApps } from '@/service/datasets'
import type { RelatedApp, RelatedAppResponse } from '@/models/datasets'
import AppSideBar from '@/app/components/app-sidebar'
import Divider from '@/app/components/base/divider'
import AppIcon from '@/app/components/base/app-icon'
import Loading from '@/app/components/base/loading'
import FloatPopoverContainer from '@/app/components/base/float-popover-container'
import DatasetDetailContext from '@/context/dataset-detail'
import { DataSourceType } from '@/models/datasets'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import { LanguagesSupported } from '@/i18n/language'
import { useStore } from '@/app/components/app/store'
import { AiText, ChatBot, CuteRobot } from '@/app/components/base/icons/src/vender/solid/communication'
import { Route } from '@/app/components/base/icons/src/vender/solid/mapsAndTravel'
import { getLocaleOnClient } from '@/i18n'
import { useAppContext } from '@/context/app-context'

export type IAppDetailLayoutProps = {
  children: React.ReactNode
  params: { datasetId: string }
}

type ILikedItemProps = {
  type?: 'plugin' | 'app'
  appStatus?: boolean
  detail: RelatedApp
  isMobile: boolean
}

const LikedItem = ({
  type = 'app',
  detail,
  isMobile,
}: ILikedItemProps) => {
  return (
    <Link className={classNames(s.itemWrapper, 'px-2', isMobile && 'justify-center')} href={`/app/${detail?.id}/overview`}>
      <div className={classNames(s.iconWrapper, 'mr-0')}>
        <AppIcon size='tiny' iconType={detail.icon_type} icon={detail.icon} background={detail.icon_background} imageUrl={detail.icon_url} />
        {type === 'app' && (
          <span className='absolute bottom-[-2px] right-[-2px] w-3.5 h-3.5 p-0.5 bg-white rounded border-[0.5px] border-[rgba(0,0,0,0.02)] shadow-sm'>
            {detail.mode === 'advanced-chat' && (
              <ChatBot className='w-2.5 h-2.5 text-[#1570EF]' />
            )}
            {detail.mode === 'agent-chat' && (
              <CuteRobot className='w-2.5 h-2.5 text-indigo-600' />
            )}
            {detail.mode === 'chat' && (
              <ChatBot className='w-2.5 h-2.5 text-[#1570EF]' />
            )}
            {detail.mode === 'completion' && (
              <AiText className='w-2.5 h-2.5 text-[#0E9384]' />
            )}
            {detail.mode === 'workflow' && (
              <Route className='w-2.5 h-2.5 text-[#f79009]' />
            )}
          </span>
        )}
      </div>
      {!isMobile && <div className={classNames(s.appInfo, 'ml-2')}>{detail?.name || '--'}</div>}
    </Link>
  )
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

const BookOpenIcon = ({ className }: SVGProps<SVGElement>) => {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" className={className ?? ''}>
    <path opacity="0.12" d="M1 3.1C1 2.53995 1 2.25992 1.10899 2.04601C1.20487 1.85785 1.35785 1.70487 1.54601 1.60899C1.75992 1.5 2.03995 1.5 2.6 1.5H2.8C3.9201 1.5 4.48016 1.5 4.90798 1.71799C5.28431 1.90973 5.59027 2.21569 5.78201 2.59202C6 3.01984 6 3.5799 6 4.7V10.5L5.94997 10.425C5.60265 9.90398 5.42899 9.64349 5.19955 9.45491C4.99643 9.28796 4.76238 9.1627 4.5108 9.0863C4.22663 9 3.91355 9 3.28741 9H2.6C2.03995 9 1.75992 9 1.54601 8.89101C1.35785 8.79513 1.20487 8.64215 1.10899 8.45399C1 8.24008 1 7.96005 1 7.4V3.1Z" fill="#155EEF" />
    <path d="M6 10.5L5.94997 10.425C5.60265 9.90398 5.42899 9.64349 5.19955 9.45491C4.99643 9.28796 4.76238 9.1627 4.5108 9.0863C4.22663 9 3.91355 9 3.28741 9H2.6C2.03995 9 1.75992 9 1.54601 8.89101C1.35785 8.79513 1.20487 8.64215 1.10899 8.45399C1 8.24008 1 7.96005 1 7.4V3.1C1 2.53995 1 2.25992 1.10899 2.04601C1.20487 1.85785 1.35785 1.70487 1.54601 1.60899C1.75992 1.5 2.03995 1.5 2.6 1.5H2.8C3.9201 1.5 4.48016 1.5 4.90798 1.71799C5.28431 1.90973 5.59027 2.21569 5.78201 2.59202C6 3.01984 6 3.5799 6 4.7M6 10.5V4.7M6 10.5L6.05003 10.425C6.39735 9.90398 6.57101 9.64349 6.80045 9.45491C7.00357 9.28796 7.23762 9.1627 7.4892 9.0863C7.77337 9 8.08645 9 8.71259 9H9.4C9.96005 9 10.2401 9 10.454 8.89101C10.6422 8.79513 10.7951 8.64215 10.891 8.45399C11 8.24008 11 7.96005 11 7.4V3.1C11 2.53995 11 2.25992 10.891 2.04601C10.7951 1.85785 10.6422 1.70487 10.454 1.60899C10.2401 1.5 9.96005 1.5 9.4 1.5H9.2C8.07989 1.5 7.51984 1.5 7.09202 1.71799C6.71569 1.90973 6.40973 2.21569 6.21799 2.59202C6 3.01984 6 3.5799 6 4.7" stroke="#155EEF" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

type IExtraInfoProps = {
  isMobile: boolean
  relatedApps?: RelatedAppResponse
}

const ExtraInfo = ({ isMobile, relatedApps }: IExtraInfoProps) => {
  const locale = getLocaleOnClient()
  const [isShowTips, { toggle: toggleTips, set: setShowTips }] = useBoolean(!isMobile)
  const { t } = useTranslation()

  useEffect(() => {
    setShowTips(!isMobile)
  }, [isMobile, setShowTips])

  return <div className='w-full flex flex-col items-center'>
    <Divider className='mt-5' />
    {(relatedApps?.data && relatedApps?.data?.length > 0) && (
      <>
        {!isMobile && <div className='w-full px-2 pb-1 pt-4 uppercase text-xs text-gray-500 font-medium'>{relatedApps?.total || '--'} {t('common.datasetMenus.relatedApp')}</div>}
        {isMobile && <div className={classNames(s.subTitle, 'flex items-center justify-center !px-0 gap-1')}>
          {relatedApps?.total || '--'}
          <PaperClipIcon className='h-4 w-4 text-gray-700' />
        </div>}
        {relatedApps?.data?.map((item, index) => (<LikedItem key={index} isMobile={isMobile} detail={item} />))}
      </>
    )}
    {!relatedApps?.data?.length && (
      <FloatPopoverContainer
        placement='bottom-start'
        open={isShowTips}
        toggle={toggleTips}
        isMobile={isMobile}
        triggerElement={
          <div className={classNames('h-7 w-7 inline-flex justify-center items-center rounded-lg bg-transparent', isShowTips && '!bg-gray-50')}>
            <QuestionMarkCircleIcon className='h-4 w-4 flex-shrink-0 text-gray-500' />
          </div>
        }
      >
        <div className={classNames('mt-5 p-3', isMobile && 'border-[0.5px] border-gray-200 shadow-lg rounded-lg bg-white w-[160px]')}>
          <div className='flex items-center justify-start gap-2'>
            <div className={s.emptyIconDiv}>
              <Squares2X2Icon className='w-3 h-3 text-gray-500' />
            </div>
            <div className={s.emptyIconDiv}>
              <PuzzlePieceIcon className='w-3 h-3 text-gray-500' />
            </div>
          </div>
          <div className='text-xs text-gray-500 mt-2'>{t('common.datasetMenus.emptyTip')}</div>
          <a
            className='inline-flex items-center text-xs text-primary-600 mt-2 cursor-pointer'
            href={
              locale === LanguagesSupported[1]
                ? 'https://docs.dify.ai/v/zh-hans/guides/knowledge-base/integrate-knowledge-within-application'
                : 'https://docs.dify.ai/guides/knowledge-base/integrate-knowledge-within-application'
            }
            target='_blank' rel='noopener noreferrer'
          >
            <BookOpenIcon className='mr-1' />
            {t('common.datasetMenus.viewDoc')}
          </a>
        </div>
      </FloatPopoverContainer>
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
    return <Loading />

  return (
    <div className='grow flex overflow-hidden'>
      {!hideSideBar && <AppSideBar
        title={datasetRes?.name || '--'}
        icon={datasetRes?.icon || 'https://static.dify.ai/images/dataset-default-icon.png'}
        icon_background={datasetRes?.icon_background || '#F5F5F5'}
        desc={datasetRes?.description || '--'}
        isExternal={datasetRes?.provider === 'external'}
        navigation={navigation}
        extraInfo={!isCurrentWorkspaceDatasetOperator ? mode => <ExtraInfo isMobile={mode === 'collapse'} relatedApps={relatedApps} /> : undefined}
        iconType={datasetRes?.data_source_type === DataSourceType.NOTION ? 'notion' : 'dataset'}
      />}
      <DatasetDetailContext.Provider value={{
        indexingTechnique: datasetRes?.indexing_technique,
        dataset: datasetRes,
        mutateDatasetRes: () => mutateDatasetRes(),
      }}>
        <div className="bg-white grow overflow-hidden">{children}</div>
      </DatasetDetailContext.Provider>
    </div>
  )
}
export default React.memo(DatasetDetailLayout)
