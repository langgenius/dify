'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAppContext } from '@/context/app-context'

export type IAppDetail = {
  children: React.ReactNode
}

const AppDetail: FC<IAppDetail> = ({ children }) => {
  const router = useRouter()
  const { isCurrentWorkspaceDatasetOperator } = useAppContext()

  useEffect(() => {
    if (isCurrentWorkspaceDatasetOperator)
      return router.replace('/datasets')
  }, [isCurrentWorkspaceDatasetOperator])

  return (
    <>
      {children}
    </>
  )
}

export default React.memo(AppDetail)
