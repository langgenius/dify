import type { ReactNode } from 'react'
import { toast } from '@/app/components/base/ui/toast'

type ToastType = 'success' | 'error' | 'warning' | 'info'

export type LegacyToastOptions = {
  type?: ToastType
  message: ReactNode
}

export const notifyToast = ({
  type = 'info',
  message,
}: LegacyToastOptions) => {
  toast[type](message)
}

const Toast = {
  notify: notifyToast,
}

export default Toast
