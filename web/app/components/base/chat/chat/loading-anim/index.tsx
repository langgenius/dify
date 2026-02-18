'use client'
import type { FC } from 'react'
import * as React from 'react'
import { cn } from '@/utils/classnames'
import s from './style.module.css'

export type ILoadingAnimProps = {
  type: 'text' | 'avatar'
}

const LoadingAnim: FC<ILoadingAnimProps> = ({
  type,
}) => {
  return (
    <div className={cn(s['dot-flashing'], s[type])} />
  )
}
export default React.memo(LoadingAnim)
