'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import useTimestamp from '@/hooks/use-timestamp'

type Props = {
  status: string
  executor?: string
  startTime?: number
  time?: number
  tokens?: number
  steps?: number
  showSteps?: boolean
}

const MetaData: FC<Props> = ({
  status,
  executor,
  startTime,
  time,
  tokens,
  steps = 1,
  showSteps = true,
}) => {
  const { t } = useTranslation()
  const { formatTime } = useTimestamp()

  return (
    <div className='relative'>
      <div className='h-6 leading-6 text-gray-500 text-xs font-medium'>{t('runLog.meta.title')}</div>
      <div className='py-1'>
        <div className='flex'>
          <div className='shrink-0 w-[104px] px-2 py-[5px] text-gray-500 text-xs leading-[18px] truncate'>{t('runLog.meta.status')}</div>
          <div className='grow px-2 py-[5px] text-gray-900 text-xs leading-[18px]'>
            {status === 'running' && (
              <div className='my-[5px] w-16 h-2 rounded-sm bg-[rgba(0,0,0,0.05)]'/>
            )}
            {status === 'succeeded' && (
              <span>SUCCESS</span>
            )}
            {status === 'failed' && (
              <span>FAIL</span>
            )}
            {status === 'stopped' && (
              <span>STOP</span>
            )}
          </div>
        </div>
        <div className='flex'>
          <div className='shrink-0 w-[104px] px-2 py-[5px] text-gray-500 text-xs leading-[18px] truncate'>{t('runLog.meta.executor')}</div>
          <div className='grow px-2 py-[5px] text-gray-900 text-xs leading-[18px]'>
            {status === 'running' && (
              <div className='my-[5px] w-[88px] h-2 rounded-sm bg-[rgba(0,0,0,0.05)]'/>
            )}
            {status !== 'running' && (
              <span>{executor || 'N/A'}</span>
            )}
          </div>
        </div>
        <div className='flex'>
          <div className='shrink-0 w-[104px] px-2 py-[5px] text-gray-500 text-xs leading-[18px] truncate'>{t('runLog.meta.startTime')}</div>
          <div className='grow px-2 py-[5px] text-gray-900 text-xs leading-[18px]'>
            {status === 'running' && (
              <div className='my-[5px] w-[72px] h-2 rounded-sm bg-[rgba(0,0,0,0.05)]'/>
            )}
            {status !== 'running' && (
              <span>{startTime ? formatTime(startTime, t('appLog.dateTimeFormat') as string) : '-'}</span>
            )}
          </div>
        </div>
        <div className='flex'>
          <div className='shrink-0 w-[104px] px-2 py-[5px] text-gray-500 text-xs leading-[18px] truncate'>{t('runLog.meta.time')}</div>
          <div className='grow px-2 py-[5px] text-gray-900 text-xs leading-[18px]'>
            {status === 'running' && (
              <div className='my-[5px] w-[72px] h-2 rounded-sm bg-[rgba(0,0,0,0.05)]'/>
            )}
            {status !== 'running' && (
              <span>{time ? `${time.toFixed(3)}s` : '-'}</span>
            )}
          </div>
        </div>
        <div className='flex'>
          <div className='shrink-0 w-[104px] px-2 py-[5px] text-gray-500 text-xs leading-[18px] truncate'>{t('runLog.meta.tokens')}</div>
          <div className='grow px-2 py-[5px] text-gray-900 text-xs leading-[18px]'>
            {status === 'running' && (
              <div className='my-[5px] w-[48px] h-2 rounded-sm bg-[rgba(0,0,0,0.05)]'/>
            )}
            {status !== 'running' && (
              <span>{`${tokens || 0} Tokens`}</span>
            )}
          </div>
        </div>
        {showSteps && (
          <div className='flex'>
            <div className='shrink-0 w-[104px] px-2 py-[5px] text-gray-500 text-xs leading-[18px] truncate'>{t('runLog.meta.steps')}</div>
            <div className='grow px-2 py-[5px] text-gray-900 text-xs leading-[18px]'>
              {status === 'running' && (
                <div className='my-[5px] w-[24px] h-2 rounded-sm bg-[rgba(0,0,0,0.05)]'/>
              )}
              {status !== 'running' && (
                <span>{steps}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default MetaData
