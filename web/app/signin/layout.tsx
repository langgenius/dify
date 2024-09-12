import Script from 'next/script'
import Header from './_header'
import style from './page.module.css'

import cn from '@/utils/classnames'
import { IS_CE_EDITION } from '@/config'

export default async function SignInLayout({ children }: any) {
  return <>
    {!IS_CE_EDITION && (
      <>
        <Script strategy="beforeInteractive" async src={'https://www.googletagmanager.com/gtag/js?id=AW-11217955271'}></Script>
        <Script
          id="ga-monitor-register"
          dangerouslySetInnerHTML={{
            __html: 'window.dataLayer2 = window.dataLayer2 || [];function gtag(){dataLayer2.push(arguments);}gtag(\'js\', new Date());gtag(\'config\', \'AW-11217955271"\');',
          }}
        >
        </Script>
      </>
    )}

    <div className={cn(
      style.background,
      'flex w-full min-h-screen',
      'sm:p-4 lg:p-8',
      'gap-x-20',
      'justify-center lg:justify-start',
    )}>
      <div className={
        cn(
          'flex w-full flex-col bg-white shadow rounded-2xl shrink-0',
          'space-between',
        )
      }>
        <Header />
        <div className={
          cn(
            'flex flex-col items-center w-full grow justify-center',
            'px-6',
            'md:px-[108px]',
          )
        }>
          <div className='flex flex-col md:w-[400px]'>
            {children}
          </div>
        </div>
        <div className='px-8 py-6 system-xs-regular text-text-tertiary'>
          © {new Date().getFullYear()} LangGenius, Inc. All rights reserved.
        </div>
      </div>
    </div>
  </>
}
