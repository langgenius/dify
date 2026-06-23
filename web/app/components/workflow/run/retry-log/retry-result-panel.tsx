'use client'

import type { FC } from 'react'
import type { NodeTracing } from '@/types/workflow'
import {
  RiArrowLeftLine,
} from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from '#i18n'
import TracingPanel from '../tracing-panel'

type Props = {
  readonly list: NodeTracing[]
  readonly onBack: () => void
}

const RetryResultPanel: FC<Props> = ({
  list,
  onBack,
}) => {
  const { t } = useTranslation()

  return (
    <div>
      <div
        className="flex h-8 cursor-pointer items-center bg-components-panel-bg px-4 system-sm-medium text-text-accent-secondary"
        onClick={(e) => {
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          onBack()
        }}
      >
        <RiArrowLeftLine className="mr-1 size-4" />
        {t('singleRun.back', { ns: 'workflow' })}
      </div>
      <TracingPanel
        list={list.map((item, index) => ({
          ...item,
          title: `${t('nodes.common.retry.retry', { ns: 'workflow' })} ${index + 1}`,
        }))}
        className="bg-background-section-burn"
      />
    </div>
  )
}
export default memo(RetryResultPanel)
