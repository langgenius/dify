'use client'
import React, { useState } from 'react'
import { usePathname } from 'next/navigation'
import s from './index.module.css'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import classNames from '@/utils/classnames'

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
  const workflowCanvasMaximize = localStorage.getItem('workflow-canvas-maximize') === 'true'
  const [hideHeader, setHideHeader] = useState(workflowCanvasMaximize)
  const { eventEmitter } = useEventEmitterContextContext()

  eventEmitter?.useSubscription((v: any) => {
    if (v?.type === 'workflow-canvas-maximize')
      setHideHeader(v.payload)
  })

  return (
    <div className={classNames(
      'sticky left-0 right-0 top-0 z-[15] flex min-h-[56px] shrink-0 grow-0 basis-auto flex-col',
      s.header,
      isBordered ? 'border-b border-divider-regular' : '',
      hideHeader && (inWorkflowCanvas || isPipelineCanvas) && 'hidden',
    )}
    >
      {children}
    </div>
  )
}
export default HeaderWrapper
