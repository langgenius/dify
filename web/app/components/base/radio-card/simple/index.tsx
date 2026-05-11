'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import s from './style.module.css'

type Props = {
  className?: string
  title: string | React.JSX.Element | null
  description: string
  isChosen: boolean
  onChosen: () => void
  chosenConfig?: React.ReactNode
  icon?: React.JSX.Element
  extra?: React.ReactNode
}

const RadioCard: FC<Props> = ({
  title,
  description,
  isChosen,
  onChosen,
  icon,
  extra,
}) => {
  return (
    <div
      className={cn(s.item, isChosen && s.active)}
      onClick={onChosen}
    >
      <div className="flex px-3 py-2">
        {icon}
        <div>
          <div className="flex items-center justify-between">
            <div className="text-sm leading-5 font-medium text-gray-900">{title}</div>
            <div className={s.radio}></div>
          </div>
          <div className="text-xs leading-[18px] font-normal text-gray-500">{description}</div>
        </div>
      </div>
      {extra}
    </div>
  )
}
export default React.memo(RadioCard)
