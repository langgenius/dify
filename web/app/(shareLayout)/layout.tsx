import React from 'react'
import type { FC } from 'react'
import GA, { GaType } from '@/app/components/base/ga'

const Layout: FC<{
  children: React.ReactNode
}> = ({ children }) => {
  return (
    <div className=''>
      <div className="min-w-[300px]">
        <GA gaType={GaType.webapp} />
        {children}
      </div>
    </div>
  )
}

export default Layout
