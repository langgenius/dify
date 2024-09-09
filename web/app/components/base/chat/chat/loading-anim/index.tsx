'use client'
import type { FC } from 'react'
import React from 'react'
import s from './style.module.css'

export type ILoadingAnimProps = {
  type: 'text' | 'avatar'
}

const LoadingAnim: FC<ILoadingAnimProps> = ({
  type,
}) => {
  return (
    <div className={`${s['dot-flashing']} ${s[type]}`}></div>
  )
}
export default React.memo(LoadingAnim)
