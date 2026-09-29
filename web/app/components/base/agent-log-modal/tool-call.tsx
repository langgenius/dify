'use client'
import type {
  AgentIterationLogResponse,
  AgentToolCallResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { RiCheckboxCircleLine, RiErrorWarningLine } from '@remixicon/react'
import { useState } from 'react'
import { useLocale } from '#i18n'
import BlockIcon from '@/app/components/workflow/block-icon'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { BlockEnum } from '@/app/components/workflow/types'

type Props = Readonly<
  | {
      isLLM: true
      isFinal: boolean
      tokens: AgentIterationLogResponse['tokens']
      observation: AgentIterationLogResponse['tool_raw']['outputs']
      finalAnswer: AgentIterationLogResponse['thought']
    }
  | { isLLM: false; toolCall: AgentToolCallResponse }
>

const ToolCallItem: FC<Props> = (props) => {
  const [collapseState, setCollapseState] = useState<boolean>(true)
  const locale = useLocale()
  const toolCall = props.isLLM ? undefined : props.toolCall
  const toolLabel = toolCall?.tool_label
  const toolName = props.isLLM
    ? 'LLM'
    : typeof toolLabel === 'string'
      ? toolLabel
      : (toolLabel?.[locale] ?? toolLabel?.[locale.replaceAll('-', '_')] ?? toolCall?.tool_name)
  const status = toolCall?.status ?? 'success'

  const getTime = (time: number) => {
    if (time < 1) return `${(time * 1000).toFixed(3)} ms`
    if (time > 60) return `${Math.floor(time / 60)} m ${(time % 60).toFixed(3)} s`
    return `${time.toFixed(3)} s`
  }

  const getTokenCount = (tokens: number) => {
    if (tokens < 1000) return tokens
    if (tokens >= 1000 && tokens < 1000000)
      return `${Number.parseFloat((tokens / 1000).toFixed(3))}K`
    if (tokens >= 1000000) return `${Number.parseFloat((tokens / 1000000).toFixed(3))}M`
  }

  return (
    <div className={cn('py-1')}>
      <div
        className={cn(
          'group rounded-2xl border border-components-panel-border bg-background-default shadow-xs transition-all hover:shadow-md',
        )}
      >
        <button
          type="button"
          aria-expanded={!collapseState}
          className={cn(
            'flex w-full cursor-pointer items-center rounded-2xl py-3 pr-3 pl-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-components-input-border-active',
            !collapseState && 'pb-2!',
          )}
          onClick={() => setCollapseState(!collapseState)}
        >
          <span
            aria-hidden
            className={cn(
              'i-custom-vender-line-arrows-chevron-right h-3.5 w-3.5',
              cn(
                'mr-1 size-3 shrink-0 text-text-quaternary transition-all group-hover:text-text-tertiary',
                !collapseState && 'rotate-90',
              ),
            )}
          />
          <BlockIcon
            className={cn('mr-2 shrink-0')}
            type={props.isLLM ? BlockEnum.LLM : BlockEnum.Tool}
            toolIcon={toolCall?.tool_icon}
          />
          <div
            className={cn('grow truncate text-[13px] leading-4 font-semibold text-text-secondary')}
            title={toolName}
          >
            {toolName}
          </div>
          <div className="shrink-0 text-xs leading-4.5 text-text-tertiary">
            {toolCall && <span>{getTime(toolCall.time_cost)}</span>}
            {props.isLLM && props.tokens !== null && (
              <span>{`${getTokenCount(props.tokens)} tokens`}</span>
            )}
          </div>
          {status === 'success' && (
            <RiCheckboxCircleLine className="ml-2 h-3.5 w-3.5 shrink-0 text-[#12B76A]" />
          )}
          {status === 'error' && (
            <RiErrorWarningLine className="ml-2 h-3.5 w-3.5 shrink-0 text-[#F04438]" />
          )}
        </button>
        {!collapseState && (
          <div className="pb-2">
            <div className={cn('px-2.5 py-1')}>
              {toolCall?.status === 'error' && (
                <div className="rounded-lg border-[0.5px] border-[rbga(0,0,0,0.05)] bg-[#fef3f2] px-3 py-2.5 text-xs leading-4.5 text-[#d92d20] shadow-xs">
                  {toolCall.error}
                </div>
              )}
            </div>
            {toolCall && (
              <div className={cn('px-2.5 py-1')}>
                <CodeEditor
                  readOnly
                  title={<div>INPUT</div>}
                  language={CodeLanguage.json}
                  value={
                    typeof toolCall.tool_input === 'string'
                      ? toolCall.tool_input
                      : JSON.stringify(toolCall.tool_input, null, 2)
                  }
                />
              </div>
            )}
            {toolCall && (
              <div className={cn('px-2.5 py-1')}>
                <CodeEditor
                  readOnly
                  title={<div>OUTPUT</div>}
                  language={CodeLanguage.json}
                  value={
                    typeof toolCall.tool_output === 'string'
                      ? toolCall.tool_output
                      : JSON.stringify(toolCall.tool_output, null, 2)
                  }
                />
              </div>
            )}
            {props.isLLM && (
              <div className={cn('px-2.5 py-1')}>
                <CodeEditor
                  readOnly
                  title={<div>OBSERVATION</div>}
                  language={CodeLanguage.json}
                  value={props.observation ?? ''}
                />
              </div>
            )}
            {props.isLLM && (
              <div className={cn('px-2.5 py-1')}>
                <CodeEditor
                  readOnly
                  title={<div>{props.isFinal ? 'FINAL ANSWER' : 'THOUGHT'}</div>}
                  language={CodeLanguage.json}
                  value={props.finalAnswer ?? ''}
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
