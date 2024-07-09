'use client'
import type { ReactNode } from 'react'
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  XCircleIcon,
} from '@heroicons/react/20/solid'
import { createContext, useContext } from 'use-context-selector'
import classNames from '@/utils/classnames'

export type IToastProps = {
  type?: 'success' | 'error' | 'warning' | 'info'
  duration?: number
  message: string
  children?: ReactNode
  onClose?: () => void
  className?: string
}
type IToastContext = {
  notify: (props: IToastProps) => void
}
const defaultDuring = 3000

export const ToastContext = createContext<IToastContext>({} as IToastContext)
export const useToastContext = () => useContext(ToastContext)
const Toast = ({
  type = 'info',
  duration,
  message,
  children,
  className,
}: IToastProps) => {
  // sometimes message is react node array. Not handle it.
  if (typeof message !== 'string')
    return null

  return <div className={classNames(
    className,
    'fixed rounded-md p-4 my-4 mx-8 z-[9999]',
    'top-0',
    'right-0',
    type === 'success' ? 'bg-green-50' : '',
    type === 'error' ? 'bg-red-50' : '',
    type === 'warning' ? 'bg-yellow-50' : '',
    type === 'info' ? 'bg-blue-50' : '',
  )}>
    <div className="flex">
      <div className="flex-shrink-0">
        {type === 'success' && <CheckCircleIcon className="w-5 h-5 text-green-400" aria-hidden="true" />}
        {type === 'error' && <XCircleIcon className="w-5 h-5 text-red-400" aria-hidden="true" />}
        {type === 'warning' && <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400" aria-hidden="true" />}
        {type === 'info' && <InformationCircleIcon className="w-5 h-5 text-blue-400" aria-hidden="true" />}
      </div>
      <div className="ml-3">
        <h3 className={
          classNames(
            'text-sm font-medium',
            type === 'success' ? 'text-green-800' : '',
            type === 'error' ? 'text-red-800' : '',
            type === 'warning' ? 'text-yellow-800' : '',
            type === 'info' ? 'text-blue-800' : '',
          )
        }>{message}</h3>
        {children && <div className={
          classNames(
            'mt-2 text-sm',
            type === 'success' ? 'text-green-700' : '',
            type === 'error' ? 'text-red-700' : '',
            type === 'warning' ? 'text-yellow-700' : '',
            type === 'info' ? 'text-blue-700' : '',
          )
        }>
          {children}
        </div>
        }
      </div>
    </div>
  </div>
}

export const ToastProvider = ({
  children,
}: {
  children: ReactNode
}) => {
  const placeholder: IToastProps = {
    type: 'info',
    message: 'Toast message',
    duration: 3000,
  }
  const [params, setParams] = React.useState<IToastProps>(placeholder)

  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (mounted) {
      setTimeout(() => {
        setMounted(false)
      }, params.duration || defaultDuring)
    }
  }, [mounted])

  return <ToastContext.Provider value={{
    notify: (props) => {
      setMounted(true)
      setParams(props)
    },
  }}>
    {mounted && <Toast {...params} />}
    {children}
  </ToastContext.Provider>
}

Toast.notify = ({
  type,
  message,
  duration,
  className,
}: Pick<IToastProps, 'type' | 'message' | 'duration' | 'className'>) => {
  if (typeof window === 'object') {
    const holder = document.createElement('div')
    const root = createRoot(holder)

    root.render(<Toast type={type} message={message} duration={duration} className={className} />)
    document.body.appendChild(holder)
    setTimeout(() => {
      if (holder)
        holder.remove()
    }, duration || defaultDuring)
  }
}

export default Toast
