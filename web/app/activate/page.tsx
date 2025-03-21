import React from 'react'
import Header from '../signin/_header'
import style from '../signin/page.module.css'
import ActivateForm from './activateForm'
import cn from '@/utils/classnames'

const Activate = () => {
  return (
    <div className={cn(
      style.background,
      'flex min-h-screen w-full',
      'sm:p-4 lg:p-8',
      'gap-x-20',
      'justify-center lg:justify-start',
    )}>
      <div className={
        cn(
          'flex w-full shrink-0 flex-col rounded-2xl bg-white shadow',
          'space-between',
        )
      }>
        <Header />
        <ActivateForm />
        <div className='px-8 py-6 text-sm font-normal text-gray-500'>
          © {new Date().getFullYear()} LangGenius, Inc. All rights reserved.
        </div>
      </div>
    </div>
  )
}

export default Activate
