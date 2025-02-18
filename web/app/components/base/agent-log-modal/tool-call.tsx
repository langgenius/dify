'use client'
import type { FC } from 'react'
import { useState } from 'react'
import {
  RiCheckboxCircleLine,
  RiErrorWarningLine,
} from '@remixicon/react'
import { useContext } from 'use-context-selector'
import cn from '@/utils/classnames'
import BlockIcon from '@/app/components/workflow/block-icon'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'
import type { ToolCall } from '@/models/log'
import { BlockEnum } from '@/app/components/workflow/types'
import I18n from '@/context/i18n'

type Props = {
  toolCall: ToolCall
  isLLM: boolean
  isFinal?: boolean
  tokens?: number
  observation?: any
  finalAnswer?: any
}

const ToolCallItem: FC<Props> = ({ toolCall, isLLM = false, isFinal, tokens, observation, finalAnswer }) => {
  const [collapseState, setCollapseState] = useState<boolean>(true)
  const { locale } = useContext(I18n)
  const toolName = isLLM ? 'LLM' : (toolCall.tool_label[locale] || toolCall.tool_label[locale.replaceAll('-', '_')])

  const getTime = (time: number) => {
    if (time < 1)
      return `${(time * 1000).toFixed(3)} ms`
    if (time > 60)
      return `${Number.parseInt(Math.round(time / 60).toString())} m ${(time % 60).toFixed(3)} s`
    return `${time.toFixed(3)} s`
  }

  const getTokenCount = (tokens: number) => {
    if (tokens < 1000)
      return tokens
    if (tokens >= 1000 && tokens < 1000000)
      return `${Number.parseFloat((tokens / 1000).toFixed(3))}K`
    if (tokens >= 1000000)
      return `${Number.parseFloat((tokens / 1000000).toFixed(3))}M`
  }

  return (
    <div className={cn('py-1')}>
      <div className={cn('bg-background-default border-components-panel-border shadow-xs group rounded-2xl border transition-all hover:shadow-md')}>
        <div
          className={cn(
            'flex cursor-pointer items-center py-3 pl-[6px] pr-3',
            !collapseState && '!pb-2',
          )}
          onClick={() => setCollapseState(!collapseState)}
        >
          <ChevronRight
            className={cn(
              'text-text-quaternary group-hover:text-text-tertiary mr-1 h-3 w-3 shrink-0 transition-all',
              !collapseState && 'rotate-90',
            )}
          />
          <BlockIcon className={cn('mr-2 shrink-0')} type={isLLM ? BlockEnum.LLM : BlockEnum.Tool} toolIcon={toolCall.tool_icon} />
          <div className={cn(
            'text-text-secondary grow truncate text-[13px] font-semibold leading-[16px]',
          )} title={toolName}>{toolName}</div>
          <div className='text-text-tertiary shrink-0 text-xs leading-[18px]'>
            {toolCall.time_cost && (
              <span>{getTime(toolCall.time_cost || 0)}</span>
            )}
            {isLLM && (
              <span>{`${getTokenCount(tokens || 0)} tokens`}</span>
            )}
          </div>
          {toolCall.status === 'success' && (
            <RiCheckboxCircleLine className='ml-2 h-3.5 w-3.5 shrink-0 text-[#12B76A]' />
          )}
          {toolCall.status === 'error' && (
            <RiErrorWarningLine className='ml-2 h-3.5 w-3.5 shrink-0 text-[#F04438]' />
          )}
        </div>
        {!collapseState && (
          <div className='pb-2'>
            <div className={cn('px-[10px] py-1')}>
              {toolCall.status === 'error' && (
                <div className='shadow-xs rounded-lg border-[0.5px] border-[rbga(0,0,0,0.05)] bg-[#fef3f2] px-3 py-[10px] text-xs leading-[18px] text-[#d92d20]'>{toolCall.error}</div>
              )}
            </div>
            {toolCall.tool_input && (
              <div className={cn('px-[10px] py-1')}>
                <CodeEditor
                  readOnly
                  title={<div>INPUT</div>}
                  language={CodeLanguage.json}
                  value={toolCall.tool_input}
                  isJSONStringifyBeauty
                />
              </div>
            )}
            {toolCall.tool_output && (
              <div className={cn('px-[10px] py-1')}>
                <CodeEditor
                  readOnly
                  title={<div>OUTPUT</div>}
                  language={CodeLanguage.json}
                  value={toolCall.tool_output}
                  isJSONStringifyBeauty
                />
              </div>
            )}
            {isLLM && (
              <div className={cn('px-[10px] py-1')}>
                <CodeEditor
                  readOnly
                  title={<div>OBSERVATION</div>}
                  language={CodeLanguage.json}
                  value={observation}
                  isJSONStringifyBeauty
                />
              </div>
            )}
            {isLLM && (
              <div className={cn('px-[10px] py-1')}>
                <CodeEditor
                  readOnly
                  title={<div>{isFinal ? 'FINAL ANSWER' : 'THOUGHT'}</div>}
                  language={CodeLanguage.json}
                  value={finalAnswer}
                  isJSONStringifyBeauty
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ToolCallItem
