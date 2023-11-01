'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import s from './style.module.css'

type Props = {
  className?: string
  icon?: React.ReactNode
  title: string
  description: string
  isChosen: boolean
  onChosen: () => void
  chosenConfig?: React.ReactNode
}

const RadioCard: FC<Props> = ({
  icon,
  title,
  description,
  isChosen,
  onChosen,
  chosenConfig,
}) => {
  return (
    <div className={cn(s.radioItem, isChosen && s.active)}>
      <div className=''>
        {icon && (
          <div className={cn(s.typeIcon)}>{icon}</div>
        )}
        <div className={s.radio} onClick={onChosen}></div>
        <div className={s.typeHeader}>
          <div className={s.title}>{title}</div>
          <div className={s.tip}>{description}</div>
        </div>
      </div>
      {(isChosen && chosenConfig) && (
        <div className={s.typeFormBody}>
          {chosenConfig}
        </div>
      )}
    </div>
  )
}
export default React.memo(RadioCard)
