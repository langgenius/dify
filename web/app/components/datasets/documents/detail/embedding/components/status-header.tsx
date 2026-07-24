import type { FC } from 'react'
import { RiLoader2Line, RiPauseCircleLine, RiPlayCircleLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type StatusHeaderProps = {
  isEmbedding: boolean
  isCompleted: boolean
  isPaused: boolean
  isError: boolean
  onPause: () => void
  onResume: () => void
  isPauseLoading?: boolean
  isResumeLoading?: boolean
}

const StatusHeader: FC<StatusHeaderProps> = React.memo(({
  isEmbedding,
  isCompleted,
  isPaused,
  isError,
  onPause,
  onResume,
  isPauseLoading,
  isResumeLoading,
}) => {
  const { t } = useTranslation()

  const getStatusText = () => {
    if (isEmbedding)
      return t('embedding.processing', { ns: 'datasetDocuments' })
    if (isCompleted)
      return t('embedding.completed', { ns: 'datasetDocuments' })
    if (isPaused)
      return t('embedding.paused', { ns: 'datasetDocuments' })
    if (isError)
      return t('embedding.error', { ns: 'datasetDocuments' })
    return ''
  }

  const buttonBaseClass = `flex items-center gap-x-1 rounded-md border-[0.5px]
    border-components-button-secondary-border bg-components-button-secondary-bg
    px-1.5 py-1 shadow-xs shadow-shadow-shadow-3 backdrop-blur-[5px]
    disabled:cursor-not-allowed disabled:opacity-50`

  return (
    <div className="flex h-6 items-center gap-x-1">
      {isEmbedding && <RiLoader2Line className="h-4 w-4 animate-spin text-text-secondary" />}
      <span className="system-md-semibold-uppercase grow text-text-secondary">
        {getStatusText()}
      </span>
      {isEmbedding && (
        <button
          type="button"
          className={buttonBaseClass}
          onClick={onPause}
          disabled={isPauseLoading}
        >
          <RiPauseCircleLine className="h-3.5 w-3.5 text-components-button-secondary-text" />
          <span className="system-xs-medium pr-[3px] text-components-button-secondary-text">
            {t('embedding.pause', { ns: 'datasetDocuments' })}
          </span>
        </button>
      )}
      {isPaused && (
        <button
          type="button"
          className={buttonBaseClass}
          onClick={onResume}
          disabled={isResumeLoading}
        >
          <RiPlayCircleLine className="h-3.5 w-3.5 text-components-button-secondary-text" />
          <span className="system-xs-medium pr-[3px] text-components-button-secondary-text">
            {t('embedding.resume', { ns: 'datasetDocuments' })}
          </span>
        </button>
      )}
    </div>
  )
})

StatusHeader.displayName = 'StatusHeader'

export default StatusHeader
