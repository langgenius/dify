'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import Indicator from '@/app/components/header/indicator'

type ResultProps = {
  status: string
  time?: number
  tokens?: number
  error?: string
}

const StatusPanel: FC<ResultProps> = ({
  status,
  time,
  tokens,
  error,
}) => {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'px-3 py-[10px] rounded-lg border-[0.5px] border-[rbga(0,0,0,0.05)] shadow-xs',
        status === 'running' && '!bg-primary-50',
        status === 'succeeded' && '!bg-[#ecfdf3]',
        status === 'failed' && '!bg-[#fef3f2]',
        status === 'stopped' && '!bg-[#fffaeb]',
      )}
    >
      <div className='flex'>
        <div className='flex-[33%] max-w-[120px]'>
          <div className='text-xs leading-[18px] font-medium text-gray-400'>{t('runLog.resultPanel.status')}</div>
          <div
            className={cn(
              'flex items-center gap-1 h-[18px] text-xs leading-3 font-semibold',
              status === 'running' && '!text-primary-600',
              status === 'succeeded' && '!text-[#039855]',
              status === 'failed' && '!text-[#d92d20]',
              status === 'stopped' && '!text-[#f79009]',
            )}
          >
            {status === 'running' && (
              <span>Running</span>
            )}
            {status === 'succeeded' && (
              <>
                <Indicator color={'green'} />
                <span>SUCCESS</span>
              </>
            )}
            {status === 'failed' && (
              <>
                <Indicator color={'red'} />
                <span>FAIL</span>
              </>
            )}
            {status === 'stopped' && (
              <>
                <Indicator color={'yellow'} />
                <span>STOP</span>
              </>
            )}
          </div>
        </div>
        <div className='flex-[33%] max-w-[152px]'>
          <div className='text-xs leading-[18px] font-medium text-gray-400'>{t('runLog.resultPanel.time')}</div>
          <div className='flex items-center gap-1 h-[18px] text-gray-700 text-xs leading-3 font-semibold'>
            {status === 'running' && (
              <div className='w-16 h-2 rounded-sm bg-[rgba(0,0,0,0.05)]'/>
            )}
            {status !== 'running' && (
              <span>{`${time?.toFixed(3)}s`}</span>
            )}
          </div>
        </div>
        <div className='flex-[33%]'>
          <div className='text-xs leading-[18px] font-medium text-gray-400'>{t('runLog.resultPanel.tokens')}</div>
          <div className='flex items-center gap-1 h-[18px] text-gray-700 text-xs leading-3 font-semibold'>
            {status === 'running' && (
              <div className='w-20 h-2 rounded-sm bg-[rgba(0,0,0,0.05)]'/>
            )}
            {status !== 'running' && (
              <span>{`${tokens || 0} Tokens`}</span>
            )}
          </div>
        </div>
      </div>
      {status === 'failed' && error && (
        <>
          <div className='my-2 h-[0.5px] bg-black opacity-5'/>
          <div className='text-xs leading-[18px] text-[#d92d20]'>{error}</div>
        </>
      )}
    </div>
  )
}

export default StatusPanel
