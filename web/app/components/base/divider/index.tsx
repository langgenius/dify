import type { CSSProperties, FC } from 'react'
import React from 'react'
import s from './style.module.css'

type Props = {
  type?: 'horizontal' | 'vertical'
  // orientation?: 'left' | 'right' | 'center'
  className?: string
  style?: CSSProperties
}

const Divider: FC<Props> = ({ type = 'horizontal', className = '', style }) => {
  return (
    <div className={`${s.divider} ${s[type]} ${className}`} style={style}></div>
  )
}

export default Divider
