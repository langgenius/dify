'use client'
import { useTranslation } from 'react-i18next'
import type { FC } from 'react'
import ToolCall from './tool-call'
import Divider from '@/app/components/base/divider'
import type { AgentIteration } from '@/models/log'
import cn from '@/utils/classnames'

type Props = {
  isFinal: boolean
  index: number
  iterationInfo: AgentIteration
}

const Iteration: FC<Props> = ({ iterationInfo, isFinal, index }) => {
  const { t } = useTranslation()

  return (
    <div className={cn('px-4 py-2')}>
      <div className='flex items-center'>
        {isFinal && (
          <div className='text-text-tertiary mr-3 shrink-0 text-xs font-semibold leading-[18px]'>{t('appLog.agentLogDetail.finalProcessing')}</div>
        )}
        {!isFinal && (
          <div className='text-text-tertiary mr-3 shrink-0 text-xs font-semibold leading-[18px]'>{`${t('appLog.agentLogDetail.iteration').toUpperCase()} ${index}`}</div>
        )}
        <Divider bgStyle='gradient' className='mx-0 h-[1px] grow'/>
      </div>
      <ToolCall
        isLLM
        isFinal={isFinal}
        tokens={iterationInfo.tokens}
        observation={iterationInfo.tool_raw.outputs}
        finalAnswer={iterationInfo.thought}
        toolCall={{
          status: 'success',
          tool_icon: null,
        }}
      />
      {iterationInfo.tool_calls.map((toolCall, index) => (
        <ToolCall
          isLLM={false}
          key={index}
          toolCall={toolCall}
        />
      ))}
    </div>
  )
}

export default Iteration
