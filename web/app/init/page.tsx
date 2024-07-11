import React from 'react'
import style from '../signin/page.module.css'
import InitPasswordPopup from './InitPasswordPopup'
import classNames from '@/utils/classnames'

const Install = () => {
  return (
    <div className={classNames(
      style.background,
      'flex w-full min-h-screen',
      'p-4 lg:p-8',
      'gap-x-20',
      'justify-center lg:justify-start',
    )}>
      <div className="block m-auto w-96">
        <InitPasswordPopup />
      </div>
    </div>
  )
}

export default Install
