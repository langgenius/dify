'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import cn from 'classnames'
import type { IMainProps } from '@/app/components/share/chat'
import EmbeddedChatbot from '@/app/components/base/chat/embedded-chatbot'
import Loading from '@/app/components/base/loading'
import { fetchSystemFeatures } from '@/service/share'
import LogoSite from '@/app/components/base/logo/logo-site'

const Chatbot: FC<IMainProps> = () => {
  const [isSSOEnforced, setIsSSOEnforced] = React.useState(true)
  const [loading, setLoading] = React.useState(true)

  useEffect(() => {
    fetchSystemFeatures().then((res) => {
      setIsSSOEnforced(res.sso_enforced_for_web)
      setLoading(false)
    })
  }, [])

  return (
    <>
      {
        loading
          ? (
            <div className="flex items-center justify-center h-full" >
              <div className={
                cn(
                  'flex flex-col items-center w-full grow items-center justify-center',
                  'px-6',
                  'md:px-[108px]',
                )
              }>
                <Loading type='area' />
              </div>
            </div >
          )
          : (
            <>
              {isSSOEnforced
                ? (
                  <div className={cn(
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
                      <div className='flex items-center justify-between p-6 w-full'>
                        <LogoSite />
                      </div>

                      <div className={
                        cn(
                          'flex flex-col items-center w-full grow items-center justify-center',
                          'px-6',
                          'md:px-[108px]',
                        )
                      }>
                        <div className='flex flex-col md:w-[400px]'>
                          <div className="w-full mx-auto">
                            <h2 className="text-[16px] font-bold text-gray-900">
                          Warning: Chatbot is not available
                            </h2>
                            <p className="text-[16px] text-gray-600 mt-2">
                          Because SSO is enforced. Please contact your administrator.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
                : <EmbeddedChatbot />
              }
            </>
          )}
    </>
  )
}

export default React.memo(Chatbot)
