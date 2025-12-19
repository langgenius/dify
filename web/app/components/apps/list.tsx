'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useRouter,
} from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useDebounceFn } from 'ahooks'
import {
  RiApps2Line,
  RiDragDropLine,
  RiExchange2Line,
  RiFile4Line,
  RiMessage3Line,
  RiRobot3Line,
} from '@remixicon/react'
import AppCard from './app-card'
import NewAppCard from './new-app-card'
import useAppsQueryState from './hooks/use-apps-query-state'
import { useDSLDragDrop } from './hooks/use-dsl-drag-drop'
import { useAppContext } from '@/context/app-context'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { CheckModal } from '@/hooks/use-pay'
import TabSliderNew from '@/app/components/base/tab-slider-new'
import { useTabSearchParams } from '@/hooks/use-tab-searchparams'
import Input from '@/app/components/base/input'
import { useStore as useTagStore } from '@/app/components/base/tag-management/store'
import TagFilter from '@/app/components/base/tag-management/filter'
import CheckboxWithLabel from '@/app/components/datasets/create/website/base/checkbox-with-label'
import dynamic from 'next/dynamic'
import Empty from './empty'
import Footer from './footer'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { AppModeEnum } from '@/types/app'
import { useInfiniteAppList } from '@/service/use-apps'

const TagManagementModal = dynamic(() => import('@/app/components/base/tag-management'), {
  ssr: false,
})
const CreateFromDSLModal = dynamic(() => import('@/app/components/app/create-from-dsl-modal'), {
  ssr: false,
})

