import type { FC } from 'react'
import React from 'react'

type IconProps = {
  icon: any
  className?: string
  [key: string]: any
}

const Icon: FC<IconProps> = ({ icon, className, ...other }) => {
  return (
    <img src={icon} className={`h-3 w-3 ${className}`} {...other} alt="icon" />
  )
}

export default Icon
