'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowDownSLine,
  RiCloseLine,
  RiErrorWarningFill,
  RiLoader4Line,
  RiMoreLine,
} from '@remixicon/react'
import { produce } from 'immer'
import {
  useNodes,
  useReactFlow,
  useStoreApi,
} from 'reactflow'
import RemoveButton from '../remove-button'
import useAvailableVarList from '../../hooks/use-available-var-list'
import VarReferencePopup from './var-reference-popup'
import { getNodeInfoById, isConversationVar, isENV, isRagVariableVar, isSystemVar, removeFileVars, varTypeToStructType } from './utils'
import ConstantField from './constant-field'
import cn from '@/utils/classnames'
import type { CommonNodeType, Node, NodeOutPutVar, ToolWithProvider, ValueSelector, Var } from '@/app/components/workflow/types'
import type { CredentialFormSchemaSelect } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { type CredentialFormSchema, type FormOption, FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { BlockEnum } from '@/app/components/workflow/types'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import {
  useIsChatMode,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import TypeSelector from '@/app/components/workflow/nodes/_base/components/selector'
import AddButton from '@/app/components/base/button/add-button'
import Badge from '@/app/components/base/badge'
import Tooltip from '@/app/components/base/tooltip'
import { isExceptionVariable } from '@/app/components/workflow/utils'
import VarFullPathPanel from './var-full-path-panel'
import { noop } from 'lodash-es'
import { useFetchDynamicOptions } from '@/service/use-plugins'
import type { Tool } from '@/app/components/tools/types'
import { VariableIconWithColor } from '@/app/components/workflow/nodes/_base/components/variable/variable-label'

const TRIGGER_DEFAULT_WIDTH = 227

type Props = {
  className?: string
  nodeId: string
  isShowNodeName?: boolean
  readonly: boolean
  value: ValueSelector | string
  onChange: (value: ValueSelector | string, varKindType: VarKindType, varInfo?: Var) => void
  onOpen?: () => void
  isSupportConstantValue?: boolean
  defaultVarKindType?: VarKindType
  onlyLeafNodeVar?: boolean
  filterVar?: (payload: Var, valueSelector: ValueSelector) => boolean
  isFilterFileVar?: boolean
  availableNodes?: Node[]
  availableVars?: NodeOutPutVar[]
  isAddBtnTrigger?: boolean
  schema?: Partial<CredentialFormSchema>
  valueTypePlaceHolder?: string
  isInTable?: boolean
  onRemove?: () => void
  typePlaceHolder?: string
  isSupportFileVar?: boolean
  placeholder?: string
  minWidth?: number
  popupFor?: 'assigned' | 'toAssigned'
  zIndex?: number
  currentTool?: Tool
  currentProvider?: ToolWithProvider
  preferSchemaType?: boolean
}

const DEFAULT_VALUE_SELECTOR: Props['value'] = []

const VarReferencePicker: FC<Props> = ({
  nodeId,
  readonly,
  className,
  isShowNodeName = true,
  value = DEFAULT_VALUE_SELECTOR,
  onOpen = noop,
  onChange,
  isSupportConstantValue,
  defaultVarKindType = VarKindType.constant,
  onlyLeafNodeVar,
  filterVar = () => true,
  isFilterFileVar,
  availableNodes: passedInAvailableNodes,
  availableVars: passedInAvailableVars,
  isAddBtnTrigger,
  schema,
  valueTypePlaceHolder,
  isInTable,
  onRemove,
  typePlaceHolder,
  isSupportFileVar = true,
  placeholder,
  minWidth,
  popupFor,
  zIndex,
  currentTool,
  currentProvider,
  preferSchemaType,
}) => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const nodes = useNodes<CommonNodeType>()
  const isChatMode = useIsChatMode()
  const { getCurrentVariableType } = useWorkflowVariables()
  const { availableVars, availableNodesWithParent: availableNodes } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar,
    passedInAvailableNodes,
    filterVar,
  })

  const reactflow = useReactFlow()

  const startNode = availableNodes.find((node: Node) => {
    return node.data.type === BlockEnum.Start
  })

  const node = nodes.find(n => n.id === nodeId)
  const isInIteration = !!(node?.data as any)?.isInIteration
  const iterationNode = isInIteration ? nodes.find(n => n.id === node?.parentId) : null

  const isInLoop = !!(node?.data as any)?.isInLoop
  const loopNode = isInLoop ? nodes.find(n => n.id === node?.parentId) : null

  const triggerRef = useRef<HTMLDivElement>(null)
  const [triggerWidth, setTriggerWidth] = useState(TRIGGER_DEFAULT_WIDTH)
  useEffect(() => {
    if (triggerRef.current)
      setTriggerWidth(triggerRef.current.clientWidth)
  }, [triggerRef.current])

  const [varKindType, setVarKindType] = useState<VarKindType>(defaultVarKindType)
  const isConstant = isSupportConstantValue && varKindType === VarKindType.constant

  const outputVars = useMemo(() => {
    const results = passedInAvailableVars || availableVars
    return isFilterFileVar ? removeFileVars(results) : results
  }, [passedInAvailableVars, availableVars, isFilterFileVar])

  const [open, setOpen] = useState(false)
  useEffect(() => {
    onOpen()
  }, [open])
  const hasValue = !isConstant && value.length > 0

  const isIterationVar = useMemo(() => {
    if (!isInIteration)
      return false
    if (value[0] === node?.parentId && ['item', 'index'].includes(value[1]))
      return true
    return false
  }, [isInIteration, value, node])

  const isLoopVar = useMemo(() => {
    if (!isInLoop)
      return false
    if (value[0] === node?.parentId && ['item', 'index'].includes(value[1]))
      return true
    return false
  }, [isInLoop, value, node])

  const outputVarNodeId = hasValue ? value[0] : ''
  const outputVarNode = useMemo(() => {
    if (!hasValue || isConstant)
      return null

    if (isIterationVar)
      return iterationNode?.data

    if (isLoopVar)
      return loopNode?.data

    if (isSystemVar(value as ValueSelector))
      return startNode?.data

    const node = getNodeInfoById(availableNodes, outputVarNodeId)?.data
    if (node) {
      return {
        ...node,
        id: outputVarNodeId,
      }
    }
  }, [value, hasValue, isConstant, isIterationVar, iterationNode, availableNodes, outputVarNodeId, startNode, isLoopVar, loopNode])

  const isShowAPart = (value as ValueSelector).length > 2 && !isRagVariableVar((value as ValueSelector))

  const varName = useMemo(() => {
    if (!hasValue)
      return ''

    const isSystem = isSystemVar(value as ValueSelector)
    const varName = Array.isArray(value) ? value[(value as ValueSelector).length - 1] : ''
    return `${isSystem ? 'sys.' : ''}${varName}`
  }, [hasValue, value])

  const varKindTypes = [
    {
      label: 'Variable',
      value: VarKindType.variable,
    },
    {
      label: 'Constant',
      value: VarKindType.constant,
    },
  ]

  const handleVarKindTypeChange = useCallback((value: VarKindType) => {
    setVarKindType(value)
    if (value === VarKindType.constant)
      onChange('', value)
    else
      onChange([], value)
  }, [onChange])

  const inputRef = useRef<HTMLInputElement>(null)
  const [isFocus, setIsFocus] = useState(false)
  const [controlFocus, setControlFocus] = useState(0)
  useEffect(() => {
    if (controlFocus && inputRef.current) {
      inputRef.current.focus()
      setIsFocus(true)
    }
  }, [controlFocus])

  const handleVarReferenceChange = useCallback((value: ValueSelector, varInfo: Var) => {
    // sys var not passed to backend
    const newValue = produce(value, (draft) => {
      if (draft[1] && draft[1].startsWith('sys.')) {
        draft.shift()
        const paths = draft[0].split('.')
        paths.forEach((p, i) => {
          draft[i] = p
        })
      }
    })
    onChange(newValue, varKindType, varInfo)
    setOpen(false)
  }, [onChange, varKindType])

  const handleClearVar = useCallback(() => {
    if (varKindType === VarKindType.constant)
      onChange('', varKindType)
    else
      onChange([], varKindType)
  }, [onChange, varKindType])

  const handleVariableJump = useCallback((nodeId: string) => {
    const currentNodeIndex = availableNodes.findIndex(node => node.id === nodeId)
    const currentNode = availableNodes[currentNodeIndex]

    const workflowContainer = document.getElementById('workflow-container')
    const {
      clientWidth,
      clientHeight,
    } = workflowContainer!
    const {
      setViewport,
    } = reactflow
    const { transform } = store.getState()
    const zoom = transform[2]
    const position = currentNode.position
    setViewport({
      x: (clientWidth - 400 - currentNode.width! * zoom) / 2 - position.x * zoom,
      y: (clientHeight - currentNode.height! * zoom) / 2 - position.y * zoom,
      zoom: transform[2],
    })
  }, [availableNodes, reactflow, store])

  const type = getCurrentVariableType({
    parentNode: (isInIteration ? iterationNode : loopNode) as any,
    valueSelector: value as ValueSelector,
    availableNodes,
    isChatMode,
    isConstant: !!isConstant,
    preferSchemaType,
  })

  const { isEnv, isChatVar, isRagVar, isValidVar, isException } = useMemo(() => {
    const isEnv = isENV(value as ValueSelector)
    const isChatVar = isConversationVar(value as ValueSelector)
    const isRagVar = isRagVariableVar(value as ValueSelector)
    const isValidVar = Boolean(outputVarNode) || isEnv || isChatVar || isRagVar
    const isException = isExceptionVariable(varName, outputVarNode?.type)
    return {
      isEnv,
      isChatVar,
      isRagVar,
      isValidVar,
      isException,
    }
  }, [value, outputVarNode, varName])

  // 8(left/right-padding) + 14(icon) + 4 + 14 + 2 = 42 + 17 buff
  const availableWidth = triggerWidth - 56
  const [maxNodeNameWidth, maxVarNameWidth, maxTypeWidth] = (() => {
    const totalTextLength = ((outputVarNode?.title || '') + (varName || '') + (type || '')).length
    const PRIORITY_WIDTH = 15
    const maxNodeNameWidth = PRIORITY_WIDTH + Math.floor((outputVarNode?.title?.length || 0) / totalTextLength * availableWidth)
    const maxVarNameWidth = -PRIORITY_WIDTH + Math.floor((varName?.length || 0) / totalTextLength * availableWidth)
    const maxTypeWidth = Math.floor((type?.length || 0) / totalTextLength * availableWidth)
    return [maxNodeNameWidth, maxVarNameWidth, maxTypeWidth]
  })()

  const WrapElem = isSupportConstantValue ? 'div' : PortalToFollowElemTrigger
  const VarPickerWrap = !isSupportConstantValue ? 'div' : PortalToFollowElemTrigger

  const tooltipPopup = useMemo(() => {
    if (isValidVar && isShowAPart) {
      return (
        <VarFullPathPanel
          nodeName={outputVarNode?.title}
          path={(value as ValueSelector).slice(1)}
          varType={varTypeToStructType(type)}
          nodeType={outputVarNode?.type}
        />)
    }
    if (!isValidVar && hasValue)
      return t('workflow.errorMsg.invalidVariable')

    return null
  }, [isValidVar, isShowAPart, hasValue, t, outputVarNode?.title, outputVarNode?.type, value, type])

  const [dynamicOptions, setDynamicOptions] = useState<FormOption[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const { mutateAsync: fetchDynamicOptions } = useFetchDynamicOptions(
    currentProvider?.plugin_id || '', currentProvider?.name || '', currentTool?.name || '', (schema as CredentialFormSchemaSelect)?.variable || '',
    'tool',
  )
  const handleFetchDynamicOptions = async () => {
    if (schema?.type !== FormTypeEnum.dynamicSelect || !currentTool || !currentProvider)
      return
    setIsLoading(true)
    try {
      const data = await fetchDynamicOptions()
      setDynamicOptions(data?.options || [])
    }
    finally {
      setIsLoading(false)
    }
  }
  useEffect(() => {
    handleFetchDynamicOptions()
  }, [currentTool, currentProvider, schema])

  const schemaWithDynamicSelect = useMemo(() => {
    if (schema?.type !== FormTypeEnum.dynamicSelect)
      return schema
    // rewrite schema.options with dynamicOptions
    if (dynamicOptions) {
      return {
        ...schema,
        options: dynamicOptions,
      }
    }

    // If we don't have dynamic options but we have a selected value, create a temporary option to preserve the selection during loading
    if (isLoading && value && typeof value === 'string') {
      const preservedOptions = [{
        value,
        label: { en_US: value, zh_Hans: value },
        show_on: [],
      }]
      return {
        ...schema,
        options: preservedOptions,
      }
    }

    // Default case: return schema with empty options
    return {
      ...schema,
      options: [],
    }
  }, [schema, dynamicOptions, isLoading, value])

  const variableCategory = useMemo(() => {
    if (isEnv) return 'environment'
    if (isChatVar) return 'conversation'
    if (isLoopVar) return 'loop'
    if (isRagVar) return 'rag'
    return 'system'
  }, [isEnv, isChatVar, isLoopVar, isRagVar])

  return (
    <div className={cn(className, !readonly && 'cursor-pointer')}>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement={isAddBtnTrigger ? 'bottom-end' : 'bottom-start'}
      >
        <WrapElem onClick={() => {
          if (readonly)
            return
          if (!isConstant)
            setOpen(!open)
          else
            setControlFocus(Date.now())
        }} className='group/picker-trigger-wrap relative !flex'>
          <>
            {isAddBtnTrigger
              ? (
                <div>
                  <AddButton onClick={noop}></AddButton>
                </div>
              )
              : (<div ref={!isSupportConstantValue ? triggerRef : null} className={cn((open || isFocus) ? 'border-gray-300' : 'border-gray-100', 'group/wrap relative flex h-8 w-full items-center', !isSupportConstantValue && 'rounded-lg bg-components-input-bg-normal p-1', isInTable && 'border-none bg-transparent', readonly && 'bg-components-input-bg-disabled')}>
                {isSupportConstantValue
                  ? <div onClick={(e) => {
                    e.stopPropagation()
                    setOpen(false)
                    setControlFocus(Date.now())
                  }} className='mr-1 flex h-full items-center space-x-1'>
                    <TypeSelector
                      noLeft
                      trigger={
                        <div className='radius-md flex h-8 items-center bg-components-input-bg-normal px-2'>
                          <div className='system-sm-regular mr-1 text-components-input-text-filled'>{varKindTypes.find(item => item.value === varKindType)?.label}</div>
                          <RiArrowDownSLine className='h-4 w-4 text-text-quaternary' />
                        </div>
                      }
                      popupClassName='top-8'
                      readonly={readonly}
                      value={varKindType}
                      options={varKindTypes}
                      onChange={handleVarKindTypeChange}
                      showChecked
                    />
                  </div>
                  : (!hasValue && <div className='ml-1.5 mr-1'>
                    <Variable02 className={`h-4 w-4 ${readonly ? 'text-components-input-text-disabled' : 'text-components-input-text-placeholder'}`} />
                  </div>)}
                {isConstant
                  ? (
                    <ConstantField
                      value={value as string}
                      onChange={onChange as ((value: string | number, varKindType: VarKindType, varInfo?: Var) => void)}
                      schema={schemaWithDynamicSelect as CredentialFormSchema}
                      readonly={readonly}
                      isLoading={isLoading}
                    />
                  )
                  : (
                    <VarPickerWrap
                      onClick={() => {
                        if (readonly)
                          return
                        if (!isConstant)
                          setOpen(!open)
                        else
                          setControlFocus(Date.now())
                      }}
                      className='h-full grow'
                    >
                      <div ref={isSupportConstantValue ? triggerRef : null} className={cn('h-full', isSupportConstantValue && 'flex items-center rounded-lg bg-components-panel-bg py-1 pl-1')}>
                        <Tooltip noDecoration={isShowAPart} popupContent={tooltipPopup}>
                          <div className={cn('h-full items-center rounded-[5px] px-1.5', hasValue ? 'inline-flex bg-components-badge-white-to-dark' : 'flex')}>
                            {hasValue
                              ? (
                                <>
                                  {isShowNodeName && !isEnv && !isChatVar && !isRagVar && (
                                    <div className='flex items-center' onClick={(e) => {
                                      if (e.metaKey || e.ctrlKey) {
                                        e.stopPropagation()
                                        handleVariableJump(outputVarNode?.id)
                                      }
                                    }}>
                                      <div className='h-3 px-[1px]'>
                                        {outputVarNode?.type && <VarBlockIcon
                                          className='!text-text-primary'
                                          type={outputVarNode.type}
                                        />}
                                      </div>
                                      <div className='mx-0.5 truncate text-xs font-medium text-text-secondary' title={outputVarNode?.title} style={{
                                        maxWidth: maxNodeNameWidth,
                                      }}>{outputVarNode?.title}</div>
                                      <Line3 className='mr-0.5'></Line3>
                                    </div>
                                  )}
                                  {isShowAPart && (
                                    <div className='flex items-center'>
                                      <RiMoreLine className='h-3 w-3 text-text-secondary' />
                                      <Line3 className='mr-0.5 text-divider-deep'></Line3>
                                    </div>
                                  )}
                                  <div className='flex items-center text-text-accent'>
                                    {isLoading && <RiLoader4Line className='h-3.5 w-3.5 animate-spin text-text-secondary' />}
                                    <VariableIconWithColor
                                      variableCategory={variableCategory}
                                      isExceptionVariable={isException}
                                    />
                                    <div className={cn('ml-0.5 truncate text-xs font-medium', isEnv && '!text-text-secondary', isChatVar && 'text-util-colors-teal-teal-700', isException && 'text-text-warning')} title={varName} style={{
                                      maxWidth: maxVarNameWidth,
                                    }}>{varName}</div>
                                  </div>
                                  <div className='system-xs-regular ml-0.5 truncate text-center capitalize text-text-tertiary' title={type} style={{
                                    maxWidth: maxTypeWidth,
                                  }}>{type}</div>
                                  {!isValidVar && <RiErrorWarningFill className='ml-0.5 h-3 w-3 text-text-destructive' />}
                                </>
                              )
                              : <div className={`overflow-hidden ${readonly ? 'text-components-input-text-disabled' : 'text-components-input-text-placeholder'} system-sm-regular text-ellipsis`}>
                                {isLoading ? (
                                  <div className='flex items-center'>
                                    <RiLoader4Line className='mr-1 h-3.5 w-3.5 animate-spin text-text-secondary' />
                                    <span>{placeholder ?? t('workflow.common.setVarValuePlaceholder')}</span>
                                  </div>
                                ) : (
                                  placeholder ?? t('workflow.common.setVarValuePlaceholder')
                                )}
                              </div>}
                          </div>
                        </Tooltip>
                      </div>

                    </VarPickerWrap>
                  )}
                {(hasValue && !readonly && !isInTable) && (<div
                  className='group invisible absolute right-1 top-[50%] h-5 translate-y-[-50%] cursor-pointer rounded-md p-1 hover:bg-state-base-hover group-hover/wrap:visible'
                  onClick={handleClearVar}
                >
                  <RiCloseLine className='h-3.5 w-3.5 text-text-tertiary group-hover:text-text-secondary' />
                </div>)}
                {!hasValue && valueTypePlaceHolder && (
                  <Badge
                    className=' absolute right-1 top-[50%] translate-y-[-50%] capitalize'
                    text={valueTypePlaceHolder}
                    uppercase={false}
                  />
                )}
              </div>)}
            {!readonly && isInTable && (
              <RemoveButton
                className='absolute right-1 top-0.5 hidden group-hover/picker-trigger-wrap:block'
                onClick={() => onRemove?.()}
              />
            )}

            {!hasValue && typePlaceHolder && (
              <Badge
                className='absolute right-2 top-1.5'
                text={typePlaceHolder}
                uppercase={false}
              />
            )}
          </>
        </WrapElem>
        <PortalToFollowElemContent style={{
          zIndex: zIndex || 100,
        }} className='mt-1'>
          {!isConstant && (
            <VarReferencePopup
              vars={outputVars}
              popupFor={popupFor}
              onChange={handleVarReferenceChange}
              itemWidth={isAddBtnTrigger ? 260 : (minWidth || triggerWidth)}
              isSupportFileVar={isSupportFileVar}
              zIndex={zIndex}
              preferSchemaType={preferSchemaType}
            />
          )}
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div >
  )
}
export default React.memo(VarReferencePicker)
