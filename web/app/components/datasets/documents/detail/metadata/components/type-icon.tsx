import type { FC } from 'react'
import { memo } from 'react'
import { cn } from '@/utils/classnames'
import s from '../style.module.css'

export type TypeIconProps = {
  iconName: string
  className?: string
}

const TypeIcon: FC<TypeIconProps> = ({ iconName, className = '' }) => {
  return (
    <div className={cn(s.commonIcon, s[`${iconName}Icon`], className)} />
  )
}

export default memo(TypeIcon)
