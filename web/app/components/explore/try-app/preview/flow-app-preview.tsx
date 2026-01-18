'use client'
import type { FC } from 'react'
import * as React from 'react'
import Loading from '@/app/components/base/loading'
import WorkflowPreview from '@/app/components/workflow/workflow-preview'
import { useGetTryAppFlowPreview } from '@/service/use-try-app'
import { cn } from '@/utils/classnames'

type Props = {
  appId: string
  className?: string
}

const FlowAppPreview: FC<Props> = ({
  appId,
  className,
}) => {
  const { data, isLoading } = useGetTryAppFlowPreview(appId)

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loading type="area" />
      </div>
    )
  }
  if (!data)
    return null
  return (
    <div className="h-full w-full">
      <WorkflowPreview
        {...data.graph}
        className={cn(className)}
        miniMapToRight
      />
    </div>
  )
}
export default React.memo(FlowAppPreview)
