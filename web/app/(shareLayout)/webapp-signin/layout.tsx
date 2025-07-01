'use client'

import cn from '@/utils/classnames'
import useDocumentTitle from '@/hooks/use-document-title'

export default function SignInLayout({ children }: any) {
  useDocumentTitle('')
  return <>
    <div className={cn('flex min-h-screen w-full justify-center bg-background-default-burn p-6')}>
      <div className={cn('flex w-full shrink-0 flex-col rounded-2xl border border-effects-highlight bg-background-default-subtle')}>
        {/* <Header /> */}
        <div className={cn('flex w-full grow flex-col items-center justify-center px-6 md:px-[108px]')}>
          <div className='flex justify-center md:w-[440px] lg:w-[600px]'>
            {children}
          </div>
        </div>

      </div>
    </div>
  </>
}
