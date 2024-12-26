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
      <div className='h-6 py-1 text-text-tertiary system-xs-medium-uppercase'>{t('runLog.meta.title')}</div>
      <div className='py-1'>
        <div className='flex'>
          <div className='shrink-0 w-[104px] px-2 py-1.5 text-text-tertiary system-xs-regular truncate'>{t('runLog.meta.status')}</div>
          <div className='grow px-2 py-1.5 text-text-secondary system-xs-regular'>
            {status === 'running' && (
              <div className='my-1 w-16 h-2 rounded-sm bg-text-quaternary'/>
            )}
            {status === 'succeeded' && (
              <span>SUCCESS</span>
            )}
            {status === 'partial-succeeded' && (
              <span>PARTIAL SUCCESS</span>
            )}
            {status === 'exception' && (
              <span>EXCEPTION</span>
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
          <div className='shrink-0 w-[104px] px-2 py-1.5 text-text-tertiary system-xs-regular truncate'>{t('runLog.meta.executor')}</div>
          <div className='grow px-2 py-1.5 text-text-secondary system-xs-regular'>
            {status === 'running' && (
              <div className='my-1 w-[88px] h-2 rounded-sm bg-text-quaternary'/>
            )}
            {status !== 'running' && (
              <span>{executor || 'N/A'}</span>
            )}
          </div>
        </div>
        <div className='flex'>
          <div className='shrink-0 w-[104px] px-2 py-1.5 text-text-tertiary system-xs-regular truncate'>{t('runLog.meta.startTime')}</div>
          <div className='grow px-2 py-1.5 text-text-secondary system-xs-regular'>
            {status === 'running' && (
              <div className='my-1 w-[72px] h-2 rounded-sm bg-text-quaternary'/>
            )}
            {status !== 'running' && (
              <span>{startTime ? formatTime(startTime, t('appLog.dateTimeFormat') as string) : '-'}</span>
            )}
          </div>
        </div>
        <div className='flex'>
          <div className='shrink-0 w-[104px] px-2 py-1.5 text-text-tertiary system-xs-regular truncate'>{t('runLog.meta.time')}</div>
          <div className='grow px-2 py-1.5 text-text-secondary system-xs-regular'>
            {status === 'running' && (
              <div className='my-1 w-[72px] h-2 rounded-sm bg-text-quaternary'/>
            )}
            {status !== 'running' && (
              <span>{time ? `${time.toFixed(3)}s` : '-'}</span>
            )}
          </div>
        </div>
        <div className='flex'>
          <div className='shrink-0 w-[104px] px-2 py-1.5 text-text-tertiary system-xs-regular truncate'>{t('runLog.meta.tokens')}</div>
          <div className='grow px-2 py-1.5 text-text-secondary system-xs-regular'>
            {status === 'running' && (
              <div className='my-1 w-[48px] h-2 rounded-sm bg-text-quaternary'/>
            )}
            {status !== 'running' && (
              <span>{`${tokens || 0} Tokens`}</span>
            )}
          </div>
        </div>
        {showSteps && (
          <div className='flex'>
            <div className='shrink-0 w-[104px] px-2 py-1.5 text-text-tertiary system-xs-regular truncate'>{t('runLog.meta.steps')}</div>
            <div className='grow px-2 py-1.5 text-text-secondary system-xs-regular'>
              {status === 'running' && (
                <div className='my-1 w-[24px] h-2 rounded-sm bg-text-quaternary'/>
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