const List = () => {
  const { t } = useTranslation()
  const { systemFeatures } = useGlobalPublicStore()
  const router = useRouter()
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator } = useAppContext()
  const showTagManagementModal = useTagStore(s => s.showTagManagementModal)
  const [activeTab, setActiveTab] = useTabSearchParams({
    defaultTab: 'all',
  })
  const { query: { tagIDs = [], keywords = '', isCreatedByMe: queryIsCreatedByMe = false }, setQuery } = useAppsQueryState()
  const [isCreatedByMe, setIsCreatedByMe] = useState(queryIsCreatedByMe)
  const [tagFilterValue, setTagFilterValue] = useState<string[]>(tagIDs)
  const [searchKeywords, setSearchKeywords] = useState(keywords)
  const newAppCardRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [showCreateFromDSLModal, setShowCreateFromDSLModal] = useState(false)
  const [droppedDSLFile, setDroppedDSLFile] = useState<File | undefined>()
  const setKeywords = useCallback((keywords: string) => {
    setQuery(prev => ({ ...prev, keywords }))
  }, [setQuery])
  const setTagIDs = useCallback((tagIDs: string[]) => {
    setQuery(prev => ({ ...prev, tagIDs }))
  }, [setQuery])

  const handleDSLFileDropped = useCallback((file: File) => {
    setDroppedDSLFile(file)
    setShowCreateFromDSLModal(true)
  }, [])

  const { dragging } = useDSLDragDrop({
    onDSLFileDropped: handleDSLFileDropped,
    containerRef,
    enabled: isCurrentWorkspaceEditor,
  })

  const appListQueryParams = {
    page: 1,
    limit: 30,
    name: searchKeywords,
    tag_ids: tagIDs,
    is_created_by_me: isCreatedByMe,
    ...(activeTab !== 'all' ? { mode: activeTab as AppModeEnum } : {}),
  }

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error,
    refetch,
  } = useInfiniteAppList(appListQueryParams, { enabled: !isCurrentWorkspaceDatasetOperator })

  const anchorRef = useRef<HTMLDivElement>(null)
  const options = [
    { value: 'all', text: t('app.types.all'), icon: <RiApps2Line className='mr-1 h-[14px] w-[14px]' /> },
    { value: AppModeEnum.WORKFLOW, text: t('app.types.workflow'), icon: <RiExchange2Line className='mr-1 h-[14px] w-[14px]' /> },
    { value: AppModeEnum.ADVANCED_CHAT, text: t('app.types.advanced'), icon: <RiMessage3Line className='mr-1 h-[14px] w-[14px]' /> },
    { value: AppModeEnum.CHAT, text: t('app.types.chatbot'), icon: <RiMessage3Line className='mr-1 h-[14px] w-[14px]' /> },
    { value: AppModeEnum.AGENT_CHAT, text: t('app.types.agent'), icon: <RiRobot3Line className='mr-1 h-[14px] w-[14px]' /> },
    { value: AppModeEnum.COMPLETION, text: t('app.types.completion'), icon: <RiFile4Line className='mr-1 h-[14px] w-[14px]' /> },
  ]

  useEffect(() => {
    if (localStorage.getItem(NEED_REFRESH_APP_LIST_KEY) === '1') {
      localStorage.removeItem(NEED_REFRESH_APP_LIST_KEY)
      refetch()
    }
  }, [refetch])

  useEffect(() => {
    if (isCurrentWorkspaceDatasetOperator)
      return router.replace('/datasets')
  }, [router, isCurrentWorkspaceDatasetOperator])

  useEffect(() => {
    if (isCurrentWorkspaceDatasetOperator)
      return
    const hasMore = hasNextPage ?? true
    let observer: IntersectionObserver | undefined

    if (error) {
      if (observer)
        observer.disconnect()
      return
    }

    if (anchorRef.current && containerRef.current) {
      // Calculate dynamic rootMargin: clamps to 100-200px range, using 20% of container height as the base value for better responsiveness
      const containerHeight = containerRef.current.clientHeight
      const dynamicMargin = Math.max(100, Math.min(containerHeight * 0.2, 200)) // Clamps to 100-200px range, using 20% of container height as the base value

      observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !isLoading && !isFetchingNextPage && !error && hasMore)
          fetchNextPage()
      }, {
        root: containerRef.current,
        rootMargin: `${dynamicMargin}px`,
        threshold: 0.1, // Trigger when 10% of the anchor element is visible
      })
      observer.observe(anchorRef.current)
    }
    return () => observer?.disconnect()
  }, [isLoading, isFetchingNextPage, fetchNextPage, error, hasNextPage, isCurrentWorkspaceDatasetOperator])

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

  const handleCreatedByMeChange = useCallback(() => {
    const newValue = !isCreatedByMe
    setIsCreatedByMe(newValue)
    setQuery(prev => ({ ...prev, isCreatedByMe: newValue }))
  }, [isCreatedByMe, setQuery])

  const pages = data?.pages ?? []
  const hasAnyApp = (pages[0]?.total ?? 0) > 0

  return (
    <>
      <div ref={containerRef} className='relative flex h-0 shrink-0 grow flex-col overflow-y-auto bg-background-body'>
        {dragging && (
          <div className="absolute inset-0 z-50 m-0.5 rounded-2xl border-2 border-dashed border-components-dropzone-border-accent bg-[rgba(21,90,239,0.14)] p-2">
          </div>
        )}

        <div className='sticky top-0 z-10 flex flex-wrap items-center justify-between gap-y-2 bg-background-body px-12 pb-5 pt-7'>
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
              onChange={handleCreatedByMeChange}
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
        {hasAnyApp
          ? <div className='relative grid grow grid-cols-1 content-start gap-4 px-12 pt-2 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5 2k:grid-cols-6'>
            {isCurrentWorkspaceEditor
              && <NewAppCard ref={newAppCardRef} onSuccess={refetch} selectedAppType={activeTab} />}
            {pages.map(({ data: apps }) => apps.map(app => (
              <AppCard key={app.id} app={app} onRefresh={refetch} />
            )))}
          </div>
          : <div className='relative grid grow grid-cols-1 content-start gap-4 overflow-hidden px-12 pt-2 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5 2k:grid-cols-6'>
            {isCurrentWorkspaceEditor
              && <NewAppCard ref={newAppCardRef} className='z-10' onSuccess={refetch} selectedAppType={activeTab} />}
            <Empty />
          </div>}

        {isCurrentWorkspaceEditor && (
          <div
            className={`flex items-center justify-center gap-2 py-4 ${dragging ? 'text-text-accent' : 'text-text-quaternary'}`}
            role="region"
            aria-label={t('app.newApp.dropDSLToCreateApp')}
          >
            <RiDragDropLine className="h-4 w-4" />
            <span className="system-xs-regular">{t('app.newApp.dropDSLToCreateApp')}</span>
          </div>
        )}
        {!systemFeatures.branding.enabled && (
          <Footer />
        )}
        <CheckModal />
        <div ref={anchorRef} className='h-0'> </div>
        {showTagManagementModal && (
          <TagManagementModal type='app' show={showTagManagementModal} />
        )}
      </div>

      {showCreateFromDSLModal && (
        <CreateFromDSLModal
          show={showCreateFromDSLModal}
          onClose={() => {
            setShowCreateFromDSLModal(false)
            setDroppedDSLFile(undefined)
          }}
          onSuccess={() => {
            setShowCreateFromDSLModal(false)
            setDroppedDSLFile(undefined)
            refetch()
          }}
          droppedFile={droppedDSLFile}
        />
      )}
    </>
  )
}

export default List
