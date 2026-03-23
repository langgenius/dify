'use client'

import type { ReactNode } from 'react'
import { createContext, useContext } from 'use-context-selector'

export type IToastProps = {
  type?: 'success' | 'error' | 'warning' | 'info'
  size?: 'md' | 'sm'
  duration?: number
  message: string
  children?: ReactNode
  onClose?: () => void
  className?: string
  customComponent?: ReactNode
}

type IToastContext = {
  notify: (props: IToastProps) => void
  close: () => void
}

export const ToastContext = createContext<IToastContext>({} as IToastContext)
export const useToastContext = () => useContext(ToastContext)
