'use client'

import type { FC } from 'react'
import type {
  LLMTraceItem,
  ToolCallItem,
} from '@/types/workflow'
import {
  RiArrowLeftLine,
} from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import ToolCallItemComponent from '@/app/components/workflow/run/llm-log/tool-call-item'

type Props = {
  list: LLMTraceItem[]
  onBack: () => void
}

const LLMResultPanel: FC<Props> = ({
  list,
  onBack,
}) => {
  const { t } = useTranslation()
  const formattedList = list.map((item) => {
    if (item.type === 'tool') {
      return {
        type: 'tool',
        toolName: item.name,
        toolProvider: item.provider,
        toolIcon: item.icon,
        toolIconDark: item.icon_dark,
        toolArguments: item.output.arguments,
        toolOutput: item.output.output,
        toolDuration: item.duration,
      }
    }

    return {
      type: 'model',
      modelName: item.name,
      modelProvider: item.provider,
      modelIcon: item.icon,
      modelIconDark: item.icon_dark,
      modelOutput: item.output,
      modelDuration: item.duration,
    }
  })

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
      <div className="space-y-1 p-2">
        {
          formattedList.map((item, index) => (
            <ToolCallItemComponent key={index} payload={item as ToolCallItem} />
          ))
        }
      </div>
    </div>
  )
}
export default memo(LLMResultPanel)
