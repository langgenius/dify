'use client'
import React from 'react'
import Script from 'next/script'
import { useSystemFeaturesStore } from '../components/system-features-initor/store'
import Forms from './forms'
import Header from './_header'
import style from './page.module.css'
import UserSSOForm from './userSSOForm'
import cn from '@/utils/classnames'
import { IS_CE_EDITION } from '@/config'

const SignIn = () => {
  const { systemFeatures } = useSystemFeaturesStore()

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

          {!systemFeatures.sso_enforced_for_signin && (
            <>
              <Forms />
              <div className='px-8 py-6 text-sm font-normal text-gray-500'>
                © {new Date().getFullYear()} LangGenius, Inc. All rights reserved.
              </div>
            </>
          )}

          {systemFeatures.sso_enforced_for_signin && (
            <UserSSOForm protocol={systemFeatures.sso_enforced_for_signin_protocol} />
          )}
        </div>

      </div>

    </>
  )
}

export default SignIn
