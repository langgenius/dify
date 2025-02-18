'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { useWorkflowRun } from '../hooks'
import VersionHistoryItem from './version-history-item'
import type { VersionHistory } from '@/types/workflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { fetchPublishedAllWorkflow } from '@/service/workflow'
import Loading from '@/app/components/base/loading'
import Button from '@/app/components/base/button'

const limit = 10

const VersionHistoryModal = () => {
  const [selectedVersion, setSelectedVersion] = useState('draft')
  const [page, setPage] = useState(1)
  const { handleRestoreFromPublishedWorkflow } = useWorkflowRun()
  const appDetail = useAppStore.getState().appDetail
  const { t } = useTranslation()
  const {
    data: versionHistory,
    isLoading,
  } = useSWR(
    `/apps/${appDetail?.id}/workflows?page=${page}&limit=${limit}`,
    fetchPublishedAllWorkflow,
  )

  const handleVersionClick = (item: VersionHistory) => {
    if (item.version !== selectedVersion) {
      setSelectedVersion(item.version)
      handleRestoreFromPublishedWorkflow(item)
    }
  }

  const handleNextPage = () => {
    if (versionHistory?.has_more)
      setPage(page => page + 1)
  }

  return (
    <div className='w-[336px] rounded-2xl border-[0.5px] border-gray-200 bg-white p-2 shadow-xl'>
      <div className="max-h-[400px] overflow-auto">
        {(isLoading && page) === 1
          ? (
            <div className='flex h-10 items-center justify-center'>
              <Loading/>
            </div>
          )
          : (
            <>
              {versionHistory?.items?.map((item, idx) => (
                <VersionHistoryItem
                  key={item.version}
                  item={item}
                  selectedVersion={selectedVersion}
                  onClick={handleVersionClick}
                  curIdx={idx}
                  page={page}
                />
              ))}
              {isLoading && page > 1 && (
                <div className='flex h-10 items-center justify-center'>
                  <Loading/>
                </div>
              )}
              {!isLoading && versionHistory?.has_more && (
                <div className='mt-2 flex h-10 items-center justify-center'>
                  <Button
                    className='text-sm'
                    onClick={handleNextPage}
                  >
                    {t('workflow.common.loadMore')}
                  </Button>
                </div>
              )}
              {!isLoading && !versionHistory?.items?.length && (
                <div className='flex h-10 items-center justify-center text-gray-500'>
                  {t('workflow.common.noHistory')}
                </div>
              )}
            </>
          )}
      </div>
    </div>
  )
}

export default React.memo(VersionHistoryModal)
