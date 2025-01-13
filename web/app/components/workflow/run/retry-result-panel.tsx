'use client'

import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowLeftLine,
} from '@remixicon/react'
import TracingPanel from './tracing-panel'
import type { NodeTracing } from '@/types/workflow'

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
        className='flex items-center px-4 h-8 text-text-accent-secondary bg-components-panel-bg system-sm-medium cursor-pointer'
        onClick={(e) => {
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          onBack()
        }}
      >
        <RiArrowLeftLine className='mr-1 w-4 h-4' />
        {t('workflow.singleRun.back')}
      </div>
      <TracingPanel
        list={list.map((item, index) => ({
          ...item,
          title: `${t('workflow.nodes.common.retry.retry')} ${index + 1}`,
        }))}
        className='bg-background-section-burn'
      />
    </div >
  )
}
export default memo(RetryResultPanel)
