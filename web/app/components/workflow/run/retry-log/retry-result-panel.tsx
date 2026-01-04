'use client'

import type { FC } from 'react'
import type { NodeTracing } from '@/types/workflow'
import {
  RiArrowLeftLine,
} from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import TracingPanel from '../tracing-panel'

type Props = {
  list: NodeTracing[]
  onBack: () => void
}

const RetryResultPanel: FC<Props> = ({
  list,
  onBack,
}) => {
  const { t } = useTranslation()

  return (
    <div>
      <div
        className="system-sm-medium flex h-8 cursor-pointer items-center bg-components-panel-bg px-4 text-text-accent-secondary"
        onClick={(e) => {
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          onBack()
        }}
      >
        <RiArrowLeftLine className="mr-1 h-4 w-4" />
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
