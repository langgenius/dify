'use client'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownDoubleLine, RiCloseLine, RiLoader2Line } from '@remixicon/react'
import { useWorkflowRun } from '../../hooks'
import { useStore, useWorkflowStore } from '../../store'
import { WorkflowVersionFilterOptions } from '../../types'
import VersionHistoryItem from './version-history-item'
import Filter from './filter'
import type { VersionHistory } from '@/types/workflow'
import { useStore as useAppStore } from '@/app/components/app/store'
import Loading from '@/app/components/base/loading'
import { useWorkflowVersionHistory } from '@/service/use-workflow'
import Divider from '@/app/components/base/divider'

const HISTORY_PER_PAGE = 5
const INITIAL_PAGE = 1

const VersionHistoryPanel = () => {
  const [filterValue, setFilterValue] = useState(WorkflowVersionFilterOptions.all)
  const [isOnlyShowNamedVersions, setIsOnlyShowNamedVersions] = useState(false)
  const workflowStore = useWorkflowStore()
  const { handleRestoreFromPublishedWorkflow, handleLoadBackupDraft } = useWorkflowRun()
  const appDetail = useAppStore.getState().appDetail
  const setShowWorkflowVersionHistoryPanel = useStore(s => s.setShowWorkflowVersionHistoryPanel)
  const currentVersion = useStore(s => s.currentVersion)
  const setCurrentVersion = useStore(s => s.setCurrentVersion)
  const { t } = useTranslation()

  const {
    data: versionHistory,
    fetchNextPage,
    hasNextPage,
    isFetching,
  } = useWorkflowVersionHistory(appDetail!.id, INITIAL_PAGE, HISTORY_PER_PAGE)

  const handleVersionClick = (item: VersionHistory) => {
    if (item.version !== currentVersion?.version) {
      setCurrentVersion(item)
      handleRestoreFromPublishedWorkflow(item)
    }
  }

  const handleNextPage = () => {
    if (hasNextPage)
      fetchNextPage()
  }

  const handleClose = () => {
    handleLoadBackupDraft()
    workflowStore.setState({ isRestoring: false })
    setShowWorkflowVersionHistoryPanel(false)
  }

  const handleClickFilterItem = useCallback((value: WorkflowVersionFilterOptions) => {
    setFilterValue(value)
  }, [])

  const handleSwitch = useCallback((value: boolean) => {
    setIsOnlyShowNamedVersions(value)
  }, [])

  return (
    <div className='flex flex-col w-[268px] bg-components-panel-bg rounded-l-2xl border-y-[0.5px] border-l-[0.5px] border-components-panel-border shadow-xl shadow-shadow-shadow-5'>
      <div className='flex items-center gap-x-2 px-4 pt-3'>
        <div className='flex-1 py-1 text-text-primary system-xl-semibold'>{t('workflow.versionHistory.title')}</div>
        <Filter
          filterValue={filterValue}
          isOnlyShowNamedVersions={isOnlyShowNamedVersions}
          onClickFilterItem={handleClickFilterItem}
          handleSwitch={handleSwitch}
        />
        <Divider type='vertical' className='h-3.5 mx-1' />
        <div
          className='flex items-center justify-center w-6 h-6 p-0.5 cursor-pointer'
          onClick={handleClose}
        >
          <RiCloseLine className='w-4 h-4 text-text-tertiary' />
        </div>
      </div>
      <div className="flex-1 relative px-3 py-2 overflow-y-auto">
        {(isFetching && !versionHistory?.pages?.length)
          ? (
            <div className='flex items-center justify-center h-10'>
              {/* // TODO skeleton */}
              <Loading/>
            </div>
          )
          : (
            <>
              {versionHistory?.pages?.map((page, pageNumber) => (
                page.items?.map((item, idx) => {
                  const isLast = pageNumber === versionHistory.pages.length - 1 && idx === page.items.length - 1
                  return <VersionHistoryItem
                    key={item.id}
                    item={item}
                    currentVersion={currentVersion}
                    onClick={handleVersionClick}
                    curIdx={idx}
                    page={pageNumber + 1}
                    isLast={isLast}
                  />
                })
              ))}
              {hasNextPage && (
                <div className='flex absolute bottom-2 left-2 p-2'>
                  <div
                    className='flex items-center gap-x-1 cursor-pointer'
                    onClick={handleNextPage}
                  >
                    <div className='flex item-center justify-center p-0.5'>
                      {
                        isFetching
                          ? <RiLoader2Line className='w-3.5 h-3.5 text-text-accent animate-spin' />
                          : <RiArrowDownDoubleLine className='w-3.5 h-3.5 text-text-accent' />}
                    </div>
                    <div className='py-[1px] text-text-accent system-xs-medium-uppercase'>
                      {t('workflow.common.loadMore')}
                    </div>
                  </div>
                </div>
              )}
              {/* // TODO empty state */}
              {/* {!isFetchingNextPage && !versionHistory?.items?.length && (
                <div className='flex items-center justify-center h-10 text-gray-500'>
                  {t('workflow.common.noHistory')}
                </div>
              )} */}
            </>
          )}
      </div>
    </div>
  )
}

export default React.memo(VersionHistoryPanel)
