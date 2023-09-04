'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWRInfinite from 'swr/infinite'
import { useTranslation } from 'react-i18next'
import AppCard from './AppCard'
import NewAppCard from './NewAppCard'
import type { AppListResponse } from '@/models/app'
import { fetchAppList } from '@/service/apps'
import { useAppContext } from '@/context/app-context'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { ProviderEnum } from '@/app/components/header/account-setting/model-page/declarations'
import Confirm from '@/app/components/base/confirm/common'

const getKey = (pageIndex: number, previousPageData: AppListResponse) => {
  if (!pageIndex || previousPageData.has_more)
    return { url: 'apps', params: { page: pageIndex + 1, limit: 30 } }
  return null
}

const Apps = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()
  const { data, isLoading, setSize, mutate } = useSWRInfinite(getKey, fetchAppList, { revalidateFirstPage: false })
  const anchorRef = useRef<HTMLDivElement>(null)
  const searchParams = useSearchParams()
  const router = useRouter()
  const payProviderName = searchParams.get('provider_name')
  const payStatus = searchParams.get('payment_result')
  const [showPayStatusModal, setShowPayStatusModal] = useState(false)

  const handleCancelShowPayStatusModal = useCallback(() => {
    setShowPayStatusModal(false)
    router.replace('/', { forceOptimisticNavigation: false })
  }, [router])

  useEffect(() => {
    document.title = `${t('app.title')} -  Dify`
    if (localStorage.getItem(NEED_REFRESH_APP_LIST_KEY) === '1') {
      localStorage.removeItem(NEED_REFRESH_APP_LIST_KEY)
      mutate()
    }
    if (payProviderName === ProviderEnum.anthropic && (payStatus === 'succeeded' || payStatus === 'cancelled'))
      setShowPayStatusModal(true)
  }, [mutate, payProviderName, payStatus, t])

  useEffect(() => {
    let observer: IntersectionObserver | undefined
    if (anchorRef.current) {
      observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting)
          setSize(size => size + 1)
      }, { rootMargin: '100px' })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [isLoading, setSize, anchorRef, mutate])

  return (
    <><nav className='grid content-start grid-cols-1 gap-4 px-12 pt-8 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 grow shrink-0'>
      { isCurrentWorkspaceManager
      && <NewAppCard onSuccess={mutate} />}
      {data?.map(({ data: apps }) => apps.map(app => (
        <AppCard key={app.id} app={app} onRefresh={mutate} />
      )))}
      {
        showPayStatusModal && (
          <Confirm
            isShow
            onCancel={handleCancelShowPayStatusModal}
            onConfirm={handleCancelShowPayStatusModal}
            type={
              payStatus === 'succeeded'
                ? 'success'
                : 'danger'
            }
            title={
              payStatus === 'succeeded'
                ? t('common.actionMsg.paySucceeded')
                : t('common.actionMsg.payCancelled')
            }
            showOperateCancel={false}
            confirmText={(payStatus === 'cancelled' && t('common.operation.ok')) || ''}
          />
        )
      }
    </nav>
    <div ref={anchorRef} className='h-0'> </div>
    </>
  )
}

export default Apps
