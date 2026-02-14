'use client'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useEffect } from 'react'
import Sidebar from '@/app/components/explore/sidebar'
import { useAppContext } from '@/context/app-context'

const Explore = ({
  children,
}: {
  children: React.ReactNode
}) => {
  const router = useRouter()
  const { isCurrentWorkspaceDatasetOperator } = useAppContext()

  useEffect(() => {
    if (isCurrentWorkspaceDatasetOperator)
      router.replace('/datasets')
  }, [isCurrentWorkspaceDatasetOperator, router])

  return (
    <div className="flex h-full overflow-hidden border-t border-divider-regular bg-background-body">
      <Sidebar />
      <div className="h-full min-h-0 w-0 grow">
        {children}
      </div>
    </div>
  )
}
export default React.memo(Explore)
