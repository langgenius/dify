'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import s from './style.module.css'

type ILoadingAnimProps = {
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
