import type { FC, MouseEventHandler } from 'react'
import React from 'react'
import Spinner from '../spinner'

export type IButtonProps = {
  type?: string
  className?: string
  disabled?: boolean
  loading?: boolean
  tabIndex?: number
  children: React.ReactNode
  onClick?: MouseEventHandler<HTMLDivElement>
}

const Button: FC<IButtonProps> = ({
  type,
  disabled,
  children,
  className,
  onClick,
  loading = false,
  tabIndex,
}) => {
  let style = 'cursor-pointer'
  switch (type) {
    case 'primary':
      style = (disabled || loading) ? 'btn-primary-disabled' : 'btn-primary'
      break
    case 'warning':
      style = (disabled || loading) ? 'btn-warning-disabled' : 'btn-warning'
      break
    default:
      style = disabled ? 'btn-default-disabled' : 'btn-default'
      break
  }

  return (
    <div
      className={`btn ${style} ${className && className}`}
      tabIndex={tabIndex}
      onClick={disabled ? undefined : onClick}
    >
      {children}
      {/* Spinner is hidden when loading is false */}
      <Spinner loading={loading} className='!text-white !h-3 !w-3 !border-2 !ml-1' />
    </div>
  )
}

export default React.memo(Button)
