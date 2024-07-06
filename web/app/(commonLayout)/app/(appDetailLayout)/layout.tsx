import type { FC } from 'react'
import React from 'react'

export type IAppDetail = {
  children: React.ReactNode
}

const AppDetail: FC<IAppDetail> = ({ children }) => {
  return (
    <>
      {children}
    </>
  )
}

export default React.memo(AppDetail)
