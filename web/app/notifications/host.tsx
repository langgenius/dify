'use client'

import type { ToastHostProps } from '@langgenius/dify-ui/toast'
import { ToastHost } from '@langgenius/dify-ui/toast'
import { manager } from '.'

export type AppToastHostProps = Omit<ToastHostProps, 'manager'>

export function AppToastHost(props: AppToastHostProps) {
  return <ToastHost manager={manager} timeout={5000} limit={3} {...props} />
}
