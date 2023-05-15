'use client'
import React, { FC } from 'react'
import s from './style.module.css'

export interface ILoaidingAnimProps {
  type: 'text' | 'avatar'
}

const LoaidingAnim: FC<ILoaidingAnimProps> = ({
  type
}) => {
  return (
    <div className={`${s['dot-flashing']} ${s[type]}`}></div>
  )
}
export default React.memo(LoaidingAnim)
