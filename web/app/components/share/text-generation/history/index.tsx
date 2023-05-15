'use client'
import React, { useState } from 'react'
import useSWR from 'swr'
import {
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline'
import { fetchHistories } from '@/models/history'
import type { History as HistoryItem } from '@/models/history'
import Loading from '@/app/components/base/loading'
import { mockAPI } from '@/test/test_util'

mockAPI()

export type IHistoryProps = {
  dictionary: any
}

const HistoryCard = (
  { history }: { history: HistoryItem },
) => {
  return (
    <div className='p-4 h-32 bg-gray-50 border-gray-200 rounded-lg relative flex flex-col justify-between items-center cursor-pointer'>
      <div className='text-gray-700 text-sm'>
        {history.source}
      </div>
      <div className="absolute inset-0 flex items-center m-4" aria-hidden="true">
        <div className="w-full border-t border-gray-100" />
      </div>
      <div className='text-gray-700 text-sm'>
        {history.target}
      </div>
    </div>
  )
}

const History = ({
  dictionary,
}: IHistoryProps) => {
  const { data, error } = useSWR('http://localhost:3000/api/histories', fetchHistories)
  const [showHistory, setShowHistory] = useState(false)

  const DivideLine = () => {
    return <div className="mt-6 relative">
      {/* divider line */}
      <div className="absolute inset-0 flex items-center" aria-hidden="true">
        <div className="w-full border-t border-gray-300" />
      </div>
      <div className="relative flex justify-center flex-col items-center">
        {!showHistory ? <ChevronUpIcon className="h-3 w-3 text-gray-500" aria-hidden="true" /> : <div className='h-3 w-3' />}
        <span className="px-2 bg-white text-sm font-medium text-gray-600 cursor-pointer">{dictionary.app.textGeneration.history}</span>
        {!showHistory ? <div className='h-3 w-3' /> : <ChevronDownIcon className="h-3 w-3 text-gray-500" aria-hidden="true" />}
      </div>
    </div>
  }

  if (error)
    return <div>failed to load</div>
  if (!data)
    return <Loading />
  return showHistory
    ? <div className='w-1/2 block fixed bottom-0 right-0 px-10 py-4' onClick={
      () => setShowHistory(v => !v)
    }>
      <DivideLine />
      <div
        className='mt-4 grid grid-cols-3 space-x-4 h-[400px] overflow-auto'
      >
        {data.histories.map((item: HistoryItem) =>
          <HistoryCard key={item.id} history={item} />)}
      </div>
    </div>
    : <div className='w-1/2 block fixed bottom-0 right-0 px-10 py-4' onClick={
      () => setShowHistory(true)
    }>
      <DivideLine />
    </div>
}
export default History
