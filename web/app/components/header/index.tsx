import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelectedLayoutSegment, useRouter } from 'next/navigation'
import classNames from 'classnames'
import { CircleStackIcon, PuzzlePieceIcon } from '@heroicons/react/24/outline'
import { CommandLineIcon, Squares2X2Icon } from '@heroicons/react/24/solid'
import Link from 'next/link'
import AccountDropdown from './account-dropdown'
import Nav from './nav'
import s from './index.module.css'
import type { AppDetailResponse } from '@/models/app'
import type { LangGeniusVersionResponse, UserProfileResponse } from '@/models/common'
import NewAppDialog from '@/app/(commonLayout)/apps/NewAppDialog'
import { WorkspaceProvider } from '@/context/workspace-context'
import { useDatasetsContext } from '@/context/datasets-context'

export type IHeaderProps = {
  appItems: AppDetailResponse[]
  curApp: AppDetailResponse
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
const Header: FC<IHeaderProps> = ({ appItems, curApp, userProfile, onLogout, langeniusVersionInfo, isBordered }) => {
  const { t } = useTranslation()
  const [showNewAppDialog, setShowNewAppDialog] = useState(false)
  const { datasets, currentDataset } = useDatasetsContext()
  const router = useRouter()
  const showEnvTag = langeniusVersionInfo.current_env === 'TESTING' || langeniusVersionInfo.current_env === 'DEVELOPMENT'
  const isPluginsComingSoon = useSelectedLayoutSegment() === 'plugins-coming-soon'

  return (
    <div className={classNames(
      'sticky top-0 left-0 right-0 z-20 flex bg-gray-100 grow-0 shrink-0 basis-auto h-14',
      s.header,
      isBordered ? 'border-b border-gray-200' : ''
    )}>
      <div className={classNames(
        s[`header-${langeniusVersionInfo.current_env}`],
        'flex flex-1 items-center justify-between px-4'
      )}>
        <div className='flex items-center'>
          <Link href="/apps" className='flex items-center mr-3'>
            <div className={s['logo']} />
          </Link>
          {/* Add it when has many stars */}
          <div className='
            flex items-center h-[26px] px-2 bg-white
            border border-solid border-[#E5E7EB] rounded-l-[6px] rounded-r-[6px]
          '>
            <div className={s['alpha']} />
            <div className='ml-1 text-xs font-semibold text-gray-700'>{t('common.menus.status')}</div>
          </div>
        </div>
        <div className='flex items-center'>
          <Nav
            icon={<Squares2X2Icon className='mr-1 w-[18px] h-[18px]' />}
            text={t('common.menus.apps')}
            activeSegment={['apps', 'app']}
            link='/apps'
            curNav={curApp && { id: curApp.id, name: curApp.name }}
            navs={appItems.map(item => ({
              id: item.id,
              name: item.name,
              link: `/app/${item.id}/overview`
            }))}
            createText={t('common.menus.newApp')}
            onCreate={() => setShowNewAppDialog(true)}
          />
          <Link href="/plugins-coming-soon" className={classNames(
            navClassName, 'group',
            isPluginsComingSoon && 'bg-white shadow-[0_2px_5px_-1px_rgba(0,0,0,0.05),0_2px_4px_-2px_rgba(0,0,0,0.05)]',
            isPluginsComingSoon ? 'text-primary-600' : 'text-gray-500 hover:bg-gray-200 hover:text-gray-700'
          )}>
            <PuzzlePieceIcon className='mr-1 w-[18px] h-[18px]' />
            {t('common.menus.plugins')}
          </Link>
          <Nav
            icon={<CircleStackIcon className='mr-1 w-[18px] h-[18px]' />}
            text={t('common.menus.datasets')}
            activeSegment='datasets'
            link='/datasets'
            curNav={currentDataset && { id: currentDataset.id, name: currentDataset.name }}
            navs={datasets.map(dataset => ({
              id: dataset.id,
              name: dataset.name,
              link: `/datasets/${dataset.id}/documents`
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
