'use client'
import type { FC, ReactNode } from 'react'
import React, { useCallback, useRef } from 'react'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import copy from 'copy-to-clipboard'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import { BlockEnum, EditionType } from '../../../../types'
import type {
  ModelConfig,
  Node,
  NodeOutPutVar,
  Variable,
} from '../../../../types'

import Wrap from '../editor/wrap'
import { CodeLanguage } from '../../../code/types'
import PromptGeneratorBtn from '../../../llm/components/prompt-generator-btn'
import cn from '@/utils/classnames'
import ToggleExpandBtn from '@/app/components/workflow/nodes/_base/components/toggle-expand-btn'
import useToggleExpend from '@/app/components/workflow/nodes/_base/hooks/use-toggle-expend'
import PromptEditor from '@/app/components/base/prompt-editor'
import {
  Copy,
  CopyCheck,
} from '@/app/components/base/icons/src/vender/line/files'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { PROMPT_EDITOR_INSERT_QUICKLY } from '@/app/components/base/prompt-editor/plugins/update-block'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor/editor-support-vars'
import Switch from '@/app/components/base/switch'
import { Jinja } from '@/app/components/base/icons/src/vender/workflow'
import { useStore } from '@/app/components/workflow/store'
import { useWorkflowVariableType } from '@/app/components/workflow/hooks'

type Props = {
  className?: string
  headerClassName?: string
  instanceId?: string
  nodeId?: string
  editorId?: string
  title: string | React.JSX.Element
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
  isSupportFileVar?: boolean
  isSupportPromptGenerator?: boolean
  onGenerated?: (prompt: string) => void
  modelConfig?: ModelConfig
  // for jinja
  isSupportJinja?: boolean
  editionType?: EditionType
  onEditionTypeChange?: (editionType: EditionType) => void
  varList?: Variable[]
  handleAddVariable?: (payload: any) => void
  containerBackgroundClassName?: string
  gradientBorder?: boolean
  titleTooltip?: ReactNode
  inputClassName?: string
  editorContainerClassName?: string
  placeholder?: string
  placeholderClassName?: string
  titleClassName?: string
  required?: boolean
}

