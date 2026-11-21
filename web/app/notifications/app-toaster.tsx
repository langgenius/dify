'use client'

import type { ToasterProps, ToastManager } from '@langgenius/dify-ui/toast'
import { Toaster } from '@langgenius/dify-ui/toast'
import { manager } from '.'

export type AppToasterProps = {
  manager?: ToastManager
  timeout?: number
  limit?: number
  offset?: ToasterProps['offset']
}

export function AppToaster({
  manager: toastManager = manager,
  timeout = 5000,
  limit = 3,
  offset,
}: AppToasterProps) {
  return <Toaster toastManager={toastManager} timeout={timeout} limit={limit} offset={offset} />
}
