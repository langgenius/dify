'use client'
import { useCallback, useEffect, useState } from 'react'
import type { FC } from 'react'
import useSWRInfinite from 'swr/infinite'
import { useTranslation } from 'react-i18next'
import { flatten } from 'lodash-es'
import { useRouter, useSelectedLayoutSegment } from 'next/navigation'
import classNames from 'classnames'
import { CircleStackIcon, PuzzlePieceIcon } from '@heroicons/react/24/outline'
import { CommandLineIcon, Squares2X2Icon } from '@heroicons/react/24/solid'
import Link from 'next/link'
import AccountDropdown from './account-dropdown'
import Nav from './nav'
import s from './index.module.css'
import type { GithubRepo, LangGeniusVersionResponse, UserProfileResponse } from '@/models/common'
import type { AppListResponse } from '@/models/app'
import NewAppDialog from '@/app/(commonLayout)/apps/NewAppDialog'
import { WorkspaceProvider } from '@/context/workspace-context'
import { useDatasetsContext } from '@/context/datasets-context'
import { fetchAppList } from '@/service/apps'

const BuildAppsIcon = ({ isSelected }: { isSelected: boolean }) => (
  <svg className='mr-1' width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M13.6666 4.85221L7.99998 8.00036M7.99998 8.00036L2.33331 4.85221M7.99998 8.00036L8 14.3337M14 10.7061V5.29468C14 5.06625 14 4.95204 13.9663 4.85017C13.9366 4.76005 13.8879 4.67733 13.8236 4.60754C13.7509 4.52865 13.651 4.47318 13.4514 4.36224L8.51802 1.6215C8.32895 1.51646 8.23442 1.46395 8.1343 1.44336C8.0457 1.42513 7.95431 1.42513 7.8657 1.44336C7.76559 1.46395 7.67105 1.51646 7.48198 1.6215L2.54865 4.36225C2.34896 4.47318 2.24912 4.52865 2.17642 4.60754C2.11211 4.67733 2.06343 4.76005 2.03366 4.85017C2 4.95204 2 5.06625 2 5.29468V10.7061C2 10.9345 2 11.0487 2.03366 11.1506C2.06343 11.2407 2.11211 11.3234 2.17642 11.3932C2.24912 11.4721 2.34897 11.5276 2.54865 11.6385L7.48198 14.3793C7.67105 14.4843 7.76559 14.5368 7.8657 14.5574C7.95431 14.5756 8.0457 14.5756 8.1343 14.5574C8.23442 14.5368 8.32895 14.4843 8.51802 14.3793L13.4514 11.6385C13.651 11.5276 13.7509 11.4721 13.8236 11.3932C13.8879 11.3234 13.9366 11.2407 13.9663 11.1506C14 11.0487 14 10.9345 14 10.7061Z" stroke={isSelected ? '#155EEF' : '#667085'} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export type IHeaderProps = {
  curAppId?: string
  userProfile: UserProfileResponse
  onLogout: () => void
  langeniusVersionInfo: LangGeniusVersionResponse
  isBordered: boolean
}
const navClassName = `
  flex items-center relative mr-3 px-3 h-8 rounded-xl
  font-medium text-[14px]
  cursor-pointer
`
const headerEnvClassName: { [k: string]: string } = {
  DEVELOPMENT: 'bg-[#FEC84B] border-[#FDB022] text-[#93370D]',
  TESTING: 'bg-[#A5F0FC] border-[#67E3F9] text-[#164C63]',
}
const getKey = (pageIndex: number, previousPageData: AppListResponse) => {
  if (!pageIndex || previousPageData.has_more)
    return { url: 'apps', params: { page: pageIndex + 1, limit: 30 } }
  return null
}
const Header: FC<IHeaderProps> = ({
  curAppId,
  userProfile,
  onLogout,
  langeniusVersionInfo,
  isBordered,
}) => {
  const { t } = useTranslation()
  const [showNewAppDialog, setShowNewAppDialog] = useState(false)
  const { data: appsData, isLoading, setSize } = useSWRInfinite(curAppId ? getKey : () => null, fetchAppList, { revalidateFirstPage: false })
  const { datasets, currentDataset } = useDatasetsContext()
  const router = useRouter()
  const showEnvTag = langeniusVersionInfo.current_env === 'TESTING' || langeniusVersionInfo.current_env === 'DEVELOPMENT'
  const selectedSegment = useSelectedLayoutSegment()
  const isPluginsComingSoon = selectedSegment === 'plugins-coming-soon'
  const isExplore = selectedSegment === 'explore'
  const [starCount, setStarCount] = useState(0)

  useEffect(() => {
    globalThis.fetch('https://api.github.com/repos/langgenius/dify').then(res => res.json()).then((data: GithubRepo) => {
      setStarCount(data.stargazers_count)
    })
  }, [])
  const appItems = flatten(appsData?.map(appData => appData.data))

  const handleLoadmore = useCallback(() => {
    if (isLoading)
      return

    setSize(size => size + 1)
  }, [setSize, isLoading])

  return (
    <div className={classNames(
      'sticky top-0 left-0 right-0 z-20 flex bg-gray-100 grow-0 shrink-0 basis-auto h-14',
      s.header,
      isBordered ? 'border-b border-gray-200' : '',
    )}
    >
      <div className={classNames(
        s[`header-${langeniusVersionInfo.current_env}`],
        'flex flex-1 items-center justify-between px-4',
      )}>
        <div className='flex items-center'>
          <Link href="/apps" className='flex items-center mr-4'>
            <div className={s.logo} />
          </Link>
          {
            starCount > 0 && (
              <Link
                href='https://github.com/langgenius/dify'
                target='_blank'
                className='flex items-center leading-[18px] border border-gray-200 rounded-md text-xs text-gray-700 font-semibold overflow-hidden'>
                <div className='flex items-center px-2 py-1 bg-gray-100'>
                  <div className={`${s['github-icon']} mr-1 rounded-full`} />
                  Star
                </div>
                <div className='px-2 py-1 bg-white border-l border-gray-200'>{`${starCount}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</div>
              </Link>
            )
          }
        </div>
        <div className='flex items-center'>
          <Link href="/explore/apps" className={classNames(
            navClassName, 'group',
            isExplore && 'bg-white shadow-[0_2px_5px_-1px_rgba(0,0,0,0.05),0_2px_4px_-2px_rgba(0,0,0,0.05)]',
            isExplore ? 'text-primary-600' : 'text-gray-500 hover:bg-gray-200 hover:text-gray-700',
          )}>
            <Squares2X2Icon className='mr-1 w-[18px] h-[18px]' />
            {t('common.menus.explore')}
          </Link>
          <Nav
            icon={<BuildAppsIcon isSelected={['apps', 'app'].includes(selectedSegment || '')} />}
            text={t('common.menus.apps')}
            activeSegment={['apps', 'app']}
            link='/apps'
            curNav={appItems.find(appItem => appItem.id === curAppId)}
            navs={appItems.map(item => ({
              id: item.id,
              name: item.name,
              link: `/app/${item.id}/overview`,
              icon: item.icon,
              icon_background: item.icon_background,
            }))}
            createText={t('common.menus.newApp')}
            onCreate={() => setShowNewAppDialog(true)}
            onLoadmore={handleLoadmore}
          />
          <Link href="/plugins-coming-soon" className={classNames(
            navClassName, 'group',
            isPluginsComingSoon && 'bg-white shadow-[0_2px_5px_-1px_rgba(0,0,0,0.05),0_2px_4px_-2px_rgba(0,0,0,0.05)]',
            isPluginsComingSoon ? 'text-primary-600' : 'text-gray-500 hover:bg-gray-200 hover:text-gray-700',
          )}>
            <PuzzlePieceIcon className='mr-1 w-[18px] h-[18px]' />
            {t('common.menus.plugins')}
          </Link>
          <Nav
            icon={<CircleStackIcon className='mr-1 w-[18px] h-[18px]' />}
            text={t('common.menus.datasets')}
            activeSegment='datasets'
            link='/datasets'
            curNav={currentDataset && { id: currentDataset.id, name: currentDataset.name, icon: currentDataset.icon, icon_background: currentDataset.icon_background }}
            navs={datasets.map(dataset => ({
              id: dataset.id,
              name: dataset.name,
              link: `/datasets/${dataset.id}/documents`,
              icon: dataset.icon,
              icon_background: dataset.icon_background,
            }))}
            createText={t('common.menus.newDataset')}
            onCreate={() => router.push('/datasets/create')}
          />
        </div>
        <div className='flex items-center flex-shrink-0'>
          {
            showEnvTag && (
              <div className={`
              flex items-center h-[22px] mr-4 rounded-md px-2 text-xs font-medium border
              ${headerEnvClassName[langeniusVersionInfo.current_env]}
            `}>
                {
                  langeniusVersionInfo.current_env === 'TESTING' && (
                    <>
                      <div className={s['beaker-icon']} />
                      {t('common.environment.testing')}
                    </>
                  )
                }
                {
                  langeniusVersionInfo.current_env === 'DEVELOPMENT' && (
                    <>
                      <CommandLineIcon className='w-3 h-3 mr-1' />
                      {t('common.environment.development')}
                    </>
                  )
                }
              </div>
            )
          }
          <WorkspaceProvider>
            <AccountDropdown userProfile={userProfile} onLogout={onLogout} langeniusVersionInfo={langeniusVersionInfo} />
          </WorkspaceProvider>
        </div>
      </div>
      <NewAppDialog show={showNewAppDialog} onClose={() => setShowNewAppDialog(false)} />
    </div>
  )
}
export default Header
