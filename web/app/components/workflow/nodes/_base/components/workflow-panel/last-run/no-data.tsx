'use client'
import type { FC } from 'react'
import { RiPlayLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { ClockPlay } from '@/app/components/base/icons/src/vender/line/time'

type Props = {
  canSingleRun: boolean
  onSingleRun: () => void
}

const NoData: FC<Props> = ({
  canSingleRun,
  onSingleRun,
}) => {
  const { t } = useTranslation()
  return (
    <div className="flex h-0 grow flex-col items-center justify-center">
      <ClockPlay className="h-8 w-8 text-text-quaternary" />
      <div className="system-xs-regular my-2 text-text-tertiary">{t('debug.noData.description', { ns: 'workflow' })}</div>
      {canSingleRun && (
        <Button
          className="flex"
          size="small"
          onClick={onSingleRun}
        >
          <RiPlayLine className="mr-1 h-3.5 w-3.5" />
          <div>{t('debug.noData.runThisNode', { ns: 'workflow' })}</div>
        </Button>
      )}
    </div>
  )
}
export default React.memo(NoData)
