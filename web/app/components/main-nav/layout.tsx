'use client'

import type { ReactNode } from 'react'
import type { EventEmitterValue } from '@/context/event-emitter'
import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { WorkspaceProvider } from '@/context/workspace-context-provider'
import { usePathname } from '@/next/navigation'
import MainNav from './index'

type MainNavLayoutProps = {
  children: ReactNode
}

const MainNavLayout = ({
  children,
}: MainNavLayoutProps) => {
  const pathname = usePathname()
  const inWorkflowCanvas = pathname.endsWith('/workflow')
  const isPipelineCanvas = pathname.endsWith('/pipeline')
  const [hideMainNav, setHideMainNav] = useState(() => (
    globalThis.localStorage?.getItem('workflow-canvas-maximize') === 'true'
  ))
  const { eventEmitter } = useEventEmitterContextContext()

  eventEmitter?.useSubscription((v: EventEmitterValue) => {
    if (typeof v !== 'string' && v.type === 'workflow-canvas-maximize' && typeof v.payload === 'boolean')
      setHideMainNav(v.payload)
  })

  return (
    <div className="flex h-0 min-h-0 grow overflow-hidden bg-background-body">
      <WorkspaceProvider>
        <MainNav
          className={cn(
            hideMainNav && (inWorkflowCanvas || isPipelineCanvas) && 'hidden',
          )}
        />
      </WorkspaceProvider>
      <div className="flex min-w-0 grow flex-col overflow-hidden">
        {children}
      </div>
    </div>
  )
}

export default MainNavLayout
