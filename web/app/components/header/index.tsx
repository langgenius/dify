'use client'

import Link from 'next/link'
import { useSelectedLayoutSegment } from 'next/navigation'
import classNames from 'classnames'
import { useEffect } from 'react'
import { Bars3Icon } from '@heroicons/react/20/solid'
import { useBoolean } from 'ahooks'
import { Transition } from '@headlessui/react'
import AccountDropdown from './account-dropdown'
import AppNav from './app-nav'
import DatasetNav from './dataset-nav'
import EnvNav from './env-nav'
import ExploreNav from './explore-nav'
import GithubStar from './github-star'
import s from './index.module.css'
import { WorkspaceProvider } from '@/context/workspace-context'
import { useAppContext } from '@/context/app-context'
import LogoSite from '@/app/components/base/logo/logo-site'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'

const navClassName = `
  flex items-center relative mr-3 px-3 h-9 rounded-xl
  font-medium text-sm
  cursor-pointer
`

const Header = () => {
  const selectedSegment = useSelectedLayoutSegment()
  const { isCurrentWorkspaceManager, langeniusVersionInfo } = useAppContext()
  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile
  const [isShowNavMenu, { toggle, setFalse: hideNavMenu }] = useBoolean(false)

  useEffect(() => {
    hideNavMenu()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSegment])

  return (
    <>
      <div className={classNames(
        s[`header-${langeniusVersionInfo.current_env}`],
        'flex flex-1 items-center justify-between px-4',
      )}>
        <div className='flex items-center'>
          {isMobile && <div
            className='flex items-center justify-center h-8 w-8 cursor-pointer'
            onClick={toggle}
          >
            <Bars3Icon className="h-4 w-4 text-gray-500" />
          </div>}
          {!isMobile && <>
            <Link href="/apps" className='flex items-center mr-4'>
              <LogoSite />
            </Link>
            <GithubStar />
          </>}
        </div>
        {isMobile && (
          <div className='flex'>
            <Link href="/apps" className='flex items-center mr-4'>
              <LogoSite />
            </Link>
            <GithubStar />
          </div>
        )}
        {!isMobile && (
          <div className='flex items-center'>
            <ExploreNav className={navClassName} />
            <AppNav />
            {isCurrentWorkspaceManager && <DatasetNav />}
          </div>
        )}
        <div className='flex items-center flex-shrink-0'>
          <EnvNav />
          <WorkspaceProvider>
            <AccountDropdown isMobile={isMobile} />
          </WorkspaceProvider>
        </div>
      </div>
      <Transition
        show={isMobile && isShowNavMenu}
        className='flex flex-col p-4 gap-1'
        enter="transition-[height] ease-in-out h-0 overflow-hidden"
        enterFrom="transition-[height] ease-in-out h-0 overflow-hidden"
        enterTo="h-auto"
        leave="transition-[height] ease-in-out h-auto overflow-hidden"
        leaveFrom="transition-[height] ease-in-out h-auto overflow-hidden"
        leaveTo="h-0"
      >
        <ExploreNav className={navClassName} />
        <AppNav />
        {isCurrentWorkspaceManager && <DatasetNav />}
      </Transition>
    </>
  )
}
export default Header
