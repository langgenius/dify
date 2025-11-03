'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import dayjs from 'dayjs'
import { RiCalendarLine, RiDeleteBin2Line } from '@remixicon/react'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import type { QueryParam } from './index'
import Chip from '@/app/components/base/chip'
import Input from '@/app/components/base/input'
import Sort from '@/app/components/base/sort'
import Button from '@/app/components/base/button'
import Confirm from '@/app/components/base/confirm'
import { useToastContext } from '@/app/components/base/toast'
import { clearChatConversations, clearCompletionConversations, fetchAnnotationsCount } from '@/service/log'
dayjs.extend(quarterOfYear)

const today = dayjs()

export const TIME_PERIOD_MAPPING: { [key: string]: { value: number; name: string } } = {
  1: { value: 0, name: 'today' },
  2: { value: 7, name: 'last7days' },
  3: { value: 28, name: 'last4weeks' },
  4: { value: today.diff(today.subtract(3, 'month'), 'day'), name: 'last3months' },
  5: { value: today.diff(today.subtract(12, 'month'), 'day'), name: 'last12months' },
  6: { value: today.diff(today.startOf('month'), 'day'), name: 'monthToDate' },
  7: { value: today.diff(today.startOf('quarter'), 'day'), name: 'quarterToDate' },
  8: { value: today.diff(today.startOf('year'), 'day'), name: 'yearToDate' },
  9: { value: -1, name: 'allTime' },
}

type IFilterProps = {
  isChatMode?: boolean
  appId: string
  queryParams: QueryParam
  setQueryParams: (v: QueryParam) => void
  onRefresh?: () => void
  selectedItems?: string[]
  onClearSelected?: (conversationIds?: string[]) => void
  onOptimisticDelete?: (conversationIds?: string[]) => void
}

const Filter: FC<IFilterProps> = ({ isChatMode, appId, queryParams, setQueryParams, onRefresh, selectedItems, onClearSelected, onOptimisticDelete }: IFilterProps) => {
  const { data } = useSWR({ url: `/apps/${appId}/annotations/count` }, fetchAnnotationsCount)
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [showConfirm, setShowConfirm] = useState<'all' | 'selected' | false>(false)
  const [isClearing, setIsClearing] = useState(false)

  const handleClearLogs = async (conversationIds?: string[]) => {
    setIsClearing(true)

    // Optimistically remove items from UI immediately
    onOptimisticDelete?.(conversationIds)
    onClearSelected?.(conversationIds)

    try {
      if (isChatMode)
        await clearChatConversations({ appId, conversationIds })
      else
        await clearCompletionConversations({ appId, conversationIds })

      const message = conversationIds
        ? t('appLog.filter.clearSelectedSuccess')
        : t('appLog.filter.clearSuccess')
      notify({ type: 'success', message })

      // Notify other tabs/windows to refresh conversation list (for cross-tab sync)
      localStorage.setItem('conversations_cleared', Date.now().toString())

      // Dispatch custom event for same-page refresh (storage event doesn't fire in same tab)
      window.dispatchEvent(new CustomEvent('conversationsCleared', {
        detail: { appId, conversationIds },
      }))

      // Revalidate to sync with backend after async task completes
      await onRefresh?.()
    }
    catch {
      notify({ type: 'error', message: t('appLog.filter.clearFailed') })
      // Revalidate on error to restore correct state
      await onRefresh?.()
    }
    finally {
      setIsClearing(false)
      setShowConfirm(false)
    }
  }
  if (!data)
    return null
  return (
    <div className='mb-2 flex flex-row flex-wrap items-center justify-between gap-2'>
      <div className='flex flex-row flex-wrap items-center gap-2'>
        <Chip
          className='min-w-[150px]'
          panelClassName='w-[270px]'
          leftIcon={<RiCalendarLine className='h-4 w-4 text-text-secondary' />}
          value={queryParams.period}
          onSelect={(item) => {
            setQueryParams({ ...queryParams, period: item.value })
          }}
          onClear={() => setQueryParams({ ...queryParams, period: '9' })}
          items={Object.entries(TIME_PERIOD_MAPPING).map(([k, v]) => ({ value: k, name: t(`appLog.filter.period.${v.name}`) }))}
        />
        <Chip
          className='min-w-[150px]'
          panelClassName='w-[270px]'
          showLeftIcon={false}
          value={queryParams.annotation_status || 'all'}
          onSelect={(item) => {
            setQueryParams({ ...queryParams, annotation_status: item.value as string })
          }}
          onClear={() => setQueryParams({ ...queryParams, annotation_status: 'all' })}
          items={[
            { value: 'all', name: t('appLog.filter.annotation.all') },
            { value: 'annotated', name: t('appLog.filter.annotation.annotated', { count: data?.count }) },
            { value: 'not_annotated', name: t('appLog.filter.annotation.not_annotated') },
          ]}
        />
        <Input
          wrapperClassName='w-[200px]'
          showLeftIcon
          showClearIcon
          value={queryParams.keyword}
          placeholder={t('common.operation.search')!}
          onChange={(e) => {
            setQueryParams({ ...queryParams, keyword: e.target.value })
          }}
          onClear={() => setQueryParams({ ...queryParams, keyword: '' })}
        />
        {isChatMode && (
          <>
            <div className='h-3.5 w-px bg-divider-regular'></div>
            <Sort
              order={queryParams.sort_by?.startsWith('-') ? '-' : ''}
              value={queryParams.sort_by?.replace('-', '') || 'created_at'}
              items={[
                { value: 'created_at', name: t('appLog.table.header.time') },
                { value: 'updated_at', name: t('appLog.table.header.updatedTime') },
              ]}
              onSelect={(value) => {
                setQueryParams({ ...queryParams, sort_by: value as string })
              }}
            />
          </>
        )}
      </div>

      {/* Clear Logs Buttons */}
      <div className='flex items-center gap-2'>
        {selectedItems && selectedItems.length > 0 && (
          <Button
            variant='primary'
            size='small'
            onClick={() => setShowConfirm('selected')}
            disabled={isClearing}
            className='flex items-center gap-1'
          >
            <RiDeleteBin2Line className='h-4 w-4' />
            {t('appLog.filter.clearSelected', { count: selectedItems.length })}
          </Button>
        )}
        <Button
          variant='secondary'
          size='small'
          onClick={() => setShowConfirm('all')}
          disabled={isClearing}
          className='flex items-center gap-1'
        >
          <RiDeleteBin2Line className='h-4 w-4' />
          {t('appLog.filter.clearAll')}
        </Button>
      </div>

      {/* Confirmation Dialog */}
      {showConfirm && (
        <Confirm
          title={showConfirm === 'selected'
            ? t('appLog.filter.clearSelectedConfirm.title')
            : t('appLog.filter.clearConfirm.title')
          }
          content={showConfirm === 'selected'
            ? t('appLog.filter.clearSelectedConfirm.content', { count: selectedItems?.length || 0 })
            : t('appLog.filter.clearConfirm.content')
          }
          isShow={!!showConfirm}
          onConfirm={() => handleClearLogs(showConfirm === 'selected' ? selectedItems : undefined)}
          onCancel={() => setShowConfirm(false)}
          confirmText={t('common.operation.confirm')}
          cancelText={t('common.operation.cancel')}
          confirmLoading={isClearing}
        />
      )}
    </div>
  )
}

export default Filter