const Editor: FC<Props> = ({
  className,
  headerClassName,
  instanceId,
  nodeId,
  editorId,
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
  isSupportFileVar,
  isSupportPromptGenerator,
  isSupportJinja,
  editionType,
  onEditionTypeChange,
  varList = [],
  handleAddVariable,
  onGenerated,
  modelConfig,
  containerBackgroundClassName: containerClassName,
  gradientBorder = true,
  titleTooltip,
  inputClassName,
  placeholder,
  placeholderClassName,
  titleClassName,
  editorContainerClassName,
  required,
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

  const getVarType = useWorkflowVariableType()
  const pipelineId = useStore(s => s.pipelineId)
  const setShowInputFieldPanel = useStore(s => s.setShowInputFieldPanel)

  return (
    <Wrap className={cn(className, wrapClassName)} style={wrapStyle} isInNode isExpand={isExpand}>
      <div ref={ref} className={cn(isFocus ? (gradientBorder && 'bg-gradient-to-r from-components-input-border-active-prompt-1 to-components-input-border-active-prompt-2') : 'bg-transparent', isExpand && 'h-full', '!rounded-[9px] p-0.5', containerClassName)}>
        <div className={cn(isFocus ? 'bg-background-default' : 'bg-components-input-bg-normal', isExpand && 'flex h-full flex-col', 'rounded-lg', containerClassName)}>
          <div className={cn('flex items-center justify-between pl-3 pr-2 pt-1', headerClassName)}>
            <div className='flex gap-2'>
              <div className={cn('text-xs font-semibold uppercase leading-4 text-text-secondary', titleClassName)}>{title} {required && <span className='text-text-destructive'>*</span>}</div>
              {titleTooltip && <Tooltip popupContent={titleTooltip} />}
            </div>
            <div className='flex items-center'>
              <div className='text-xs font-medium leading-[18px] text-text-tertiary'>{value?.length || 0}</div>
              {isSupportPromptGenerator && (
                <PromptGeneratorBtn
                  nodeId={nodeId!}
                  editorId={editorId}
                  className='ml-[5px]'
                  onGenerated={onGenerated}
                  modelConfig={modelConfig}
                  currentPrompt={value}
                />
              )}

              <div className='ml-2 mr-2 h-3 w-px bg-divider-regular'></div>
              {/* Operations */}
              <div className='flex items-center space-x-[2px]'>
                {isSupportJinja && (
                  <Tooltip
                    popupContent={
                      <div>
                        <div>{t('workflow.common.enableJinja')}</div>
                        <a className='text-text-accent' target='_blank' href='https://jinja.palletsprojects.com/en/2.10.x/'>{t('workflow.common.learnMore')}</a>
                      </div>
                    }
                  >
                    <div className={cn(editionType === EditionType.jinja2 && 'border-components-button-ghost-bg-hover bg-components-button-ghost-bg-hover', 'flex h-[22px] items-center space-x-0.5 rounded-[5px] border border-transparent px-1.5 hover:border-components-button-ghost-bg-hover')}>
                      <Jinja className='h-3 w-6 text-text-quaternary' />
                      <Switch
                        size='sm'
                        defaultValue={editionType === EditionType.jinja2}
                        onChange={(checked) => {
                          onEditionTypeChange?.(checked ? EditionType.jinja2 : EditionType.basic)
                        }}
                      />
                    </div>
                  </Tooltip>

                )}
                {!readOnly && (
                  <Tooltip
                    popupContent={`${t('workflow.common.insertVarTip')}`}
                  >
                    <ActionButton onClick={handleInsertVariable}>
                      <Variable02 className='h-4 w-4' />
                    </ActionButton>
                  </Tooltip>
                )}
                {showRemove && (
                  <ActionButton onClick={onRemove}>
                    <RiDeleteBinLine className='h-4 w-4' />
                  </ActionButton>
                )}
                {!isCopied
                  ? (
                    <ActionButton onClick={handleCopy}>
                      <Copy className='h-4 w-4' />
                    </ActionButton>
                  )
                  : (
                    <ActionButton>
                      <CopyCheck className='h-4 w-4' />
                    </ActionButton>
                  )
                }
                <ToggleExpandBtn isExpand={isExpand} onExpandChange={setIsExpand} />
              </div>

            </div>
          </div>

          {/* Min: 80 Max: 560. Header: 24 */}
          <div className={cn('pb-2', isExpand && 'flex grow flex-col')}>
            {!(isSupportJinja && editionType === EditionType.jinja2)
              ? (
                <div className={cn(isExpand ? 'grow' : 'max-h-[536px]', 'relative min-h-[56px] overflow-y-auto  px-3', editorContainerClassName)}>
                  <PromptEditor
                    key={controlPromptEditorRerenderKey}
                    placeholder={placeholder}
                    placeholderClassName={placeholderClassName}
                    instanceId={instanceId}
                    compact
                    className={cn('min-h-[56px]', inputClassName)}
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
                      getVarType: getVarType as any,
                      workflowNodesMap: availableNodes.reduce((acc, node) => {
                        acc[node.id] = {
                          title: node.data.title,
                          type: node.data.type,
                          width: node.width,
                          height: node.height,
                          position: node.position,
                        }
                        if (node.data.type === BlockEnum.Start) {
                          acc.sys = {
                            title: t('workflow.blocks.start'),
                            type: BlockEnum.Start,
                          }
                        }
                        return acc
                      }, {} as any),
                      showManageInputField: !!pipelineId,
                      onManageInputField: () => setShowInputFieldPanel?.(true),
                    }}
                    onChange={onChange}
                    onBlur={setBlur}
                    onFocus={setFocus}
                    editable={!readOnly}
                    isSupportFileVar={isSupportFileVar}
                  />
                  {/* to patch Editor not support dynamic change editable status */}
                  {readOnly && <div className='absolute inset-0 z-10'></div>}
                </div>
              )
              : (
                <div className={cn(isExpand ? 'grow' : 'max-h-[536px]', 'relative min-h-[56px] overflow-y-auto  px-3', editorContainerClassName)}>
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
                    className={inputClassName}
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
