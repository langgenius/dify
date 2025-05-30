'use client'
import Header from '@/app/signin/_header'

import cn from '@/utils/classnames'
import { useGlobalPublicStore } from '@/context/global-public-context'

export default function SignInLayout({ children }: any) {
  const { systemFeatures } = useGlobalPublicStore()
  return <>
    <div className={cn('flex min-h-screen w-full justify-center bg-background-default-burn p-6')}>
      <div className={cn('flex w-full shrink-0 flex-col rounded-2xl border border-effects-highlight bg-background-default-subtle')}>
        <Header />
        <div className={
          cn(
            'flex w-full grow flex-col items-center justify-center',
            'px-6',
            'md:px-[108px]',
          )
        }>
          <div className='flex w-[400px] flex-col'>
            {children}
          </div>
        </div>
        {!systemFeatures.branding.enabled && <div className='system-xs-regular px-8 py-6 text-text-tertiary'>
          © {new Date().getFullYear()} LangGenius, Inc. All rights reserved.
        </div>}
      </div>
    </div>
  </>
}
