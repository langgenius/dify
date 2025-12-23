'use client'
import * as React from 'react'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { cn } from '@/utils/classnames'
import Header from '../signin/_header'
import ActivateForm from './activateForm'

const Activate = () => {
  const { systemFeatures } = useGlobalPublicStore()
  return (
    <div className={cn('flex min-h-screen w-full justify-center bg-background-default-burn p-6')}>
      <div className={cn('flex w-full shrink-0 flex-col rounded-2xl border border-effects-highlight bg-background-default-subtle')}>
        <Header />
        <ActivateForm />
        {!systemFeatures.branding.enabled && (
          <div className="px-8 py-6 text-sm font-normal text-text-tertiary">
            ©
            {' '}
            {new Date().getFullYear()}
            {' '}
            LangGenius, Inc. All rights reserved.
          </div>
        )}
      </div>
    </div>
  )
}

export default Activate
