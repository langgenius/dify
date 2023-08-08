'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import Progress from './progress'
import Button from '@/app/components/base/button'
import { LinkExternal02, XClose } from '@/app/components/base/icons/src/vender/line/general'
type Props = {
  isCloud: boolean
  used: number
  total: number
}

const APIKeyInfoPanel: FC<Props> = ({
  isCloud,
  used,
  total,
}) => {
  const usedPercent = Math.round(used / total * 100)
  const isTrialFinished = usedPercent === 100
  const [isShow, setIsShow] = useState(true)
  if (!(isShow))
    return null

  return (
    <div className='mb-6 relative  rounded-2xl shadow-md border border-[#D1E0FF] p-8 bg-[#EFF4FF]'>
      <div className='flex items-center h-8 text-[24px] space-x-1' >
        <em-emoji id={isTrialFinished ? '🤔' : '😀'} />
        <div className=' text-gray-800 font-semibold'>You are using the OpenAI trial quota.</div>
      </div>

      <div className='mt-1 text-sm text-gray-600 font-normal'>The trial quota is provided for your testing use. Before the 200 calls are exhausted, please set up your own model provider or purchase additional quota.</div>
      {/* Call times info */}
      {isCloud && (
        <div className='my-5'>
          <div className='flex items-center h-5 space-x-2 text-sm text-gray-700 font-medium'>
            <div>call times</div>
            <div>·</div>
            <div className='font-semibold'>{used}/{total}</div>
          </div>
          <Progress className='mt-2' value={usedPercent} />
        </div>
      )}
      <Button type='primary' className='space-x-2'>
        <div className='text-sm font-medium'>Got to Setup xxx</div>
        <LinkExternal02 className='w-4 h-4' />
      </Button>
      {!isCloud && (
        <a
          className='mt-2 flex items-center h-[26px] text-xs  font-medium text-[#155EEF] p-1 space-x-1'
          href='https://cloud.dify.ai/apps'
          target='_blank'
        >
          <div>or try cloud version</div>
          <LinkExternal02 className='w-3 h-3' />
        </a>
      )}
      <div
        onClick={() => setIsShow(false)}
        className='absolute right-4 top-4 flex items-center justify-center w-8 h-8 cursor-pointer '>
        <XClose className='w-4 h-4 text-gray-500' />
      </div>
    </div>
  )
}
export default React.memo(APIKeyInfoPanel)
