'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import Indicator from '@/app/components/header/indicator'
import StatusContainer from '@/app/components/workflow/run/status-container'
import { useDocLink } from '@/context/i18n'
import { cn } from '@/utils/classnames'

type ResultProps = {
  status: string
  time?: number
  tokens?: number
  error?: string
  exceptionCounts?: number
  inputURL?: string
  isListening?: boolean
}

const StatusPanel: FC<ResultProps> = ({
  status,
  time,
  tokens,
  error,
  exceptionCounts,
  inputURL,
  isListening = false,
}) => {
  const { t } = useTranslation()
  const docLink = useDocLink()

  return (
    <StatusContainer status={status}>
      <div className="flex">
        <div className={cn(
          'max-w-[120px] flex-[33%]',
          status === 'partial-succeeded' && 'min-w-[140px]',
        )}
        >
          <div className="system-2xs-medium-uppercase mb-1 text-text-tertiary">{t('resultPanel.status', { ns: 'runLog' })}</div>
          <div
            className={cn(
              'system-xs-semibold-uppercase flex items-center gap-1',
              status === 'succeeded' && 'text-util-colors-green-green-600',
              status === 'partial-succeeded' && 'text-util-colors-green-green-600',
              status === 'failed' && 'text-util-colors-red-red-600',
              (status === 'stopped' || status === 'paused') && 'text-util-colors-warning-warning-600',
              status === 'running' && 'text-util-colors-blue-light-blue-light-600',
            )}
          >
            {status === 'running' && (
              <>
                <Indicator color="blue" />
                <span>{isListening ? 'Listening' : 'Running'}</span>
              </>
            )}
            {status === 'succeeded' && (
              <>
                <Indicator color="green" />
                <span>SUCCESS</span>
              </>
            )}
            {status === 'partial-succeeded' && (
              <>
                <Indicator color="green" />
                <span>PARTIAL SUCCESS</span>
              </>
            )}
            {status === 'exception' && (
              <>
                <Indicator color="yellow" />
                <span>EXCEPTION</span>
              </>
            )}
            {status === 'failed' && (
              <>
                <Indicator color="red" />
                <span>FAIL</span>
              </>
            )}
            {status === 'stopped' && (
              <>
                <Indicator color="yellow" />
                <span>STOP</span>
              </>
            )}
            {status === 'paused' && (
              <>
                <Indicator color="yellow" />
                <span>PENDING</span>
              </>
            )}
          </div>
        </div>
        <div className="max-w-[152px] flex-[33%]">
          <div className="system-2xs-medium-uppercase mb-1 text-text-tertiary">{t('resultPanel.time', { ns: 'runLog' })}</div>
          <div className="system-sm-medium flex items-center gap-1 text-text-secondary">
            {(status === 'running' || status === 'paused') && (
              <div className="h-2 w-16 rounded-sm bg-text-quaternary" />
            )}
            {status !== 'running' && status !== 'paused' && (
              <span>{time ? `${time?.toFixed(3)}s` : '-'}</span>
            )}
          </div>
        </div>
        <div className="flex-[33%]">
          <div className="system-2xs-medium-uppercase mb-1 text-text-tertiary">{t('resultPanel.tokens', { ns: 'runLog' })}</div>
          <div className="system-sm-medium flex items-center gap-1 text-text-secondary">
            {(status === 'running' || status === 'paused') && (
              <div className="h-2 w-20 rounded-sm bg-text-quaternary" />
            )}
            {status !== 'running' && status !== 'paused' && (
              <span>{`${tokens || 0} Tokens`}</span>
            )}
          </div>
        </div>
      </div>
      {status === 'failed' && error && (
        <>
          <div className="my-2 h-[0.5px] bg-divider-subtle" />
          <div className="system-xs-regular whitespace-pre-wrap text-text-destructive">{error}</div>
          {
            !!exceptionCounts && (
              <>
                <div className="my-2 h-[0.5px] bg-divider-subtle" />
                <div className="system-xs-regular text-text-destructive">
                  {t('nodes.common.errorHandle.partialSucceeded.tip', { ns: 'workflow', num: exceptionCounts })}
                </div>
              </>
            )
          }
        </>
      )}
      {
        status === 'partial-succeeded' && !!exceptionCounts && (
          <>
            <div className="my-2 h-[0.5px] bg-divider-deep" />
            <div className="system-xs-medium text-text-warning">
              {t('nodes.common.errorHandle.partialSucceeded.tip', { ns: 'workflow', num: exceptionCounts })}
            </div>
          </>
        )
      }
      {
        status === 'exception' && (
          <>
            <div className="my-2 h-[0.5px] bg-divider-deep" />
            <div className="system-xs-medium text-text-warning">
              {error}
              <a
                href={docLink('/guides/workflow/error-handling/error-type')}
                target="_blank"
                className="text-text-accent"
              >
                {t('common.learnMore', { ns: 'workflow' })}
              </a>
            </div>
          </>
        )
      }
      {status === 'paused' && (
        <>
          <div className="my-2 h-[0.5px] bg-divider-deep" />
          <div className="system-xs-medium space-y-1 text-text-warning">
            <div className="flex items-center gap-1">
              <div className="w-[96px] uppercase">{t('nodes.humanInput.log.reason', { ns: 'workflow' })}</div>
              <div className="truncate">{t('nodes.humanInput.log.reasonContent', { ns: 'workflow' })}</div>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-[96px] uppercase">{t('nodes.humanInput.log.inputURL', { ns: 'workflow' })}</div>
              <a
                href={inputURL}
                target="_blank"
                className="text-text-accent"
              >
                {inputURL}
              </a>
            </div>
          </div>
        </>
      )}
    </StatusContainer>
  )
}

export default StatusPanel
