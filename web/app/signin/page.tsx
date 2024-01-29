import React from 'react'
import cn from 'classnames'
import Script from 'next/script'
import Forms from './forms'
import Header from './_header'
import style from './page.module.css'
import { IS_CE_EDITION } from '@/config'

const SignIn = () => {
  return (
    <>
      {!IS_CE_EDITION && (
        <>
          <Script strategy="beforeInteractive" async src={'https://www.googletagmanager.com/gtag/js?id=AW-11217955271'}></Script>
          <Script
            id="ga-monitor-register"
            dangerouslySetInnerHTML={{
              __html: `
window.dataLayer2 = window.dataLayer2 || [];
function gtag(){dataLayer2.push(arguments);}
gtag('js', new Date());
gtag('config', 'AW-11217955271"');
        `,
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
          <Forms />
          <div className='px-8 py-6 text-sm font-normal text-gray-500'>
            © {new Date().getFullYear()} LangGenius, Inc. All rights reserved.
          </div>
        </div>

      </div>

    </>
  )
}

export default SignIn
