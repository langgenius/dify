import type { FC } from 'react'
import React from 'react'
import ExploreClient from '@/app/components/explore'
export type IAppDetail = {
  children: React.ReactNode
}

const AppDetail: FC<IAppDetail> = ({ children }) => {
  return (
    <ExploreClient>
      {children}
    </ExploreClient>
  )
}

export default React.memo(AppDetail)
