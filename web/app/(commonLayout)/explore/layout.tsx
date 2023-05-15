import type { FC } from 'react'
import React from 'react'
import Sidebar from '@/app/components/explore/sidebar'

export type IAppDetail = {
  children: React.ReactNode
}

const AppDetail: FC<IAppDetail> = ({ children }) => {
  return (
    <div className='flex h-full bg-gray-100 border-t border-gray-200'>
      <Sidebar />
      <div className='grow'>
      {children}
      </div>
    </div>
  )
}

export default React.memo(AppDetail)
