'use client'
import type { FC } from 'react'
import React, { useCallback, useRef } from 'react'
import cn from 'classnames'
import copy from 'copy-to-clipboard'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import { useWorkflow } from '../../../../hooks'
import type { NodeOutPutVar } from '../../../../types'
import ToggleExpandBtn from '@/app/components/workflow/nodes/_base/components/toggle-expand-btn'
import useToggleExpend from '@/app/components/workflow/nodes/_base/hooks/use-toggle-expend'
import PromptEditorHeightResizeWrap from '@/app/components/app/configuration/config-prompt/prompt-editor-height-resize-wrap'
import PromptEditor from '@/app/components/base/prompt-editor'
import { Clipboard, ClipboardCheck } from '@/app/components/base/icons/src/vender/line/files'
import s from '@/app/components/app/configuration/config-prompt/style.module.css'
import { Trash03 } from '@/app/components/base/icons/src/vender/line/general'
import TooltipPlus from '@/app/components/base/tooltip-plus'

type Props = {
  title: string | JSX.Element
  value: string
  onChange: (value: string) => void
  readOnly?: boolean
  showRemove?: boolean
  onRemove?: () => void
  justVar?: boolean
  isChatModel?: boolean
  isChatApp?: boolean
  isShowContext?: boolean
  hasSetBlockStatus?: {
    context: boolean
    history: boolean
    query: boolean
  }
  nodesOutputVars?: NodeOutPutVar[]
}

const Editor: FC<Props> = ({
  title,
  value,
  onChange,
  readOnly,
  showRemove,
  onRemove,
  justVar,
  isChatModel,
  isChatApp,
  isShowContext,
  hasSetBlockStatus,
  nodesOutputVars,
}) => {
  const { t } = useTranslation()
  const { getNode } = useWorkflow()

  const isShowHistory = !isChatModel && isChatApp
  const isShowQuery = isShowHistory

  const ref = useRef<HTMLDivElement>(null)
  const {
    wrapClassName,
    isExpand,
    setIsExpand,
    editorExpandHeight,
  } = useToggleExpend({ ref })
  const minHeight = 98
  const [editorHeight, setEditorHeight] = React.useState(minHeight)
  const [isCopied, setIsCopied] = React.useState(false)
  const handleCopy = useCallback(() => {
    copy(value)
    setIsCopied(true)
  }, [value])

  const [isFocus, {
    setTrue: setFocus,
    setFalse: setBlur,
  }] = useBoolean(false)

  return (
    <div className={cn(wrapClassName)}>
      <div ref={ref} className={cn(isFocus ? s.gradientBorder : 'bg-gray-100', isExpand && 'h-full', '!rounded-[9px] p-0.5')}>
        <div className={cn(isFocus ? 'bg-gray-50' : 'bg-gray-100', isExpand && 'h-full flex flex-col', 'rounded-lg')}>
          <div className='pt-1 pl-3 pr-2 flex justify-between h-6 items-center'>
            <div className='leading-4 text-xs font-semibold text-gray-700 uppercase'>{title}</div>
            <div className='flex items-center'>
              <div className='leading-[18px] text-xs font-medium text-gray-500'>{value?.length || 0}</div>
              <div className='w-px h-3 ml-2 mr-2 bg-gray-200'></div>
              {/* Operations */}
              <div className='flex items-center space-x-2'>
                {showRemove && (
                  <Trash03 className='w-3.5 h-3.5 text-gray-500 cursor-pointer' onClick={onRemove} />
                )}
                {!isCopied
                  ? (
                    <Clipboard className='w-3.5 h-3.5 text-gray-500 cursor-pointer' onClick={handleCopy} />
                  )
                  : (
                    <ClipboardCheck className='mx-1 w-3.5 h-3.5 text-gray-500' />
                  )
                }
                <ToggleExpandBtn isExpand={isExpand} onExpandChange={setIsExpand} />
              </div>

            </div>
          </div>
          <PromptEditorHeightResizeWrap
            className={cn(isExpand && 'h-0 grow', 'px-3 min-h-[102px] overflow-y-auto text-sm text-gray-700')}
            height={isExpand ? editorExpandHeight : editorHeight}
            minHeight={minHeight}
            onHeightChange={setEditorHeight}
            footer={(
              <div className='pl-3 pb-2 flex'>
                {isFocus
                  ? (
                    <TooltipPlus
                      popupContent={`${t('workflow.common.insertVarTip')}`}
                    >
                      <div className="h-[18px] leading-[18px] px-1 rounded-md bg-gray-100 text-xs text-gray-500">{'{x} '}{t('workflow.nodes.common.insertVarTip')}</div>
                    </TooltipPlus>)
                  : <div className='h-[18px]'></div>}
              </div>
            )}
            hideResize={isExpand}
          >
            <>
              <PromptEditor
                className={cn('min-h-[84px]')}
                style={isExpand ? { height: editorExpandHeight - 5 } : {}}
                value={value}
                contextBlock={{
                  show: justVar ? false : isShowContext,
                  selectable: !hasSetBlockStatus?.context,
                  canNotAddContext: true,
                }}
                historyBlock={{
                  show: justVar ? false : isShowHistory,
                  selectable: !hasSetBlockStatus?.history,
                  history: {
                    user: 'Human',
                    assistant: 'Assistant',
                  },
                }}
                queryBlock={{
                  show: justVar ? false : isShowQuery,
                  selectable: !hasSetBlockStatus?.query,
                }}
                workflowVariableBlock={{
                  show: true,
                  variables: nodesOutputVars || [],
                  getWorkflowNode: getNode,
                }}
                onChange={onChange}
                onBlur={setBlur}
                onFocus={setFocus}
                editable={!readOnly}
              />
              {/* to patch Editor not support dynamic change editable status */}
              {readOnly && <div className='absolute inset-0 z-10'></div>}
            </>
          </PromptEditorHeightResizeWrap>
        </div>
      </div>
    </div>

  )
}
export default React.memo(Editor)
