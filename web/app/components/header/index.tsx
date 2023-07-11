// 'use client'
// import { useEffect, useState } from 'react'
import classNames from 'classnames'
import Link from 'next/link'
import AccountDropdown from './account-dropdown'
import AppNav from './app-nav'
import DatasetNav from './dataset-nav'
import EnvNav from './env-nav'
import ExploreNav from './explore-nav'
import GithubStar from './github-star'
import PluginNav from './plugin-nav'
import s from './index.module.css'
// import type { GithubRepo } from '@/models/common'
import { WorkspaceProvider } from '@/context/workspace-context'

const navClassName = `
  flex items-center relative mr-3 px-3 h-8 rounded-xl
  font-medium text-sm
  cursor-pointer
`

const Header = () => {
  // const pathname = usePathname()
  // const { userProfile, langeniusVersionInfo } = useAppContext()
  // const [starCount, setStarCount] = useState(0)
  // const isBordered = ['/apps', '/datasets'].includes(pathname)

  // useEffect(() => {
  //   globalThis.fetch('https://api.github.com/repos/langgenius/dify').then(res => res.json()).then((data: GithubRepo) => {
  //     setStarCount(data.stargazers_count)
  //   })
  // }, [])

  return (
    <div className={classNames(
      'sticky top-0 left-0 right-0 z-20 flex bg-gray-100 grow-0 shrink-0 basis-auto h-14',
      s.header,
      // isBordered ? 'border-b border-gray-200' : '',
    )}
    >
      <div className={classNames(
        // s[`header-${langeniusVersionInfo.current_env}`],
        'flex flex-1 items-center justify-between px-4',
      )}>
        <div className='flex items-center'>
          <Link href="/apps" className='flex items-center mr-4'>
            <div className={s.logo} />
          </Link>
          <GithubStar />
          {/* {
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
          } */}
        </div>
        <div className='flex items-center'>
          <ExploreNav className={navClassName} />
          <AppNav />
          <PluginNav className={navClassName} />
          <DatasetNav />
        </div>
        <div className='flex items-center flex-shrink-0'>
          <EnvNav />
          <WorkspaceProvider>
            <AccountDropdown />
          </WorkspaceProvider>
        </div>
      </div>
    </div>
  )
}
export default Header
