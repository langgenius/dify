'use client'
import React, { useState } from 'react'
import useSWR from 'swr'
import { useWorkflowRun } from '../hooks'
import VersionHistoryItem from './version-history-item'
import type { VersionHistory } from '@/types/workflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { fetchPublishedAllWorkflow } from '@/service/workflow'
import Loading from '@/app/components/base/loading'

const VersionHistoryModal = () => {
  const [selectedVersion, setSelectedVersion] = useState('draft')
  const { handleRestoreFromPublishedWorkflow } = useWorkflowRun()
  const appDetail = useAppStore.getState().appDetail
  const {
    data: versionHistory,
    isLoading,
  } = useSWR(`/apps/${appDetail?.id}/workflows/publish/all`, fetchPublishedAllWorkflow)

  const handleVersionClick = (item: VersionHistory) => {
    if (item.version !== selectedVersion) {
      setSelectedVersion(item.version)
      handleRestoreFromPublishedWorkflow(item)
    }
  }

  return (
    <div className='w-[336px] bg-white rounded-2xl border-[0.5px] border-gray-200 shadow-xl p-2'>
      {isLoading && (
        <div className='flex items-center justify-center h-10'>
          <Loading/>
        </div>
      )}
      {versionHistory?.map(item => (
        <VersionHistoryItem
          key={item.version}
          item={item}
          selectedVersion={selectedVersion}
          onClick={handleVersionClick}
        />
      ))}
    </div>
  )
}
export default React.memo(VersionHistoryModal)
