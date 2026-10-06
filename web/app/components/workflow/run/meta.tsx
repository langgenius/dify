'use client'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import useTimestamp from '@/hooks/use-timestamp'

type Props = {
  readonly status: string
  readonly executor?: string
  readonly startTime?: number
  readonly time?: number
  readonly tokens?: number
  readonly steps?: number
  readonly showSteps?: boolean
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
  const { t } = useTranslation(['appLog', 'runLog', 'workflow'])
  const { formatTime } = useTimestamp()

  return (
    <div className="relative">
      <div className="h-6 py-1 system-xs-medium-uppercase text-text-tertiary">
        {t(($) => $['meta.title'], { ns: 'runLog' })}
      </div>
      <div className="py-1">
        <div className="flex">
          <div className="w-26 shrink-0 truncate px-2 py-1.5 system-xs-regular text-text-tertiary">
            {t(($) => $['meta.status'], { ns: 'runLog' })}
          </div>
          <div className="grow px-2 py-1.5 system-xs-regular text-text-secondary">
            {status === 'running' && (
              <div className="my-1 h-2 w-16 rounded-xs bg-text-quaternary" />
            )}
            {status === 'scheduled' && (
              <span>{t(($) => $['status.scheduled'], { ns: 'appLog' })}</span>
            )}
            {status === 'succeeded' && (
              <span>{t(($) => $['status.succeeded'], { ns: 'appLog' })}</span>
            )}
            {status === 'partial-succeeded' && (
              <span>{t(($) => $['status.partial-succeeded'], { ns: 'appLog' })}</span>
            )}
            {status === 'exception' && (
              <span>{t(($) => $['tracing.status.exception'], { ns: 'workflow' })}</span>
            )}
            {status === 'failed' && <span>{t(($) => $['status.failed'], { ns: 'appLog' })}</span>}
            {status === 'stopped' && <span>{t(($) => $['status.stopped'], { ns: 'appLog' })}</span>}
            {status === 'paused' && <span>{t(($) => $['status.paused'], { ns: 'appLog' })}</span>}
          </div>
        </div>
        <div className="flex">
          <div className="w-26 shrink-0 truncate px-2 py-1.5 system-xs-regular text-text-tertiary">
            {t(($) => $['meta.executor'], { ns: 'runLog' })}
          </div>
          <div className="grow px-2 py-1.5 system-xs-regular text-text-secondary">
            {status === 'running' && (
              <div className="my-1 h-2 w-22 rounded-xs bg-text-quaternary" />
            )}
            {status !== 'running' && <span>{executor || 'N/A'}</span>}
          </div>
        </div>
        <div className="flex">
          <div className="w-26 shrink-0 truncate px-2 py-1.5 system-xs-regular text-text-tertiary">
            {t(($) => $['meta.startTime'], { ns: 'runLog' })}
          </div>
          <div className="grow px-2 py-1.5 system-xs-regular text-text-secondary">
            {status === 'running' && (
              <div className="my-1 h-2 w-18 rounded-xs bg-text-quaternary" />
            )}
            {status !== 'running' && (
              <span>
                {startTime
                  ? formatTime(startTime, t(($) => $.dateTimeFormat, { ns: 'appLog' }) as string)
                  : '-'}
              </span>
            )}
          </div>
        </div>
        <div className="flex">
          <div className="w-26 shrink-0 truncate px-2 py-1.5 system-xs-regular text-text-tertiary">
            {t(($) => $['meta.time'], { ns: 'runLog' })}
          </div>
          <div className="grow px-2 py-1.5 system-xs-regular text-text-secondary">
            {status === 'running' && (
              <div className="my-1 h-2 w-18 rounded-xs bg-text-quaternary" />
            )}
            {status !== 'running' && <span>{time ? `${time.toFixed(3)}s` : '-'}</span>}
          </div>
        </div>
        <div className="flex">
          <div className="w-26 shrink-0 truncate px-2 py-1.5 system-xs-regular text-text-tertiary">
            {t(($) => $['meta.tokens'], { ns: 'runLog' })}
          </div>
          <div className="grow px-2 py-1.5 system-xs-regular text-text-secondary">
            {['running', 'paused'].includes(status) && (
              <div className="my-1 h-2 w-12 animate-pulse rounded-xs bg-text-quaternary" />
            )}
            {!['running', 'paused'].includes(status) && <span>{`${tokens || 0} Tokens`}</span>}
          </div>
        </div>
        {showSteps && (
          <div className="flex">
            <div className="w-26 shrink-0 truncate px-2 py-1.5 system-xs-regular text-text-tertiary">
              {t(($) => $['meta.steps'], { ns: 'runLog' })}
            </div>
            <div className="grow px-2 py-1.5 system-xs-regular text-text-secondary">
              {status === 'running' && (
                <div className="my-1 h-2 w-6 rounded-xs bg-text-quaternary" />
              )}
              {status !== 'running' && <span>{steps}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default MetaData
