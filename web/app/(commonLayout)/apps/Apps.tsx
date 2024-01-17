'use client'

import { useEffect, useRef, useState } from 'react'
import useSWRInfinite from 'swr/infinite'
import { useTranslation } from 'react-i18next'
import {
  MagnifyingGlassIcon,
} from '@heroicons/react/24/solid'
import AppCard from './AppCard'
import NewAppCard from './NewAppCard'
import type { AppListResponse } from '@/models/app'
import { fetchAppList } from '@/service/apps'
import { useAppContext } from '@/context/app-context'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { CheckModal } from '@/hooks/use-pay'
import TabSlider from '@/app/components/base/tab-slider'
const getKey = (pageIndex: number, previousPageData: AppListResponse) => {
  if (!pageIndex || previousPageData.has_more)
    return { url: 'apps', params: { page: pageIndex + 1, limit: 30 } }
  return null
}

const Apps = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()
  const { data: allData, isLoading: allIsLoading, setSize: allSetSize, mutate: allMute } = useSWRInfinite(getKey, fetchAppList, { revalidateFirstPage: false })
  const { data: assistantData, isLoading: assistantIsLoading, setSize: assistantSetSize, mutate: assistantMute } = useSWRInfinite(getKey, fetchAppList, { revalidateFirstPage: false })
  const { data: completionData, isLoading: completionIsLoading, setSize: completionSetSize, mutate: completionMute } = useSWRInfinite(getKey, fetchAppList, { revalidateFirstPage: false })

  const anchorRef = useRef<HTMLDivElement>(null)
  const options = [
    { value: 'all', text: t('app.types.all') },
    { value: 'assistant', text: t('app.types.assistant') },
    { value: 'completion', text: t('app.types.completion') },
  ]
  const [activeTab, setActiveTab] = useState('all')
  const [keywords, setKeywords] = useState('')

  const { data, isLoading, setSize, mutate } = (() => {
    return ({
      all: {
        data: allData,
        isLoading: allIsLoading,
        setSize: allSetSize,
        mutate: allMute,
      },
      assistant: {
        data: assistantData,
        isLoading: assistantIsLoading,
        setSize: assistantSetSize,
        mutate: assistantMute,
      },
      completion: {
        data: completionData,
        isLoading: completionIsLoading,
        setSize: completionSetSize,
        mutate: completionMute,
      },
    })[activeTab] as any
  })()

  useEffect(() => {
    document.title = `${t('app.title')} -  Dify`
    if (localStorage.getItem(NEED_REFRESH_APP_LIST_KEY) === '1') {
      localStorage.removeItem(NEED_REFRESH_APP_LIST_KEY)
      mutate()
    }
  }, [mutate, t])

  useEffect(() => {
    let observer: IntersectionObserver | undefined
    if (anchorRef.current) {
      observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting)
          setSize((size: number) => size + 1)
      }, { rootMargin: '100px' })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [isLoading, setSize, anchorRef, mutate])

  return (
    <>
      <div className='sticky top-0 flex items-center pt-4 px-12 pb-2 leading-[56px] bg-gray-100 z-10 flex-wrap gap-y-2'>
        <TabSlider
          value={activeTab}
          onChange={setActiveTab}
          options={options}
        />
        <div className="ml-3 relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <MagnifyingGlassIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
          </div>
          <input
            type="text"
            name="query"
            className="block w-[200px] bg-gray-200 shadow-sm rounded-md border-0 pl-10 text-gray-900 placeholder:text-gray-400 focus:ring-1 focus:ring-inset focus:ring-gray-200 focus-visible:outline-none sm:text-sm sm:leading-8"
            placeholder={t('common.operation.search')!}
            value={keywords}
            onChange={(e) => {
              setKeywords(e.target.value)
            }}
          />
        </div>
      </div>
      <nav className='grid content-start grid-cols-1 gap-4 px-12 pt-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 grow shrink-0'>
        {isCurrentWorkspaceManager
          && <NewAppCard onSuccess={mutate} />}
        {data?.map(({ data: apps }) => apps.map(app => (
          <AppCard key={app.id} app={app} onRefresh={mutate} />
        )))}
        <CheckModal />
      </nav>
      <div ref={anchorRef} className='h-0'> </div>
    </>
  )
}

export default Apps
