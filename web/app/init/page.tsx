import React from 'react'
import style from '../signin/page.module.css'
import InitPasswordPopup from './InitPasswordPopup'
import cn from '@/utils/classnames'

const Install = () => {
  return (
    <div className={cn(
      'bg-background-body',
      style.background,
      'flex min-h-screen w-full',
      'p-4 lg:p-8',
      'gap-x-20',
      'justify-center lg:justify-start',
    )}>
      <div className={
        cn(
          'flex w-full shrink-0 flex-col rounded-2xl bg-background-section-burn shadow',
          'space-between',
        )
      }>
        <div className="m-auto block w-96">
          <InitPasswordPopup />
        </div>
      </div>
    </div>
  )
}

export default Install
