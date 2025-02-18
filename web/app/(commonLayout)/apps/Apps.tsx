'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWRInfinite from 'swr/infinite'
import { useTranslation } from 'react-i18next'
import { useDebounceFn } from 'ahooks'
import {
  RiApps2Line,
  RiExchange2Line,
  RiMessage3Line,
  RiRobot3Line,
} from '@remixicon/react'
import AppCard from './AppCard'
import NewAppCard from './NewAppCard'
import useAppsQueryState from './hooks/useAppsQueryState'
import type { AppListResponse } from '@/models/app'
import { fetchAppList } from '@/service/apps'
import { useAppContext } from '@/context/app-context'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { CheckModal } from '@/hooks/use-pay'
import TabSliderNew from '@/app/components/base/tab-slider-new'
import { useTabSearchParams } from '@/hooks/use-tab-searchparams'
import Input from '@/app/components/base/input'
import { useStore as useTagStore } from '@/app/components/base/tag-management/store'
import TagManagementModal from '@/app/components/base/tag-management'
import TagFilter from '@/app/components/base/tag-management/filter'
import CheckboxWithLabel from '@/app/components/datasets/create/website/base/checkbox-with-label'

const getKey = (
  pageIndex: number,
  previousPageData: AppListResponse,
  activeTab: string,
  isCreatedByMe: boolean,
  tags: string[],
  keywords: string,
) => {
  if (!pageIndex || previousPageData.has_more) {
    const params: any = { url: 'apps', params: { page: pageIndex + 1, limit: 30, name: keywords, is_created_by_me: isCreatedByMe } }

    if (activeTab !== 'all')
      params.params.mode = activeTab
    else
      delete params.params.mode

    if (tags.length)
      params.params.tag_ids = tags

    return params
  }
  return null
}

const Apps = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator } = useAppContext()
  const showTagManagementModal = useTagStore(s => s.showTagManagementModal)
  const [activeTab, setActiveTab] = useTabSearchParams({
    defaultTab: 'all',
  })
  const { query: { tagIDs = [], keywords = '' }, setQuery } = useAppsQueryState()
  const [isCreatedByMe, setIsCreatedByMe] = useState(false)
  const [tagFilterValue, setTagFilterValue] = useState<string[]>(tagIDs)
  const [searchKeywords, setSearchKeywords] = useState(keywords)
  const setKeywords = useCallback((keywords: string) => {
    setQuery(prev => ({ ...prev, keywords }))
  }, [setQuery])
  const setTagIDs = useCallback((tagIDs: string[]) => {
    setQuery(prev => ({ ...prev, tagIDs }))
  }, [setQuery])

  const { data, isLoading, setSize, mutate } = useSWRInfinite(
    (pageIndex: number, previousPageData: AppListResponse) => getKey(pageIndex, previousPageData, activeTab, isCreatedByMe, tagIDs, searchKeywords),
    fetchAppList,
    { revalidateFirstPage: true },
  )

  const anchorRef = useRef<HTMLDivElement>(null)
  const options = [
    { value: 'all', text: t('app.types.all'), icon: <RiApps2Line className='mr-1 h-[14px] w-[14px]' /> },
    { value: 'chat', text: t('app.types.chatbot'), icon: <RiMessage3Line className='mr-1 h-[14px] w-[14px]' /> },
    { value: 'agent-chat', text: t('app.types.agent'), icon: <RiRobot3Line className='mr-1 h-[14px] w-[14px]' /> },
    { value: 'workflow', text: t('app.types.workflow'), icon: <RiExchange2Line className='mr-1 h-[14px] w-[14px]' /> },
  ]

  useEffect(() => {
    document.title = `${t('common.menus.apps')} -  Dify`
    if (localStorage.getItem(NEED_REFRESH_APP_LIST_KEY) === '1') {
      localStorage.removeItem(NEED_REFRESH_APP_LIST_KEY)
      mutate()
    }
  }, [mutate, t])

  useEffect(() => {
    if (isCurrentWorkspaceDatasetOperator)
      return router.replace('/datasets')
  }, [router, isCurrentWorkspaceDatasetOperator])

  useEffect(() => {
    const hasMore = data?.at(-1)?.has_more ?? true
    let observer: IntersectionObserver | undefined
    if (anchorRef.current) {
      observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !isLoading && hasMore)
          setSize((size: number) => size + 1)
      }, { rootMargin: '100px' })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [isLoading, setSize, anchorRef, mutate, data])

  const { run: handleSearch } = useDebounceFn(() => {
    setSearchKeywords(keywords)
  }, { wait: 500 })
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }

  const { run: handleTagsUpdate } = useDebounceFn(() => {
    setTagIDs(tagFilterValue)
  }, { wait: 500 })
  const handleTagsChange = (value: string[]) => {
    setTagFilterValue(value)
    handleTagsUpdate()
  }

  return (
    <>
      <div className='bg-background-body sticky top-0 z-10 flex flex-wrap items-center justify-between gap-y-2 px-12 pb-2 pt-4 leading-[56px]'>
        <TabSliderNew
          value={activeTab}
          onChange={setActiveTab}
          options={options}
        />
        <div className='flex items-center gap-2'>
          <CheckboxWithLabel
            className='mr-2'
            label={t('app.showMyCreatedAppsOnly')}
            isChecked={isCreatedByMe}
            onChange={() => setIsCreatedByMe(!isCreatedByMe)}
          />
          <TagFilter type='app' value={tagFilterValue} onChange={handleTagsChange} />
          <Input
            showLeftIcon
            showClearIcon
            wrapperClassName='w-[200px]'
            value={keywords}
            onChange={e => handleKeywordsChange(e.target.value)}
            onClear={() => handleKeywordsChange('')}
          />
        </div>
      </div>
      {(data && data[0].total > 0)
        ? <div className='2k:grid-cols-6 relative grid grow grid-cols-1 content-start gap-4 px-12 pt-2 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5'>
          {isCurrentWorkspaceEditor
            && <NewAppCard onSuccess={mutate} />}
          {data.map(({ data: apps }) => apps.map(app => (
            <AppCard key={app.id} app={app} onRefresh={mutate} />
          )))}
        </div>
        : <div className='2k:grid-cols-6 relative grid grow grid-cols-1 content-start gap-4 overflow-hidden px-12 pt-2 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5'>
          {isCurrentWorkspaceEditor
            && <NewAppCard className='z-10' onSuccess={mutate} />}
          <NoAppsFound />
        </div>}
      <CheckModal />
      <div ref={anchorRef} className='h-0'> </div>
      {showTagManagementModal && (
        <TagManagementModal type='app' show={showTagManagementModal} />
      )}
    </>
  )
}

export default Apps

function NoAppsFound() {
  const { t } = useTranslation()
  function renderDefaultCard() {
    const defaultCards = Array.from({ length: 36 }, (_, index) => (
      <div key={index} className='bg-background-default-lighter inline-flex h-[160px] rounded-xl'></div>
    ))
    return defaultCards
  }
  return (
    <>
      {renderDefaultCard()}
      <div className='from-background-body absolute bottom-0 left-0 right-0 top-0 flex items-center justify-center bg-gradient-to-t to-transparent'>
        <span className='system-md-medium text-text-tertiary'>{t('app.newApp.noAppsFound')}</span>
      </div>
    </>
  )
}
