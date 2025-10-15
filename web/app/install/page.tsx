'use client'
import React from 'react'
import Header from '../signin/_header'
import InstallForm from './installForm'
import cn from '@/utils/classnames'
import { useGlobalPublicStore } from '@/context/global-public-context'

const Install = () => {
  const { systemFeatures } = useGlobalPublicStore()
  return (
    <div className={cn('flex min-h-screen w-full justify-center bg-background-default-burn p-6')}>
      <div className={cn('flex w-full shrink-0 flex-col rounded-2xl border border-effects-highlight bg-background-default-subtle')}>
        <Header />
        <InstallForm />
        {!systemFeatures.branding.enabled && <div className='px-8 py-6 text-sm font-normal text-text-tertiary'>
          © {new Date().getFullYear()} LangGenius, Inc. All rights reserved.
        </div>}
      </div>
    </div>
  )
}

export default Install
