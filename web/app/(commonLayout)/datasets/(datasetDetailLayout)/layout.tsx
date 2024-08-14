import type { FC } from 'react'
import React from 'react'

export type IDatasetDetail = {
  children: React.ReactNode
}

const AppDetail: FC<IDatasetDetail> = ({ children }) => {
  return (
    <>
      {children}
    </>
  )
}

export default React.memo(AppDetail)
