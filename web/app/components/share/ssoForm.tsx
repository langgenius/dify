'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import cn from 'classnames'
import { fetchSystemFeatures } from '@/service/share'
import Loading from '@/app/components/base/loading'
import LogoSite from '@/app/components/base/logo/logo-site'

type SSOFormProps = {
  children: React.ReactNode
  isChatbot?: boolean
}

const SSOForm: FC<SSOFormProps> = ({ children, isChatbot }) => {
  const router = useRouter()
  const pathname = usePathname()

  const [isSSOEnforced, setIsSSOEnforced] = React.useState(true)
  const [loading, setLoading] = React.useState(true)

  useEffect(() => {
    fetchSystemFeatures().then((res) => {
      setIsSSOEnforced(res.sso_enforced_for_web)

      if (res.sso_enforced_for_web && !isChatbot) {
        const webSSOToken = localStorage.getItem('web_sso_token')
        if (webSSOToken) {
          setLoading(false)
          return
        }

        localStorage.setItem('web_app_redirect_url', pathname)
        router.push(`/webapp-sso?protocal=${res.sso_enforced_for_web_protocol}`)
      }
      else {
        setLoading(false)
      }
    })
  }, [])

  return (
    <>
      {loading
        ? (
          <div className="flex items-center justify-center h-full">
            <div className={
              cn(
                'flex flex-col items-center w-full grow items-center justify-center',
                'px-6',
                'md:px-[108px]',
              )
            }>
              <Loading type='area' />
            </div>
          </div>
        )
        : (
          <>
            {isChatbot && (
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
                  : children}
              </>
            )}

            {!isChatbot && !loading && (children)}
          </>
        )}
    </>
  )
}

export default React.memo(SSOForm)
