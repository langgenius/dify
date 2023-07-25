import Link from 'next/link'
import AccountDropdown from './account-dropdown'
import AppNav from './app-nav'
import DatasetNav from './dataset-nav'
import EnvNav from './env-nav'
import ExploreNav from './explore-nav'
import GithubStar from './github-star'
import PluginNav from './plugin-nav'
import s from './index.module.css'
import { WorkspaceProvider } from '@/context/workspace-context'

const navClassName = `
  flex items-center relative mr-3 px-3 h-8 rounded-xl
  font-medium text-sm
  cursor-pointer
`

const Header = () => {
  return (
    <>
      <div className='flex items-center'>
        <Link href="/apps" className='flex items-center mr-4'>
          <div className={s.logo} />
        </Link>
        {/* @ts-expect-error Async Server Component */}
        <GithubStar />
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
    </>
  )
}
export default Header
