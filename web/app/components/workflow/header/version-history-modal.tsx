'use client'
import React, { useState, useCallback } from 'react'
import useSWR from 'swr'
import { useWorkflowRun } from '../hooks'
import VersionHistoryItem from './version-history-item'
import type { VersionHistory } from '@/types/workflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { fetchPublishedAllWorkflow } from '@/service/workflow'
import Loading from '@/app/components/base/loading'
import InfiniteScroll from '@/app/components/base/infinite-scroll'

const limit = 10

const VersionHistoryModal = () => {
  const [selectedVersion, setSelectedVersion] = useState('draft')
  const [page, setPage] = useState(1)
  const { handleRestoreFromPublishedWorkflow } = useWorkflowRun()
  const appDetail = useAppStore.getState().appDetail
  
  const {
    data,
    isLoading,
    mutate,
  } = useSWR(
    `/apps/${appDetail?.id}/workflows/publish/all?page=${page}&limit=${limit}`,
    fetchPublishedAllWorkflow
  )

  const handleVersionClick = (item: VersionHistory) => {
    if (item.version !== selectedVersion) {
      setSelectedVersion(item.version)
      handleRestoreFromPublishedWorkflow(item)
    }
  }

  const loadMore = useCallback(() => {
    if (data?.has_more) {
      setPage(prev => prev + 1)
    }
  }, [data?.has_more])

  return (
    <div className='w-[240px] bg-white rounded-2xl border-[0.5px] border-gray-200 shadow-xl p-2'>
      <InfiniteScroll
        className="max-h-[400px] overflow-auto"
        hasMore={!!data?.has_more}
        loadMore={loadMore}
      >
        {isLoading && page === 1 ? (
          <div className='flex items-center justify-center h-10'>
            <Loading/>
          </div>
        ) : (
          <>
            {data?.items.map(item => (
              <VersionHistoryItem
                key={item.version}
                item={item}
                selectedVersion={selectedVersion}
                onClick={handleVersionClick}
              />
            ))}
            {isLoading && page > 1 && (
              <div className='flex items-center justify-center h-10'>
                <Loading/>
              </div>
            )}
          </>
        )}
      </InfiniteScroll>
    </div>
  )
}

export default React.memo(VersionHistoryModal)
