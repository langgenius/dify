'use client'
import Link from 'next/link'
import Divider from '../components/base/divider'
import Avatar from './avatar'
import LogoSite from '@/app/components/base/logo/logo-site'

const Header = () => {
  return (
    <div className='flex flex-1 items-center justify-between px-4'>
      <div className='flex items-center'>
        <Link href="/apps" className='flex items-center mr-4'>
          <LogoSite className='object-contain' />
        </Link>
        <Divider type='vertical' style={{ height: '16px' }} />
        <p className='text-text-primary text-xl'>Account</p>
      </div>
      <div className='flex items-center flex-shrink-0'>
        <Avatar />
      </div>
    </div>
  )
}
export default Header
