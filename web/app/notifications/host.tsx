'use client'

import type { ToastManager, ToastViewportProps } from '@langgenius/dify-ui/toast'
import {
  ToastCard,
  ToastPortal,
  ToastProvider,
  ToastViewport,
  useToastManager,
} from '@langgenius/dify-ui/toast'
import { manager } from '.'
import { CopyErrorAction } from './copy-error-action'

export type AppToastHostProps = {
  manager?: ToastManager
  timeout?: number
  limit?: number
  offset?: ToastViewportProps['offset']
}

function Notifications() {
  const { toasts } = useToastManager<Record<string, never>>()
  return toasts.map((item) => {
    const parts = [item.title, item.description]
    const text = parts.every((part) => part == null || typeof part === 'string')
      ? parts.filter(Boolean).join('\n')
      : ''
    return (
      <ToastCard key={item.id} toast={item}>
        {item.type === 'error' && text && <CopyErrorAction text={text} />}
      </ToastCard>
    )
  })
}

export function AppToastHost({
  manager: toastManager = manager,
  timeout = 5000,
  limit = 3,
  offset,
}: AppToastHostProps) {
  return (
    <ToastProvider toastManager={toastManager} timeout={timeout} limit={limit}>
      <ToastPortal>
        <ToastViewport offset={offset}>
          <Notifications />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  )
}
