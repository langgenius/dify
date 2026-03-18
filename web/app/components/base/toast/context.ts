'use client'

/**
 * @deprecated Use `@/app/components/base/ui/toast` instead.
 * This module will be removed after migration is complete.
 * See: https://github.com/langgenius/dify/issues/32811
 */

import type { ReactNode } from 'react'
import { createContext, useContext } from 'use-context-selector'

/** @deprecated Use `@/app/components/base/ui/toast` instead. See issue #32811. */
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

/** @deprecated Use `@/app/components/base/ui/toast` instead. See issue #32811. */
export const ToastContext = createContext<IToastContext>({} as IToastContext)

/** @deprecated Use `@/app/components/base/ui/toast` instead. See issue #32811. */
export const useToastContext = () => useContext(ToastContext)
