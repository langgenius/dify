'use client'
import type { FC } from 'react'
import React, { useCallback, useRef } from 'react'
import cn from 'classnames'
import copy from 'copy-to-clipboard'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import { BlockEnum, EditionType } from '../../../../types'
import type {
  Node,
  NodeOutPutVar,
  Variable,
} from '../../../../types'

import Wrap from '../editor/wrap'
import { CodeLanguage } from '../../../code/types'
import ToggleExpandBtn from '@/app/components/workflow/nodes/_base/components/toggle-expand-btn'
import useToggleExpend from '@/app/components/workflow/nodes/_base/hooks/use-toggle-expend'
import PromptEditor from '@/app/components/base/prompt-editor'
import { Clipboard, ClipboardCheck } from '@/app/components/base/icons/src/vender/line/files'
import s from '@/app/components/app/configuration/config-prompt/style.module.css'
import { Trash03 } from '@/app/components/base/icons/src/vender/line/general'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { PROMPT_EDITOR_INSERT_QUICKLY } from '@/app/components/base/prompt-editor/plugins/update-block'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor/editor-support-vars'
import Switch from '@/app/components/base/switch'
import { Jinja } from '@/app/components/base/icons/src/vender/workflow'
import { useStore } from '@/app/components/workflow/store'

type Props = {
  className?: string
  headerClassName?: string
  instanceId?: string
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
  availableNodes?: Node[]
  // for jinja
  isSupportJinja?: boolean
  editionType?: EditionType
  onEditionTypeChange?: (editionType: EditionType) => void
  varList?: Variable[]
  handleAddVariable?: (payload: any) => void
}

const Editor: FC<Props> = ({
  className,
  headerClassName,
  instanceId,
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
  availableNodes = [],
  isSupportJinja,
  editionType,
  onEditionTypeChange,
  varList = [],
  handleAddVariable,
}) => {
  const { t } = useTranslation()
  const { eventEmitter } = useEventEmitterContextContext()
  const controlPromptEditorRerenderKey = useStore(s => s.controlPromptEditorRerenderKey)

  const isShowHistory = !isChatModel && isChatApp

  const ref = useRef<HTMLDivElement>(null)
  const {
    wrapClassName,
    wrapStyle,
    isExpand,
    setIsExpand,
    editorExpandHeight,
  } = useToggleExpend({ ref, isInNode: true })
  const [isCopied, setIsCopied] = React.useState(false)
  const handleCopy = useCallback(() => {
    copy(value)
    setIsCopied(true)
  }, [value])

  const [isFocus, {
    setTrue: setFocus,
    setFalse: setBlur,
  }] = useBoolean(false)

  const handleInsertVariable = () => {
    setFocus()
    eventEmitter?.emit({ type: PROMPT_EDITOR_INSERT_QUICKLY, instanceId } as any)
  }

  return (
    <Wrap className={cn(className, wrapClassName)} style={wrapStyle} isInNode isExpand={isExpand}>
      <div ref={ref} className={cn(isFocus ? s.gradientBorder : 'bg-gray-100', isExpand && 'h-full', '!rounded-[9px] p-0.5')}>
        <div className={cn(isFocus ? 'bg-gray-50' : 'bg-gray-100', isExpand && 'h-full flex flex-col', 'rounded-lg')}>
          <div className={cn(headerClassName, 'pt-1 pl-3 pr-2 flex justify-between h-6 items-center')}>
            <div className='leading-4 text-xs font-semibold text-gray-700 uppercase'>{title}</div>
            <div className='flex items-center'>
              <div className='leading-[18px] text-xs font-medium text-gray-500'>{value?.length || 0}</div>
              <div className='w-px h-3 ml-2 mr-2 bg-gray-200'></div>
              {/* Operations */}
              <div className='flex items-center space-x-2'>
                {isSupportJinja && (
                  <TooltipPlus
                    popupContent={
                      <div>
                        <div>{t('workflow.common.enableJinja')}</div>
                        <a className='text-[#155EEF]' target='_blank' href='https://jinja.palletsprojects.com/en/2.10.x/'>{t('workflow.common.learnMore')}</a>
                      </div>
                    }
                    hideArrow
                  >
                    <div className={cn(editionType === EditionType.jinja2 && 'border-black/5 bg-white', 'flex h-[22px] items-center px-1.5 rounded-[5px] border border-transparent hover:border-black/5 space-x-0.5')}>
                      <Jinja className='w-6 h-3 text-gray-300' />
                      <Switch
                        size='sm'
                        defaultValue={editionType === EditionType.jinja2}
                        onChange={(checked) => {
                          onEditionTypeChange?.(checked ? EditionType.jinja2 : EditionType.basic)
                        }}
                      />
                    </div>
                  </TooltipPlus>

                )}
                {!readOnly && (
                  <TooltipPlus
                    popupContent={`${t('workflow.common.insertVarTip')}`}
                  >
                    <Variable02 className='w-3.5 h-3.5 text-gray-500 cursor-pointer' onClick={handleInsertVariable} />
                  </TooltipPlus>
                )}
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

          {/* Min: 80 Max: 560. Header: 24 */}
          <div className={cn('pb-2', isExpand && 'flex flex-col grow')}>
            {!(isSupportJinja && editionType === EditionType.jinja2)
              ? (
                <div className={cn(isExpand ? 'grow' : 'max-h-[536px]', 'relative px-3 min-h-[56px]  overflow-y-auto')}>
                  <PromptEditor
                    key={controlPromptEditorRerenderKey}
                    instanceId={instanceId}
                    compact
                    className='min-h-[56px]'
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
                      show: false, // use [sys.query] instead of query block
                      selectable: false,
                    }}
                    workflowVariableBlock={{
                      show: true,
                      variables: nodesOutputVars || [],
                      workflowNodesMap: availableNodes.reduce((acc, node) => {
                        acc[node.id] = {
                          title: node.data.title,
                          type: node.data.type,
                        }
                        if (node.data.type === BlockEnum.Start) {
                          acc.sys = {
                            title: t('workflow.blocks.start'),
                            type: BlockEnum.Start,
                          }
                        }
                        return acc
                      }, {} as any),
                    }}
                    onChange={onChange}
                    onBlur={setBlur}
                    onFocus={setFocus}
                    editable={!readOnly}
                  />
                  {/* to patch Editor not support dynamic change editable status */}
                  {readOnly && <div className='absolute inset-0 z-10'></div>}
                </div>
              )
              : (
                <div className={cn(isExpand ? 'grow' : 'max-h-[536px]', 'relative px-3 min-h-[56px]  overflow-y-auto')}>
                  <CodeEditor
                    availableVars={nodesOutputVars || []}
                    varList={varList}
                    onAddVar={handleAddVariable}
                    isInNode
                    readOnly={readOnly}
                    language={CodeLanguage.python3}
                    value={value}
                    onChange={onChange}
                    noWrapper
                    isExpand={isExpand}
                  />
                </div>
              )}
          </div>
        </div>
      </div>
    </Wrap>

  )
}
export default React.memo(Editor)
