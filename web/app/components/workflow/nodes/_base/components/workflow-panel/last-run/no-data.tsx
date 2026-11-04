'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { RiPlayLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  canSingleRun: boolean
  onSingleRun: () => void
}>

const NoData: FC<Props> = ({ canSingleRun, onSingleRun }) => {
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
        <Button className="flex" size="small" onClick={onSingleRun}>
          <RiPlayLine className="size-3.5" />
          <div>{t(($) => $['debug.noData.runThisNode'], { ns: 'workflowDebug' })}</div>
        </Button>
      )}
    </div>
  )
}
export default React.memo(NoData)
