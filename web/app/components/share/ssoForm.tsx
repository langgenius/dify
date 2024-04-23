'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import cn from 'classnames'
import { fetchEnterpriseFeatures } from '@/service/share'
import Loading from '@/app/components/base/loading'

const SSOForm: FC<{
  children: React.ReactNode
}> = ({ children }) => {
  const router = useRouter()
  const pathname = usePathname()
  const [loading, setLoading] = React.useState(true)

  useEffect(() => {
    const webSSOToken = localStorage.getItem('web_sso_token')

    if (!webSSOToken) {
      fetchEnterpriseFeatures().then((res) => {
        if (res.sso_enforced_for_web) {
          localStorage.setItem('web_app_redirect_url', pathname)
          router.push(`/webapp-sso?protocal=${res.sso_enforced_for_web_protocol}`)
        }
        else {
          setLoading(false)
        }
      })
    }
    else {
      setLoading(false)
    }
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
        : children}
    </>
  )
}

export default React.memo(SSOForm)
