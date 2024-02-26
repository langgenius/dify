'use client'

import { useEffect, useRef, useState } from 'react'
import useSWRInfinite from 'swr/infinite'
import { useTranslation } from 'react-i18next'
import { useDebounceFn } from 'ahooks'
import AppCard from './AppCard'
import NewAppCard from './NewAppCard'
import type { AppListResponse } from '@/models/app'
import { fetchAppList } from '@/service/apps'
import { useAppContext } from '@/context/app-context'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { CheckModal } from '@/hooks/use-pay'
import { useTabSearchParams } from '@/hooks/use-tab-searchparams'
import TabSlider from '@/app/components/base/tab-slider'
import { SearchLg } from '@/app/components/base/icons/src/vender/line/general'
import { XCircle } from '@/app/components/base/icons/src/vender/solid/general'

const getKey = (
  pageIndex: number,
  previousPageData: AppListResponse,
  activeTab: string,
  keywords: string,
) => {
  if (!pageIndex || previousPageData.has_more) {
    const params: any = { url: 'apps', params: { page: pageIndex + 1, limit: 30, name: keywords } }

    if (activeTab !== 'all')
      params.params.mode = activeTab

    return params
  }
  return null
}

const Apps = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager } = useAppContext()
  const [activeTab, setActiveTab] = useTabSearchParams({
    defaultTab: 'all',
  })
  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')

  const { data, isLoading, setSize, mutate } = useSWRInfinite(
    (pageIndex: number, previousPageData: AppListResponse) => getKey(pageIndex, previousPageData, activeTab, searchKeywords),
    fetchAppList,
    { revalidateFirstPage: false },
  )

  const anchorRef = useRef<HTMLDivElement>(null)
  const options = [
    { value: 'all', text: t('app.types.all') },
    { value: 'chat', text: t('app.types.assistant') },
    { value: 'completion', text: t('app.types.completion') },
  ]

  useEffect(() => {
    document.title = `${t('common.menus.apps')} -  Dify`
    if (localStorage.getItem(NEED_REFRESH_APP_LIST_KEY) === '1') {
      localStorage.removeItem(NEED_REFRESH_APP_LIST_KEY)
      mutate()
    }
  }, [mutate, t])

  useEffect(() => {
    let observer: IntersectionObserver | undefined
    if (anchorRef.current) {
      observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !isLoading)
          setSize((size: number) => size + 1)
      }, { rootMargin: '100px' })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [isLoading, setSize, anchorRef, mutate])

  const { run: handleSearch } = useDebounceFn(() => {
    setSearchKeywords(keywords)
  }, { wait: 500 })

  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }

  const handleClear = () => {
    handleKeywordsChange('')
  }

  return (
    <>
      <div className='sticky top-0 flex justify-between items-center pt-4 px-12 pb-2 leading-[56px] bg-gray-100 z-10 flex-wrap gap-y-2'>
        <div className="flex items-center px-2 w-[200px] h-8 rounded-lg bg-gray-200">
          <div className="pointer-events-none shrink-0 flex items-center mr-1.5 justify-center w-4 h-4">
            <SearchLg className="h-3.5 w-3.5 text-gray-500" aria-hidden="true" />
          </div>
          <input
            type="text"
            name="query"
            className="grow block h-[18px] bg-gray-200 rounded-md border-0 text-gray-600 text-[13px] placeholder:text-gray-500 appearance-none outline-none"
            placeholder={t('common.operation.search')!}
            value={keywords}
            onChange={(e) => {
              handleKeywordsChange(e.target.value)
            }}
            autoComplete="off"
          />
          {
            keywords && (
              <div
                className='shrink-0 flex items-center justify-center w-4 h-4 cursor-pointer'
                onClick={handleClear}
              >
                <XCircle className='w-3.5 h-3.5 text-gray-400' />
              </div>
            )
          }
        </div>
        <TabSlider
          value={activeTab}
          onChange={setActiveTab}
          options={options}
        />

      </div>
      <nav className='grid content-start grid-cols-1 gap-4 px-12 pt-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 grow shrink-0'>
        {isCurrentWorkspaceManager
          && <NewAppCard onSuccess={mutate} />}
        {data?.map(({ data: apps }: any) => apps.map((app: any) => (
          <AppCard key={app.id} app={app} onRefresh={mutate} />
        )))}
        <CheckModal />
      </nav>
      <div ref={anchorRef} className='h-0'> </div>
    </>
  )
}

export default Apps
