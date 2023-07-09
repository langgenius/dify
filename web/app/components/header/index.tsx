'use client'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePathname, useSelectedLayoutSegment } from 'next/navigation'
import classNames from 'classnames'
import { CommandLineIcon } from '@heroicons/react/24/solid'
import Link from 'next/link'
import AccountDropdown from './account-dropdown'
import AppNav from './app-nav'
import DatasetNav from './dataset-nav'
import s from './index.module.css'
import type { GithubRepo } from '@/models/common'
import { WorkspaceProvider } from '@/context/workspace-context'
import { useAppContext } from '@/context/app-context'
import { Grid01 } from '@/app/components/base/icons/src/vender/line/layout'
import { Grid01 as Grid01Solid } from '@/app/components/base/icons/src/vender/solid/layout'
import { PuzzlePiece01 } from '@/app/components/base/icons/src/vender/line/development'
import { PuzzlePiece01 as PuzzlePiece01Solid } from '@/app/components/base/icons/src/vender/solid/development'

const navClassName = `
  flex items-center relative mr-3 px-3 h-8 rounded-xl
  font-medium text-sm
  cursor-pointer
`
const headerEnvClassName: { [k: string]: string } = {
  DEVELOPMENT: 'bg-[#FEC84B] border-[#FDB022] text-[#93370D]',
  TESTING: 'bg-[#A5F0FC] border-[#67E3F9] text-[#164C63]',
}
const Header = () => {
  const { t } = useTranslation()
  const pathname = usePathname()
  const { userProfile, langeniusVersionInfo } = useAppContext()
  const showEnvTag = langeniusVersionInfo.current_env === 'TESTING' || langeniusVersionInfo.current_env === 'DEVELOPMENT'
  const selectedSegment = useSelectedLayoutSegment()
  const isPluginsComingSoon = selectedSegment === 'plugins-coming-soon'
  const isExplore = selectedSegment === 'explore'
  const [starCount, setStarCount] = useState(0)
  const isBordered = ['/apps', '/datasets'].includes(pathname)

  useEffect(() => {
    globalThis.fetch('https://api.github.com/repos/langgenius/dify').then(res => res.json()).then((data: GithubRepo) => {
      setStarCount(data.stargazers_count)
    })
  }, [])

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
            isExplore ? 'text-primary-600' : 'text-gray-500 hover:bg-gray-200',
          )}>
            {
              isExplore
                ? <Grid01Solid className='mr-2 w-4 h-4' />
                : <Grid01 className='mr-2 w-4 h-4' />
            }
            {t('common.menus.explore')}
          </Link>
          <AppNav />
          <Link href="/plugins-coming-soon" className={classNames(
            navClassName, 'group',
            isPluginsComingSoon && 'bg-white shadow-[0_2px_5px_-1px_rgba(0,0,0,0.05),0_2px_4px_-2px_rgba(0,0,0,0.05)]',
            isPluginsComingSoon ? 'text-primary-600' : 'text-gray-500 hover:bg-gray-200',
          )}>
            {
              isPluginsComingSoon
                ? <PuzzlePiece01Solid className='mr-2 w-4 h-4' />
                : <PuzzlePiece01 className='mr-2 w-4 h-4' />
            }
            {t('common.menus.plugins')}
          </Link>
          <DatasetNav />
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
            <AccountDropdown userProfile={userProfile} langeniusVersionInfo={langeniusVersionInfo} />
          </WorkspaceProvider>
        </div>
      </div>
    </div>
  )
}
export default Header
