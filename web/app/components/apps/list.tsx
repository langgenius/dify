'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useRouter,
} from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { useDebounceFn } from 'ahooks'

import AppCard from './app-card'
import NewAppCard from './new-app-card'
import useAppsQueryState from './hooks/use-apps-query-state'
import type { SortBy, SortOrder } from './hooks/use-apps-query-state'
import SortDropdown from './sort'
import { useDSLDragDrop } from './hooks/use-dsl-drag-drop'
import { useAppContext } from '@/context/app-context'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { CheckModal } from '@/hooks/use-pay'
import TabSliderNew from '@/app/components/base/tab-slider-new'
import { useTabSearchParams } from '@/hooks/use-tab-searchparams'
import Input from '@/app/components/base/input'
import { useStore as useTagStore } from '@/app/components/base/tag-management/store'
import TagFilter from '@/app/components/base/tag-management/filter'
import dynamic from 'next/dynamic'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { AppModeEnum } from '@/types/app'
import { useInfiniteAppList } from '@/service/use-apps'
import { RiDragDropLine } from '@remixicon/react'
import CheckboxWithLabel from '@/app/components/datasets/create/website/base/checkbox-with-label'
import { cn } from '@/utils/classnames'
import AppCard from './app-card'
import { AppCardSkeleton } from './app-card-skeleton'
import Empty from './empty'
import Footer from './footer'

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
  const { isCurrentWorkspaceEditor, isCurrentWorkspaceDatasetOperator, isLoadingCurrentWorkspace } = useAppContext()
  const showTagManagementModal = useTagStore(s => s.showTagManagementModal)
  const [activeTab, setActiveTab] = useTabSearchParams({
    defaultTab: 'all',
  })
  const { query: { tagIDs = [], keywords = '', isCreatedByMe: queryIsCreatedByMe = true, sortBy, sortOrder }, setQuery } = useAppsQueryState()
  const [isCreatedByMe, setIsCreatedByMe] = useState(queryIsCreatedByMe)
  const [tagFilterValue, setTagFilterValue] = useState<string[]>(tagIDs)
  const [searchKeywords, setSearchKeywords] = useState(keywords)
  const newAppCardRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const setKeywords = useCallback((keywords: string) => {
    setQuery(prev => ({ ...prev, keywords }))
  }, [setQuery])
  const setTagIDs = useCallback((tagIDs: string[]) => {
    setQuery(prev => ({ ...prev, tagIDs }))
  }, [setQuery])

  const appListQueryParams = {
    page: 1,
    limit: 30,
    name: searchKeywords,
    tag_ids: tagIDs,
    is_created_by_me: isCreatedByMe,
    ...(activeTab !== 'all' ? { mode: activeTab as AppModeEnum } : {}),
    ...(sortBy ? { sort_by: sortBy } : {}),
    ...(sortOrder ? { sort_order: sortOrder } : {}),
  }

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error,
    refetch,
  } = useInfiniteAppList(appListQueryParams, { enabled: !isCurrentWorkspaceDatasetOperator })

  const anchorRef = useRef<HTMLDivElement>(null)

  const [showCreateFromDSLModal, setShowCreateFromDSLModal] = useState(false)
  const [droppedDSLFile, setDroppedDSLFile] = useState<File>()
  const { dragging } = useDSLDragDrop({
    containerRef,
    onDSLFileDropped: (file) => {
      setDroppedDSLFile(file)
      setShowCreateFromDSLModal(true)
    },
  })

  const AllRiApps2Line = (props: { className: string }) => (
    <svg
      id="all"
      className={props.className}
      data-name="Layer 1"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 438.99 460.41"
    >
      <path
        fill="currentColor"
        d="M217.78,2.15c6.49,4.99,9.82,12.5,13.59,19.56,2.32,4.25,4.82,8.4,7.3,12.56,1.12,1.88,2.23,3.76,3.34,5.64.59.99,1.17,1.98,1.78,3,3.48,5.88,6.93,11.78,10.38,17.68,4.98,8.51,9.98,17.01,15,25.5,5.39,9.11,10.75,18.25,16.1,27.38,4.62,7.88,9.24,15.76,13.9,23.62,6.9,11.67,13.79,23.35,20.61,35.07,1.95,3.35,3.94,6.67,5.97,9.98q7.27,12,6.54,18.77c-1.47,5.13-3.59,8.91-8.15,11.76-4.39,1.8-7.99,1.84-12.69,1.81-.92,0-1.84.01-2.78.02-3.07.02-6.15.01-9.22,0-2.21,0-4.41.02-6.62.03-5.99.02-11.98.03-17.97.02-5,0-10,0-15,.02-12.47.02-24.94.02-37.41.01-10.82,0-21.65.02-32.47.05-11.12.03-22.24.05-33.36.04-6.24,0-12.48,0-18.72.03-5.87.02-11.74.02-17.6,0-2.15,0-4.31,0-6.46.02-2.94.02-5.88,0-8.82-.01q-1.28.02-2.58.04c-5.86-.09-9.51-1.58-13.76-5.66-3.59-4.98-3.75-10.07-3-16,1.26-3.47,3.03-6.53,4.94-9.69.51-.88,1.01-1.75,1.53-2.66,1.49-2.57,3-5.11,4.53-7.66.71-1.2,1.42-2.41,2.14-3.61,1.38-2.31,2.77-4.61,4.17-6.91,3.72-6.14,7.32-12.34,10.95-18.54,1.49-2.55,2.99-5.11,4.48-7.66.37-.63.73-1.25,1.11-1.9,3.2-5.47,6.43-10.93,9.65-16.38,5.02-8.49,10.02-16.99,15-25.5,5.49-9.38,11.01-18.75,16.54-28.11,3.42-5.78,6.82-11.56,10.21-17.36,2.9-4.95,5.8-9.9,8.71-14.85,2.2-3.74,4.38-7.5,6.54-11.27,1.04-1.79,2.08-3.57,3.12-5.36q.67-1.19,1.36-2.4c3.11-5.29,6.97-10.89,13.09-12.81,4.82-.87,9.64-.51,14.04,1.72ZM207.67,50.09c-.3.52-.59,1.04-.9,1.58-6.21,10.93-12.48,21.81-18.89,32.62-4.6,7.75-9.16,15.52-13.71,23.3-4.98,8.51-9.98,17.01-15,25.5-4.8,8.12-9.59,16.24-14.36,24.38-.75,1.27-1.49,2.54-2.24,3.81-1.05,1.79-2.1,3.57-3.15,5.36q-.9,1.54-1.83,3.11c-2.35,4.08-4.63,8.21-6.92,12.33h156c-2.64-4.62-5.28-9.24-8-14q-1.46-2.57-2.95-5.19c-5.53-9.72-11.14-19.4-16.84-29.02-4.6-7.75-9.16-15.52-13.71-23.29-5.55-9.49-11.12-18.96-16.73-28.42-2.91-4.9-5.78-9.83-8.61-14.77-.64-1.11-1.28-2.23-1.94-3.38-1.25-2.17-2.49-4.34-3.72-6.52-.56-.97-1.12-1.94-1.69-2.94-.49-.87-.99-1.73-1.49-2.62-.43-.61-.86-1.22-1.31-1.85h-2Z"
      />
      <path
        fill="currentColor"
        d="M18.39,266.71c.65,0,1.3,0,1.97-.01,2.16-.01,4.33,0,6.49,0,1.56,0,3.12,0,4.67-.02,4.22-.01,8.44,0,12.66,0,4.42,0,8.84,0,13.26,0,7.42,0,14.85,0,22.27.02,8.58.02,17.16.01,25.74,0,7.37-.01,14.74-.02,22.11,0,4.4,0,8.8,0,13.2,0,4.14,0,8.27,0,12.41.01,1.52,0,3.03,0,4.55,0,2.07,0,4.15,0,6.22.02,1.16,0,2.32,0,3.51,0,4.84.57,8.11,2.23,11.45,5.75,3.15,4.72,4,8.43,4.02,14.09q.01,1.96.03,3.96c0,1.44,0,2.89,0,4.33,0,1.52.01,3.05.02,4.57.02,4.14.02,8.27.02,12.41,0,2.59,0,5.17.01,7.76.02,9.03.03,18.06.03,27.08,0,8.41.02,16.81.05,25.22.03,7.22.04,14.45.04,21.67,0,4.31,0,8.62.03,12.93.02,4.06.02,8.11,0,12.17,0,1.49,0,2.97.01,4.46.06,8.04.02,14.15-4.5,20.96-4.64,4.41-8.07,5.12-14.34,5.15q-.97,0-1.96.01c-2.17.01-4.34.02-6.51.03-1.55,0-3.11.02-4.66.02-5.11.03-10.21.04-15.32.06-1.76,0-3.52.01-5.28.02-7.32.02-14.64.04-21.95.05-10.48.02-20.97.05-31.45.11-7.37.04-14.75.06-22.12.06-4.4,0-8.8.02-13.21.05-4.14.03-8.29.04-12.43.02-1.52,0-3.03,0-4.55.03q-13.76.15-19.72-4.05c-4-4.16-4.88-7.56-4.89-13.27,0-.66-.01-1.32-.02-2-.02-2.21-.01-4.41,0-6.62,0-1.59-.02-3.17-.03-4.76-.02-4.3-.03-8.6-.02-12.91,0-3.59,0-7.19-.02-10.78-.02-8.48-.02-16.96-.02-25.44,0-8.74-.02-17.48-.05-26.22-.03-7.51-.04-15.02-.04-22.53,0-4.48,0-8.97-.03-13.45-.02-4.22-.02-8.43,0-12.65,0-1.55,0-3.09-.02-4.64q-.11-13.11,2.8-17.59c4.82-4.61,8.92-6.09,15.55-6.09ZM32.67,300.09v116h117v-116H32.67Z"
      />
      <path
        fill="currentColor"
        d="M407.23,283.77c16.21,15.15,26.78,35.42,30.44,57.31.11.65.22,1.31.34,1.98,3.66,26.34-2.95,53.13-18.21,74.83-16.81,21.8-38.67,36.6-66.12,41.19-.65.11-1.31.22-1.98.34-26.34,3.66-53.13-2.95-74.83-18.21-21.8-16.81-36.6-38.67-41.19-66.12-.11-.65-.22-1.31-.34-1.98-3.66-26.34,2.95-53.13,18.21-74.83,16.81-21.8,38.67-36.6,66.12-41.19.65-.11,1.31-.22,1.98-.34,31.92-4.43,61.58,6.27,85.58,27.02ZM292.67,305.09c-.65.48-1.29.96-1.96,1.46-13.53,10.59-20.64,27.98-23.04,44.54-1.35,19.26,4.07,36.03,16,51,.48.65.96,1.29,1.46,1.96,10.68,13.65,27.87,20.51,44.54,23.04,17.91,1.9,36.1-3.79,50.19-14.86,14.06-11.62,21.95-26.86,25.5-44.58,1.77-20.22-3.04-37.69-15.69-53.56-.48-.65-.96-1.29-1.46-1.96-10.58-13.51-27.98-20.67-44.54-23.04-19.37-1.25-35.9,3.97-51,16Z"
      />
    </svg>
  )

  const ChatRiMessage3Line = (props: { className: string }) => (
    <svg
      id="chat"
      className={props.className}
      data-name="Layer 1"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 438.99 460.41"
    >
      <path
        fill="currentColor"
        d="M159.25.11c.74,0,1.47-.01,2.23-.02q30.83-.23,44.78,3.22c.82.2,1.65.4,2.5.6,24.52,6.07,46.83,16.44,66.5,32.4.56.45,1.12.9,1.69,1.37,17.78,14.48,31.5,31.43,42.31,51.63.51.89,1.02,1.78,1.54,2.7,17.7,32.5,21.61,74.26,13.43,110.11q-.24,1.09-.49,2.2c-.43,1.8-.96,3.58-1.49,5.35.01,5.9,3.1,10.11,6.07,15.08q.94,1.63,1.9,3.29c1.66,2.86,3.33,5.71,5.02,8.55,2.31,3.91,4.58,7.84,6.87,11.76,1.2,2.06,2.41,4.12,3.62,6.17,5.26,8.94,8.83,15.14,7.53,25.79-2.31,4.97-5.28,7.33-10,10q-3.42.46-7.21.4c-.7,0-1.39,0-2.11-.01-1.5-.01-3-.03-4.5-.06-2.39-.04-4.77-.05-7.16-.05-6.78-.01-13.56-.06-20.34-.16-4.16-.06-8.31-.08-12.47-.06-1.57,0-3.15-.03-4.72-.06-8.15-.2-14.17-.02-20.8,5.4-1.58,1.52-3.15,3.06-4.7,4.61-2.48,1.83-5.05,3.46-7.69,5.06-.67.41-1.35.83-2.04,1.25-23.72,14.32-51.38,24.71-79.38,24.89q-1.14.01-2.3.02-31.77.23-45.59-3.22-1.26-.31-2.54-.62c-12.01-3-23.36-6.91-34.46-12.38-.7-.34-1.39-.68-2.11-1.03-13.54-6.67-25.62-14.58-36.67-24.91-1.98-1.84-4.01-3.54-6.09-5.25-22.68-19.89-37.25-49.21-45.12-77.81q-.36-1.29-.72-2.61c-6.37-24.3-5.96-54.23.72-78.39.26-.95.52-1.89.78-2.86,5.93-21.01,15.42-41.12,29.22-58.14.5-.61.99-1.23,1.5-1.86,15.28-18.65,33.09-33.1,54.5-44.14.62-.32,1.24-.64,1.87-.97C113.37,7.05,136.46.25,159.25.11ZM138.27,36.31q-1.04.26-2.09.52c-22.83,5.8-42.59,16.53-59.91,32.48-.94.86-1.89,1.72-2.86,2.61-23.37,22.31-38.29,54.51-39.41,86.85-.8,38.47,11.8,71.44,38.28,99.54.6.66,1.2,1.33,1.82,2.01,19.33,20.58,46.84,32.12,74.18,36.99,1.05.19,2.1.38,3.18.58,36.8,4.02,72.55-5.18,101.87-27.95q5.16-4.08,9.77-8.73c2.69-2.35,3.97-2.42,7.5-2.45,1.06-.02,2.12-.04,3.21-.06q1.71,0,3.45,0c1.17-.02,2.34-.03,3.55-.05,3.74-.05,7.48-.07,11.22-.09,2.54-.03,5.07-.06,7.61-.09,6.21-.07,12.43-.13,18.64-.16-1.26-4.14-2.81-7.69-5.01-11.41q-.89-1.51-1.8-3.06c-.62-1.04-1.24-2.08-1.88-3.15-1.82-3.09-3.64-6.17-5.45-9.27-1.27-2.11-2.59-4.18-3.97-6.21q-4.88-7.45-4.93-11.44c.59-2.52,1.4-4.76,2.41-7.14.62-1.75,1.24-3.5,1.84-5.26.31-.86.62-1.72.94-2.6,9.81-28.55,4.17-62.87-8.52-89.59-6.74-13.52-15.28-24.87-25.64-35.86-.6-.66-1.2-1.33-1.82-2.01-16.89-17.99-40.52-29.23-64.18-34.99-1.21-.3-2.42-.6-3.67-.91-18.78-4.19-39.68-3.78-58.33.91Z"
      />
    </svg>
  )

  const WorkflowRiExchange2Line = (props: { className: string }) => (
    <svg
      id="chat"
      className={props.className}
      data-name="Layer 1"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 438.99 460.41"
    >
      <path
        fill="currentColor"
        d="M213.71,56.66c.74,0,1.48,0,2.25,0,2.49,0,4.98-.01,7.48-.01,1.78,0,3.57,0,5.35-.02,4.85-.01,9.7-.02,14.55-.02,3.03,0,6.06,0,9.09-.01,9.48-.01,18.96-.02,28.44-.03,10.95,0,21.89-.02,32.84-.05,8.46-.02,16.92-.03,25.37-.03,5.05,0,10.11,0,15.16-.02,4.75-.02,9.51-.02,14.26,0,1.74,0,3.49,0,5.23-.01,2.38-.01,4.76,0,7.15,0,.69,0,1.38-.02,2.09-.02,5.22.05,9.31,1.33,13.17,4.93,2.94,3.85,4.48,5.9,4.49,10.71,0,.9,0,1.79.01,2.71,0,.99,0,1.98,0,3,0,1.05,0,2.09.01,3.17.01,3.53.01,7.06.02,10.59,0,2.52.01,5.05.02,7.57.02,7.59.03,15.17.04,22.76,0,3.57,0,7.14.01,10.71.02,11.87.03,23.74.04,35.61,0,3.08,0,6.16,0,9.24,0,.77,0,1.53,0,2.32,0,12.41.03,24.82.07,37.22.03,12.74.05,25.47.05,38.21,0,7.15.01,14.3.04,21.46.02,6.73.03,13.45.02,20.18,0,2.47,0,4.94.02,7.41.02,3.37.01,6.74,0,10.11.01.98.02,1.96.03,2.97-.05,5.65-.58,9.12-4.52,13.49-4.53,3.86-8.23,4.58-14.01,4.51-.79,0-1.58.01-2.39.02-2.63.02-5.27,0-7.9,0-1.89,0-3.79.01-5.68.02-5.13.02-10.27.01-15.4,0-5.37-.01-10.75,0-16.12,0-9.03,0-18.05,0-27.08-.02-10.43-.02-20.87-.01-31.3,0-8.96.02-17.92.02-26.88.01-5.35,0-10.7,0-16.05,0-5.03.01-10.06,0-15.09-.02-1.85,0-3.69,0-5.54,0-2.52.01-5.04,0-7.56-.02q-1.09.01-2.21.03c-5.06-.08-7.89-1.39-11.8-4.53-4.08-4.53-5.32-7.79-5.21-13.95.6-5.69,4.07-9.42,8.21-13.05,3.48-1.16,6.18-1.12,9.85-1.12q1.05,0,2.12,0c2.36,0,4.71,0,7.07,0,1.71,0,3.42,0,5.14,0,4.59,0,9.19,0,13.78.01,4.31,0,8.61,0,12.92,0,12.6,0,25.21.02,37.81.03q42.23.03,85.31.06V89.8q-53.28.2-106.57.45-10.31.02-15.14.03c-3.37,0-6.74.02-10.11.05-4.3.03-8.6.04-12.9.04-1.58,0-3.15.01-4.73.03q-15.42.18-21.56-5.6c-3.19-3.81-4.13-8.08-4-13,1.03-5.84,3.73-9.21,8.28-12.87,3.8-2.49,7.59-2.27,11.95-2.27Z"
      />
      <path
        fill="currentColor"
        d="M32.11,240.65c.95,0,1.9-.01,2.88-.02,1.04,0,2.09,0,3.16,0,1.1,0,2.2-.01,3.33-.02,3.65-.02,7.29-.03,10.94-.04,1.24,0,2.49,0,3.77-.01,5.91-.02,11.82-.03,17.73-.04,6.81,0,13.62-.04,20.43-.08,5.91-.03,11.82-.05,17.72-.05,2.51,0,5.02-.02,7.52-.04,3.51-.02,7.03-.02,10.54-.02,1.03-.01,2.07-.03,3.13-.04,6.17.04,11.11.81,16.2,4.51,3.54,4.45,5.12,7.99,5.15,13.63q.01,1.43.02,2.88c0,1.04,0,2.09,0,3.16,0,1.1.01,2.2.02,3.33.02,3.65.03,7.29.04,10.94,0,1.24,0,2.49.01,3.77.02,5.91.03,11.82.04,17.73,0,6.81.04,13.62.08,20.43.03,5.91.05,11.82.05,17.72,0,2.51.02,5.02.04,7.52.02,3.51.02,7.03.02,10.54q.02,1.55.04,3.13c-.04,6.17-.81,11.11-4.51,16.2-4.45,3.54-7.99,5.12-13.63,5.15-.95,0-1.9.01-2.88.02q-1.56,0-3.16,0c-1.1,0-2.2.01-3.33.02-3.65.02-7.29.03-10.94.04-1.24,0-2.49,0-3.77.01-5.91.02-11.82.03-17.73.04-6.81,0-13.62.04-20.43.08-5.91.03-11.82.05-17.72.05-2.51,0-5.02.02-7.52.04-3.51.02-7.03.02-10.54.02-1.03.01-2.07.03-3.13.04-6.17-.04-11.11-.81-16.2-4.51-3.54-4.45-5.12-7.99-5.15-13.63,0-.95-.01-1.9-.02-2.88,0-1.04,0-2.09,0-3.16,0-1.1-.01-2.2-.02-3.33-.02-3.65-.03-7.29-.04-10.94,0-1.24,0-2.49-.01-3.77-.02-5.91-.03-11.82-.04-17.73,0-6.81-.04-13.62-.08-20.43-.03-5.91-.05-11.82-.05-17.72,0-2.51-.02-5.02-.04-7.52-.02-3.51-.02-7.03-.02-10.54-.01-1.03-.03-2.07-.04-3.13.04-6.17.81-11.11,4.51-16.2,4.45-3.54,7.99-5.12,13.63-5.15ZM47.48,273.8v74h74v-74H47.48Z"
      />
      <path
        fill="currentColor"
        d="M85.48.05c.97-.02,1.94-.03,2.94-.05,6.64,1.73,10.06,6.46,13.5,12.16,1.2,2.12,2.39,4.25,3.56,6.39.99,1.75,1.97,3.5,2.96,5.25,1.02,1.81,2.03,3.62,3.04,5.43,3.11,5.56,6.31,11.06,9.5,16.57,1.25,2.17,2.5,4.33,3.75,6.5.62,1.07,1.24,2.15,1.88,3.25l5.62,9.75c.62,1.07,1.24,2.15,1.88,3.25,1.25,2.16,2.5,4.33,3.74,6.49,3.8,6.59,7.61,13.18,11.41,19.77,1.26,2.19,2.52,4.37,3.77,6.56,2.96,5.16,5.95,10.28,9.06,15.35q.84,1.4,1.7,2.83c1.04,1.73,2.1,3.44,3.18,5.15,3.57,5.98,4.49,11.18,3.5,18.11-2.21,4.58-4.5,6.76-9,9q-2.97.38-6.33.39-1.92.01-3.87.03c-1.41,0-2.82,0-4.22-.01-1.49,0-2.98.01-4.47.02-4.04.02-8.07.02-12.11.01-3.37,0-6.74,0-10.12,0-7.96.01-15.91.01-23.87,0-8.2-.01-16.41,0-24.61.03-7.05.02-14.1.03-21.14.02-4.21,0-8.42,0-12.62.02-3.96.02-7.91.01-11.87,0-1.45,0-2.9,0-4.35,0-1.98.01-3.97,0-5.95-.02-1.11,0-2.22,0-3.36,0-4.69-.76-7.82-3.09-10.97-6.56-2.12-5.52-2.15-11.25-.03-16.79,1.57-3.02,3.26-5.93,5.03-8.83.63-1.08,1.26-2.16,1.92-3.28,1.32-2.25,2.65-4.5,3.99-6.74,1.85-3.1,3.68-6.22,5.49-9.35,2.3-3.96,4.6-7.91,6.92-11.86,3.69-6.31,7.35-12.63,11-18.96q.93-1.62,1.88-3.27c1.89-3.29,3.79-6.57,5.68-9.86,1.26-2.19,2.53-4.39,3.79-6.58q.94-1.62,1.89-3.28c1.86-3.23,3.73-6.46,5.61-9.69,2.54-4.39,5.04-8.79,7.52-13.2,1.23-2.16,2.46-4.33,3.69-6.49.55-.99,1.1-1.99,1.67-3.01C71.82,7.24,76.21-.1,85.48.05ZM84.48,45.8q-.53.95-1.06,1.91c-6.52,11.73-13.09,23.44-19.87,35.02-.56.96-1.13,1.93-1.71,2.92-1.17,1.99-2.33,3.98-3.5,5.97-3.08,5.26-6.15,10.52-9.21,15.79-1.01,1.73-2.02,3.46-3.03,5.18-.6,1.04-1.21,2.09-1.83,3.16-.54.93-1.08,1.85-1.63,2.81q-1.31,2.11-1.15,4.23h88c-1.43-4.28-2.51-7.19-4.73-10.92-.55-.93-1.1-1.86-1.66-2.82q-.89-1.49-1.8-3.01c-1.27-2.16-2.54-4.31-3.82-6.47q-.99-1.67-2-3.38c-3.24-5.51-6.43-11.05-9.62-16.59-.62-1.07-1.24-2.15-1.87-3.25-5.86-10.17-11.69-20.36-17.5-30.56h-2Z"
      />
    </svg>
  )

  const options = [
    {
      value: 'chat',
      text: t('app.types.chatbot'),
      icon: <ChatRiMessage3Line className="mr-1 h-[14px] w-[14px]" />,
    },
    {
      value: 'workflow',
      text: t('app.types.workflow'),
      icon: <WorkflowRiExchange2Line className="mr-1 h-[14px] w-[14px]" />,
    },
    {
      value: 'all',
      text: t('app.types.all'),
      icon: <AllRiApps2Line className="mr-1 h-[14px] w-[14px]" />,
    },
    // { value: 'agent-chat', text: t('app.types.agent'), icon: <RiRobot3Line className='w-[14px] h-[14px] mr-1' /> },
  ]

  useEffect(() => {
    document.title = `${t('common.menus.apps')} - Dify`
    if (localStorage.getItem(NEED_REFRESH_APP_LIST_KEY) === '1') {
      localStorage.removeItem(NEED_REFRESH_APP_LIST_KEY)
      refetch()
    }
  }, [refetch])

  useEffect(() => {
    if (isCurrentWorkspaceDatasetOperator) return router.replace('/datasets')
  }, [router, isCurrentWorkspaceDatasetOperator])

  useEffect(() => {
    if (isCurrentWorkspaceDatasetOperator)
      return
    const hasMore = hasNextPage ?? true
    let observer: IntersectionObserver | undefined

    if (error) {
      if (observer) observer.disconnect()
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

  const { run: handleSearch } = useDebounceFn(
    () => {
      setSearchKeywords(keywords)
    },
    { wait: 500 },
  )
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }

  const { run: handleTagsUpdate } = useDebounceFn(
    () => {
      setTagIDs(tagFilterValue)
    },
    { wait: 500 },
  )
  const handleTagsChange = (value: string[]) => {
    setTagFilterValue(value)
    handleTagsUpdate()
  }

  const handleCreatedByMeChange = useCallback(() => {
    const newValue = !isCreatedByMe
    setIsCreatedByMe(newValue)
    setQuery(prev => ({ ...prev, isCreatedByMe: newValue }))
  }, [isCreatedByMe, setQuery])

  const handleSortChange = useCallback((newSortBy: SortBy, newSortOrder: SortOrder) => {
    setQuery(prev => ({ ...prev, sortBy: newSortBy, sortOrder: newSortOrder }))
  }, [setQuery])

  const pages = data?.pages ?? []
  const hasAnyApp = (pages[0]?.total ?? 0) > 0
  // Show skeleton during initial load or when refetching with no previous data
  const showSkeleton = isLoading || (isFetching && pages.length === 0)

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
            <SortDropdown
              sortBy={sortBy}
              sortOrder={sortOrder}
              onChange={handleSortChange}
            />
            <CheckboxWithLabel
              className='mr-2 min-w-[140px]'
              label={t('app.showMyCreatedAppsOnly')}
              isChecked={isCreatedByMe}
              onChange={handleCreatedByMeChange}
              disabled={!isCurrentWorkspaceManager}
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
        <div className={cn(
          'relative grid grow grid-cols-1 content-start gap-4 px-12 pt-2 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5 2k:grid-cols-6',
          !hasAnyApp && 'overflow-hidden',
        )}
        >
          {(isCurrentWorkspaceEditor || isLoadingCurrentWorkspace) && (
            <NewAppCard
              ref={newAppCardRef}
              isLoading={isLoadingCurrentWorkspace}
              onSuccess={refetch}
              selectedAppType={activeTab}
              className={cn(!hasAnyApp && 'z-10')}
            />
          )}
          {(() => {
            if (showSkeleton)
              return <AppCardSkeleton count={6} />

            if (hasAnyApp) {
              return pages.flatMap(({ data: apps }) => apps).map(app => (
                <AppCard key={app.id} app={app} onRefresh={refetch} />
              ))
            }

            // No apps - show empty state
            return <Empty />
          })()}
        </div>

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
