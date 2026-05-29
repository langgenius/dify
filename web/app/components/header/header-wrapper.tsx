'use client'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useState } from 'react'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { usePathname } from '@/next/navigation'
import { useLocalStorageBoolean } from '@/utils/local-storage'
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
  const storedHideHeader = useLocalStorageBoolean('workflow-canvas-maximize')
  const [eventHideHeader, setEventHideHeader] = useState<boolean | null>(null)
  const hideHeader = eventHideHeader ?? storedHideHeader
  const { eventEmitter } = useEventEmitterContextContext()

  eventEmitter?.useSubscription((v: any) => {
    if (v?.type === 'workflow-canvas-maximize')
      setEventHideHeader(v.payload)
  })

  return (
    <div className={cn('sticky top-0 right-0 left-0 z-30 flex min-h-[56px] shrink-0 grow-0 basis-auto flex-col', s.header, isBordered ? 'border-b border-divider-regular' : '', hideHeader && (inWorkflowCanvas || isPipelineCanvas) && 'hidden')}>
      {children}
    </div>
  )
}
export default HeaderWrapper
