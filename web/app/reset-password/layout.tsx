import Header from '../signin/_header'
import style from '../signin/page.module.css'

import cn from '@/utils/classnames'

export default async function SignInLayout({ children }: any) {
  return <>
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
        <div className={
          cn(
            'flex w-full grow flex-col items-center justify-center',
            'px-6',
            'md:px-[108px]',
          )
        }>
          <div className='flex flex-col md:w-[400px]'>
            {children}
          </div>
        </div>
        <div className='system-xs-regular text-text-tertiary px-8 py-6'>
          © {new Date().getFullYear()} LangGenius, Inc. All rights reserved.
        </div>
      </div>
    </div>
  </>
}
