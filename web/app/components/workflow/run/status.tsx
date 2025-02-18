'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import Indicator from '@/app/components/header/indicator'
import StatusContainer from '@/app/components/workflow/run/status-container'

type ResultProps = {
  status: string
  time?: number
  tokens?: number
  error?: string
  exceptionCounts?: number
}

const StatusPanel: FC<ResultProps> = ({
  status,
  time,
  tokens,
  error,
  exceptionCounts,
}) => {
  const { t } = useTranslation()

  return (
    <StatusContainer status={status}>
      <div className='flex'>
        <div className={cn(
          'max-w-[120px] flex-[33%]',
          status === 'partial-succeeded' && 'min-w-[140px]',
        )}>
          <div className='text-text-tertiary system-2xs-medium-uppercase mb-1'>{t('runLog.resultPanel.status')}</div>
          <div
            className={cn(
              'system-xs-semibold-uppercase flex items-center gap-1',
              status === 'succeeded' && 'text-util-colors-green-green-600',
              status === 'partial-succeeded' && 'text-util-colors-green-green-600',
              status === 'failed' && 'text-util-colors-red-red-600',
              status === 'stopped' && 'text-util-colors-warning-warning-600',
              status === 'running' && 'text-util-colors-blue-light-blue-light-600',
            )}
          >
            {status === 'running' && (
              <>
                <Indicator color={'blue'} />
                <span>Running</span>
              </>
            )}
            {status === 'succeeded' && (
              <>
                <Indicator color={'green'} />
                <span>SUCCESS</span>
              </>
            )}
            {status === 'partial-succeeded' && (
              <>
                <Indicator color={'green'} />
                <span>PARTIAL SUCCESS</span>
              </>
            )}
            {status === 'exception' && (
              <>
                <Indicator color={'yellow'} />
                <span>EXCEPTION</span>
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
        <div className='max-w-[152px] flex-[33%]'>
          <div className='text-text-tertiary system-2xs-medium-uppercase mb-1'>{t('runLog.resultPanel.time')}</div>
          <div className='system-sm-medium text-text-secondary flex items-center gap-1'>
            {status === 'running' && (
              <div className='bg-text-quaternary h-2 w-16 rounded-sm' />
            )}
            {status !== 'running' && (
              <span>{time ? `${time?.toFixed(3)}s` : '-'}</span>
            )}
          </div>
        </div>
        <div className='flex-[33%]'>
          <div className='text-text-tertiary system-2xs-medium-uppercase mb-1'>{t('runLog.resultPanel.tokens')}</div>
          <div className='system-sm-medium text-text-secondary flex items-center gap-1'>
            {status === 'running' && (
              <div className='bg-text-quaternary h-2 w-20 rounded-sm' />
            )}
            {status !== 'running' && (
              <span>{`${tokens || 0} Tokens`}</span>
            )}
          </div>
        </div>
      </div>
      {status === 'failed' && error && (
        <>
          <div className='bg-divider-subtle my-2 h-[0.5px]'/>
          <div className='system-xs-regular text-text-destructive'>{error}</div>
          {
            !!exceptionCounts && (
              <>
                <div className='bg-divider-subtle my-2 h-[0.5px]'/>
                <div className='system-xs-regular text-text-destructive'>
                  {t('workflow.nodes.common.errorHandle.partialSucceeded.tip', { num: exceptionCounts })}
                </div>
              </>
            )
          }
        </>
      )}
      {
        status === 'partial-succeeded' && !!exceptionCounts && (
          <>
            <div className='bg-divider-deep my-2 h-[0.5px]'/>
            <div className='system-xs-medium text-text-warning'>
              {t('workflow.nodes.common.errorHandle.partialSucceeded.tip', { num: exceptionCounts })}
            </div>
          </>
        )
      }
      {
        status === 'exception' && (
          <>
            <div className='bg-divider-deep my-2 h-[0.5px]'/>
            <div className='system-xs-medium text-text-warning'>
              {error}
              <a
                href='https://docs.dify.ai/guides/workflow/error-handling/error-type'
                target='_blank'
                className='text-text-accent'
              >
                {t('workflow.common.learnMore')}
              </a>
            </div>
          </>
        )
      }
    </StatusContainer>
  )
}

export default StatusPanel
