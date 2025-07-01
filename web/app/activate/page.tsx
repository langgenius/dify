'use client'
import React from 'react'
import Header from '../signin/_header'
import ActivateForm from './activateForm'
import cn from '@/utils/classnames'

const Activate = () => {
  return (
    <div className={cn('flex min-h-screen w-full justify-center bg-background-default-burn p-6')}>
      <div className={cn('flex w-full shrink-0 flex-col rounded-2xl border border-effects-highlight bg-background-default-subtle')}>
        <Header />
        <ActivateForm />

      </div>
    </div>
  )
}

export default Activate
