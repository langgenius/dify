import type { FC, MouseEventHandler, PropsWithChildren } from 'react'
import React, { memo } from 'react'
import classNames from 'classnames'
import Spinner from '../spinner'

export type IButtonProps = PropsWithChildren<{
  type?: string
  className?: string
  disabled?: boolean
  loading?: boolean
  tabIndex?: number
  onClick?: MouseEventHandler<HTMLDivElement>
}>

const Button: FC<IButtonProps> = ({
  type,
  disabled,
  children,
  className,
  onClick,
  loading = false,
  tabIndex,
}) => {
  let typeClassNames = 'cursor-pointer'
  switch (type) {
    case 'primary':
      typeClassNames = (disabled || loading) ? 'btn-primary-disabled' : 'btn-primary'
      break
    case 'warning':
      typeClassNames = (disabled || loading) ? 'btn-warning-disabled' : 'btn-warning'
      break
    default:
      typeClassNames = disabled ? 'btn-default-disabled' : 'btn-default'
      break
  }

  return (
    <div
      className={classNames('btn', typeClassNames, className)}
      tabIndex={tabIndex}
      onClick={disabled ? undefined : onClick}
    >
      {children}
      {/* Spinner is hidden when loading is false */}
      <Spinner loading={loading} className='!text-white !h-3 !w-3 !border-2 !ml-1' />
    </div>
  )
}

export default memo(Button)
