'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import Indicator from '@/app/components/header/indicator'
import StatusContainer from '@/app/components/workflow/run/status-container'
import { useDocLink } from '@/context/i18n'
import { useWorkflowPausedDetails } from '@/service/use-log'

type ResultProps = {
  status: string
  time?: number
  tokens?: number
  error?: string
  exceptionCounts?: number
  isListening?: boolean
  workflowRunId?: string
  onOpenTracingTab?: () => void
}

const StatusPanel: FC<ResultProps> = ({
  status,
  time,
  tokens,
  error,
  exceptionCounts,
  isListening = false,
  workflowRunId,
  onOpenTracingTab,
}) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { data: pausedDetails } = useWorkflowPausedDetails({
    workflowRunId: workflowRunId || '',
    enabled: status === 'paused',
  })

  const pausedReasons = useMemo(() => {
    const reasons: string[] = []
    if (!pausedDetails)
      return reasons
    const hasHumanInputNode = pausedDetails.paused_nodes.some(
      node => node.pause_type.type === 'human_input',
    )
    if (hasHumanInputNode) {
      reasons.push(t('nodes.humanInput.log.reasonContent', { ns: 'workflow' }))
    }
    return reasons
  }, [pausedDetails, t])

  const pausedInputURLs = useMemo(() => {
    const inputURLs: string[] = []
    if (!pausedDetails)
      return inputURLs
    const { paused_nodes } = pausedDetails
    const hasHumanInputNode = paused_nodes.some(
      node => node.pause_type.type === 'human_input',
    )
    if (hasHumanInputNode) {
      paused_nodes.forEach((node) => {
        if (node.pause_type.type === 'human_input') {
          inputURLs.push(node.pause_type.backstage_input_url)
        }
      })
    }
    return inputURLs
  }, [pausedDetails])

  const partialSucceededTip = exceptionCounts
    ? (
        <Trans
          i18nKey="nodes.common.errorHandle.partialSucceeded.tip"
          ns="workflow"
          values={{ num: exceptionCounts }}
          components={{
            tracingLink: onOpenTracingTab
              ? (
                  <a
                    href="#tracing"
                    className="cursor-pointer text-text-accent hover:underline"
                    onClick={(e) => {
                      e.preventDefault()
                      onOpenTracingTab()
                    }}
                  />
                )
              : <span />,
          }}
        />
      )
    : null

  return (
    <StatusContainer status={status}>
      <div className="flex">
        <div className={cn(
          'max-w-[120px] flex-[33%]',
          status === 'partial-succeeded' && 'min-w-[140px]',
        )}
        >
          <div className="mb-1 system-2xs-medium-uppercase text-text-tertiary">{t('resultPanel.status', { ns: 'runLog' })}</div>
          <div
            className={cn(
              'flex items-center gap-1 system-xs-semibold-uppercase',
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
          <div className="mb-1 system-2xs-medium-uppercase text-text-tertiary">{t('resultPanel.time', { ns: 'runLog' })}</div>
          <div className="flex items-center gap-1 system-sm-medium text-text-secondary">
            {(status === 'running' || status === 'paused') && (
              <div className="h-2 w-16 animate-pulse rounded-xs bg-text-quaternary" />
            )}
            {status !== 'running' && status !== 'paused' && (
              <span>{time ? `${time?.toFixed(3)}s` : '-'}</span>
            )}
          </div>
        </div>
        <div className="flex-[33%]">
          <div className="mb-1 system-2xs-medium-uppercase text-text-tertiary">{t('resultPanel.tokens', { ns: 'runLog' })}</div>
          <div className="flex items-center gap-1 system-sm-medium text-text-secondary">
            {(status === 'running' || status === 'paused') && (
              <div className="h-2 w-20 animate-pulse rounded-xs bg-text-quaternary" />
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
                  {partialSucceededTip}
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
              {partialSucceededTip}
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
                href={docLink('/use-dify/debug/error-type')}
                target="_blank"
                rel="noopener noreferrer"
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
          <div className="flex flex-col gap-y-2 system-xs-medium">
            <div className="flex flex-col gap-y-0.5">
              <div className="system-2xs-medium-uppercase text-text-tertiary">{t('nodes.humanInput.log.reason', { ns: 'workflow' })}</div>
              {
                pausedReasons.length > 0
                  ? pausedReasons.map(reason => (
                      <div className="truncate system-xs-medium text-text-secondary" key={reason}>{reason}</div>
                    ))
                  : (
                      <div className="h-2 w-20 animate-pulse rounded-xs bg-text-quaternary" />
                    )
              }
            </div>
            {pausedInputURLs.length > 0 && (
              <div className="flex flex-col gap-y-0.5">
                <div className="system-2xs-medium-uppercase text-text-tertiary">{t('nodes.humanInput.log.backstageInputURL', { ns: 'workflow' })}</div>
                {pausedInputURLs.map(url => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="system-xs-medium text-text-accent"
                  >
                    {url}
                  </a>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </StatusContainer>
  )
}

export default StatusPanel
