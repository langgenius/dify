'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowDownSLine,
  RiCloseLine,
  RiErrorWarningFill,
} from '@remixicon/react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'
import RemoveButton from '../remove-button'
import useAvailableVarList from '../../hooks/use-available-var-list'
import VarReferencePopup from './var-reference-popup'
import { getNodeInfoById, isConversationVar, isENV, isSystemVar } from './utils'
import ConstantField from './constant-field'
import cn from '@/utils/classnames'
import type { Node, NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { BlockEnum } from '@/app/components/workflow/types'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { BubbleX, Env } from '@/app/components/base/icons/src/vender/line/others'
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
}

const VarReferencePicker: FC<Props> = ({
  nodeId,
  readonly,
  className,
  isShowNodeName = true,
  value = [],
  onOpen = () => { },
  onChange,
  isSupportConstantValue,
  defaultVarKindType = VarKindType.constant,
  onlyLeafNodeVar,
  filterVar = () => true,
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
}) => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const {
    getNodes,
  } = store.getState()
  const isChatMode = useIsChatMode()

  const { getCurrentVariableType } = useWorkflowVariables()
  const { availableNodes, availableVars } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar,
    passedInAvailableNodes,
    filterVar,
  })
  const startNode = availableNodes.find((node: any) => {
    return node.data.type === BlockEnum.Start
  })

  const node = getNodes().find(n => n.id === nodeId)
  const isInIteration = !!node?.data.isInIteration
  const iterationNode = isInIteration ? getNodes().find(n => n.id === node.parentId) : null

  const triggerRef = useRef<HTMLDivElement>(null)
  const [triggerWidth, setTriggerWidth] = useState(TRIGGER_DEFAULT_WIDTH)
  useEffect(() => {
    if (triggerRef.current)
      setTriggerWidth(triggerRef.current.clientWidth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerRef.current])

  const [varKindType, setVarKindType] = useState<VarKindType>(defaultVarKindType)
  const isConstant = isSupportConstantValue && varKindType === VarKindType.constant

  const outputVars = useMemo(() => (passedInAvailableVars || availableVars), [passedInAvailableVars, availableVars])

  const [open, setOpen] = useState(false)
  useEffect(() => {
    onOpen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const hasValue = !isConstant && value.length > 0

  const isIterationVar = useMemo(() => {
    if (!isInIteration)
      return false
    if (value[0] === node?.parentId && ['item', 'index'].includes(value[1]))
      return true
    return false
  }, [isInIteration, value, node])

  const outputVarNodeId = hasValue ? value[0] : ''
  const outputVarNode = useMemo(() => {
    if (!hasValue || isConstant)
      return null

    if (isIterationVar)
      return iterationNode?.data

    if (isSystemVar(value as ValueSelector))
      return startNode?.data

    return getNodeInfoById(availableNodes, outputVarNodeId)?.data
  }, [value, hasValue, isConstant, isIterationVar, iterationNode, availableNodes, outputVarNodeId, startNode])

  const varName = useMemo(() => {
    if (hasValue) {
      const isSystem = isSystemVar(value as ValueSelector)
      let varName = ''
      if (Array.isArray(value))
        varName = value.length >= 3 ? (value as ValueSelector).slice(-2).join('.') : value[value.length - 1]

      return `${isSystem ? 'sys.' : ''}${varName}`
    }
    return ''
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

  const type = getCurrentVariableType({
    parentNode: iterationNode,
    valueSelector: value as ValueSelector,
    availableNodes,
    isChatMode,
    isConstant: !!isConstant,
  })

  const { isEnv, isChatVar, isValidVar, isException } = useMemo(() => {
    const isEnv = isENV(value as ValueSelector)
    const isChatVar = isConversationVar(value as ValueSelector)
    const isValidVar = Boolean(outputVarNode) || isEnv || isChatVar
    const isException = isExceptionVariable(varName, outputVarNode?.type)
    return {
      isEnv,
      isChatVar,
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
          !isConstant ? setOpen(!open) : setControlFocus(Date.now())
        }} className='group/picker-trigger-wrap relative !flex'>
          <>
            {isAddBtnTrigger
              ? (
                <div>
                  <AddButton onClick={() => { }}></AddButton>
                </div>
              )
              : (<div ref={!isSupportConstantValue ? triggerRef : null} className={cn((open || isFocus) ? 'border-gray-300' : 'border-gray-100', 'group/wrap relative flex h-8 w-full items-center', !isSupportConstantValue && 'bg-components-input-bg-normal rounded-lg p-1', isInTable && 'border-none bg-transparent', readonly && 'bg-components-input-bg-disabled')}>
                {isSupportConstantValue
                  ? <div onClick={(e) => {
                    e.stopPropagation()
                    setOpen(false)
                    setControlFocus(Date.now())
                  }} className='mr-1 flex h-full items-center space-x-1'>
                    <TypeSelector
                      noLeft
                      trigger={
                        <div className='radius-md bg-components-input-bg-normal flex h-8 items-center px-2'>
                          <div className='system-sm-regular text-components-input-text-filled mr-1'>{varKindTypes.find(item => item.value === varKindType)?.label}</div>
                          <RiArrowDownSLine className='text-text-quaternary h-4 w-4' />
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
                      schema={schema as CredentialFormSchema}
                      readonly={readonly}
                    />
                  )
                  : (
                    <VarPickerWrap
                      onClick={() => {
                        if (readonly)
                          return
                        !isConstant ? setOpen(!open) : setControlFocus(Date.now())
                      }}
                      className='h-full grow'
                    >
                      <div ref={isSupportConstantValue ? triggerRef : null} className={cn('h-full', isSupportConstantValue && 'flex items-center rounded-lg bg-gray-100 py-1 pl-1')}>
                        <Tooltip popupContent={!isValidVar && hasValue && t('workflow.errorMsg.invalidVariable')}>
                          <div className={cn('h-full items-center rounded-[5px] px-1.5', hasValue ? 'inline-flex bg-white' : 'flex')}>
                            {hasValue
                              ? (
                                <>
                                  {isShowNodeName && !isEnv && !isChatVar && (
                                    <div className='flex items-center'>
                                      <div className='h-3 px-[1px]'>
                                        {outputVarNode?.type && <VarBlockIcon
                                          className='!text-gray-900'
                                          type={outputVarNode.type}
                                        />}
                                      </div>
                                      <div className='mx-0.5 truncate text-xs font-medium text-gray-700' title={outputVarNode?.title} style={{
                                        maxWidth: maxNodeNameWidth,
                                      }}>{outputVarNode?.title}</div>
                                      <Line3 className='mr-0.5'></Line3>
                                    </div>
                                  )}
                                  <div className='text-primary-600 flex items-center'>
                                    {!hasValue && <Variable02 className='h-3.5 w-3.5' />}
                                    {isEnv && <Env className='text-util-colors-violet-violet-600 h-3.5 w-3.5' />}
                                    {isChatVar && <BubbleX className='text-util-colors-teal-teal-700 h-3.5 w-3.5' />}
                                    <div className={cn('ml-0.5 truncate text-xs font-medium', isEnv && '!text-text-secondary', isChatVar && 'text-util-colors-teal-teal-700', isException && 'text-text-warning')} title={varName} style={{
                                      maxWidth: maxVarNameWidth,
                                    }}>{varName}</div>
                                  </div>
                                  <div className='text-text-tertiary system-xs-regular ml-0.5 truncate text-center capitalize' title={type} style={{
                                    maxWidth: maxTypeWidth,
                                  }}>{type}</div>
                                  {!isValidVar && <RiErrorWarningFill className='ml-0.5 h-3 w-3 text-[#D92D20]' />}
                                </>
                              )
                              : <div className={`overflow-hidden ${readonly ? 'text-components-input-text-disabled' : 'text-components-input-text-placeholder'} system-sm-regular text-ellipsis`}>{placeholder ?? t('workflow.common.setVarValuePlaceholder')}</div>}
                          </div>
                        </Tooltip>
                      </div>

                    </VarPickerWrap>
                  )}
                {(hasValue && !readonly && !isInTable) && (<div
                  className='group invisible absolute right-1 top-[50%] h-5 translate-y-[-50%] cursor-pointer rounded-md p-1 hover:bg-black/5 group-hover/wrap:visible'
                  onClick={handleClearVar}
                >
                  <RiCloseLine className='h-3.5 w-3.5 text-gray-500 group-hover:text-gray-800' />
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
            />
          )}
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div >
  )
}
export default React.memo(VarReferencePicker)
