'use client'
import type { EventEmitterValue } from '@/context/event-emitter'
import { cn } from '@langgenius/dify-ui/cn'
import { useLocalStorage } from 'foxact/use-local-storage'
import * as React from 'react'
import { useState } from 'react'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { usePathname } from '@/next/navigation'
import s from './index.module.css'

type HeaderWrapperProps = {
  children: React.ReactNode
}

const HeaderWrapper = ({
  children,
}: HeaderWrapperProps) => {
  const pathname = usePathname()
  const isBordered = ['/apps', '/snippets', '/datasets/create', '/tools'].includes(pathname)
  const inWorkflowCanvas = pathname.endsWith('/workflow')
  const isPipelineCanvas = pathname.endsWith('/pipeline')
  const [storedHideHeader] = useLocalStorage<boolean>('workflow-canvas-maximize', false)
  const [eventHideHeader, setEventHideHeader] = useState<boolean | null>(null)
  const hideHeader = eventHideHeader ?? storedHideHeader
  const { eventEmitter } = useEventEmitterContextContext()

  eventEmitter?.useSubscription((value: EventEmitterValue) => {
    if (typeof value === 'object' && value.type === 'workflow-canvas-maximize' && typeof value.payload === 'boolean')
      setEventHideHeader(value.payload)
  })

  return (
    <div className={cn('sticky top-0 right-0 left-0 z-30 flex min-h-[56px] shrink-0 grow-0 basis-auto flex-col', s.header, isBordered ? 'border-b border-divider-regular' : '', hideHeader && (inWorkflowCanvas || isPipelineCanvas) && 'hidden')}>
      {children}
    </div>
  )
}
export default HeaderWrapper
