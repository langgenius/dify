import Header from './_header'

import cn from '@/utils/classnames'

export default async function SignInLayout({ children }: any) {
  return <>
    <div className={cn('flex min-h-screen w-full justify-center bg-background-default-burn p-6')}>
      <div className={cn('flex w-full shrink-0 flex-col rounded-2xl border border-effects-highlight bg-background-default-subtle')}>
        <Header />
        <div className={cn('flex w-full grow flex-col items-center justify-center px-6 md:px-[108px]')}>
          <div className='flex flex-col md:w-[400px]'>
            {children}
          </div>
        </div>
        <div className='system-xs-regular px-8 py-6 text-text-tertiary'>
          © {new Date().getFullYear()} LangGenius, Inc. All rights reserved.
        </div>
      </div>
    </div>
  </>
}
