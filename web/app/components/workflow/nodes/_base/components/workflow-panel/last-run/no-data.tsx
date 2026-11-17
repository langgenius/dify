'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import SingleRunButton from '../../single-run-button'

type Props = Readonly<{
  canSingleRun: boolean
  onSingleRun: () => void
  disabledReason?: string
}>

const NoData: FC<Props> = ({ canSingleRun, onSingleRun, disabledReason }) => {
  const { t } = useTranslation(['workflowDebug'])
  return (
    <div className="flex h-0 grow flex-col items-center justify-center">
      <span
        aria-hidden
        className="i-custom-vender-line-time-clock-play size-8 text-text-quaternary"
      />
      <div className="my-2 system-xs-regular text-text-tertiary">
        {t(($) => $['debug.noData.description'], { ns: 'workflowDebug' })}
      </div>
      {canSingleRun && (
        <SingleRunButton
          showLabel
          label={t(($) => $['debug.noData.runThisNode'], { ns: 'workflowDebug' })}
          disabledReason={disabledReason}
          onClick={onSingleRun}
        />
      )}
    </div>
  )
}
export default React.memo(NoData)
