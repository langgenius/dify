import type { FC } from 'react'
import classNames from 'classnames'
import style from './style.module.css'

import data from '@emoji-mart/data'
import { init } from 'emoji-mart'

init({ data })

export type AppIconProps = {
  size?: 'tiny' | 'small' | 'medium' | 'large'
  rounded?: boolean
  icon?: string
  background?: string
  className?: string
  innerIcon?: React.ReactNode
  onClick?: () => void
}

const AppIcon: FC<AppIconProps> = ({
  size = 'medium',
  rounded = false,
  icon,
  background,
  className,
  innerIcon,
  onClick,
}) => {
  return (
    <span
      className={classNames(
        style.appIcon,
        size !== 'medium' && style[size],
        rounded && style.rounded,
        className ?? '',
      )}
      style={{
        background,
      }}
      onClick={onClick}
    >
      {innerIcon ? innerIcon : icon && icon !== '' ? <em-emoji id={icon} /> : <em-emoji id='🤖' />}
    </span>
  )
}

export default AppIcon
