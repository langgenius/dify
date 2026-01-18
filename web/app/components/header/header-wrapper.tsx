'use client'
import { usePathname } from 'next/navigation'
import * as React from 'react'
import { useState } from 'react'
import { STORAGE_KEYS } from '@/config/storage-keys'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { cn } from '@/utils/classnames'
import { storage } from '@/utils/storage'
import s from './index.module.css'

type HeaderWrapperProps = {
  children: React.ReactNode
}

const HeaderWrapper = ({
  children,
}: HeaderWrapperProps) => {
  const pathname = usePathname()
  const isBordered = ['/apps', '/datasets/create', '/tools'].includes(pathname)
  // Check if the current path is a workflow canvas & fullscreen
  const inWorkflowCanvas = pathname.endsWith('/workflow')
  const isPipelineCanvas = pathname.endsWith('/pipeline')
  const workflowCanvasMaximize = storage.getBoolean(STORAGE_KEYS.WORKFLOW.CANVAS_MAXIMIZE, false) ?? false
  const [hideHeader, setHideHeader] = useState(workflowCanvasMaximize)
  const { eventEmitter } = useEventEmitterContextContext()

  eventEmitter?.useSubscription((v: any) => {
    if (v?.type === 'workflow-canvas-maximize')
      setHideHeader(v.payload)
  })

  return (
    <div className={cn('sticky left-0 right-0 top-0 z-[30] flex min-h-[56px] shrink-0 grow-0 basis-auto flex-col', s.header, isBordered ? 'border-b border-divider-regular' : '', hideHeader && (inWorkflowCanvas || isPipelineCanvas) && 'hidden')}>
      {children}
    </div>
  )
}
export default HeaderWrapper
