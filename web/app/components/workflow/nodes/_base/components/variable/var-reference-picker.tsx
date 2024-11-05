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

  const { isEnv, isChatVar, isValidVar } = useMemo(() => {
    const isEnv = isENV(value as ValueSelector)
    const isChatVar = isConversationVar(value as ValueSelector)
    const isValidVar = Boolean(outputVarNode) || isEnv || isChatVar
    return {
      isEnv,
      isChatVar,
      isValidVar,
    }
  }, [value, outputVarNode])

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
        }} className='!flex group/picker-trigger-wrap relative'>
          <>
            {isAddBtnTrigger
              ? (
                <div>
                  <AddButton onClick={() => { }}></AddButton>
                </div>
              )
              : (<div ref={!isSupportConstantValue ? triggerRef : null} className={cn((open || isFocus) ? 'border-gray-300' : 'border-gray-100', 'relative group/wrap flex items-center w-full h-8', !isSupportConstantValue && 'p-1 rounded-lg bg-gray-100 border', isInTable && 'bg-transparent border-none')}>
                {isSupportConstantValue
                  ? <div onClick={(e) => {
                    e.stopPropagation()
                    setOpen(false)
                    setControlFocus(Date.now())
                  }} className='h-full mr-1 flex items-center space-x-1'>
                    <TypeSelector
                      noLeft
                      trigger={
                        <div className='flex items-center h-8 px-2 radius-md bg-components-input-bg-normal'>
                          <div className='mr-1 system-sm-regular text-components-input-text-filled'>{varKindTypes.find(item => item.value === varKindType)?.label}</div>
                          <RiArrowDownSLine className='w-4 h-4 text-text-quaternary' />
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
                    <Variable02 className='w-3.5 h-3.5 text-gray-400' />
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
                      className='grow h-full'
                    >
                      <div ref={isSupportConstantValue ? triggerRef : null} className={cn('h-full', isSupportConstantValue && 'flex items-center pl-1 py-1 rounded-lg bg-gray-100')}>
                        <Tooltip popupContent={!isValidVar && hasValue && t('workflow.errorMsg.invalidVariable')}>
                          <div className={cn('h-full items-center px-1.5 rounded-[5px]', hasValue ? 'bg-white inline-flex' : 'flex')}>
                            {hasValue
                              ? (
                                <>
                                  {isShowNodeName && !isEnv && !isChatVar && (
                                    <div className='flex items-center'>
                                      <div className='px-[1px] h-3'>
                                        {outputVarNode?.type && <VarBlockIcon
                                          className='!text-gray-900'
                                          type={outputVarNode.type}
                                        />}
                                      </div>
                                      <div className='mx-0.5 text-xs font-medium text-gray-700 truncate' title={outputVarNode?.title} style={{
                                        maxWidth: maxNodeNameWidth,
                                      }}>{outputVarNode?.title}</div>
                                      <Line3 className='mr-0.5'></Line3>
                                    </div>
                                  )}
                                  <div className='flex items-center text-primary-600'>
                                    {!hasValue && <Variable02 className='w-3.5 h-3.5' />}
                                    {isEnv && <Env className='w-3.5 h-3.5 text-util-colors-violet-violet-600' />}
                                    {isChatVar && <BubbleX className='w-3.5 h-3.5 text-util-colors-teal-teal-700' />}
                                    <div className={cn('ml-0.5 text-xs font-medium truncate', (isEnv || isChatVar) && '!text-text-secondary')} title={varName} style={{
                                      maxWidth: maxVarNameWidth,
                                    }}>{varName}</div>
                                  </div>
                                  <div className='ml-0.5 text-xs font-normal text-gray-500 capitalize truncate' title={type} style={{
                                    maxWidth: maxTypeWidth,
                                  }}>{type}</div>
                                  {!isValidVar && <RiErrorWarningFill className='ml-0.5 w-3 h-3 text-[#D92D20]' />}
                                </>
                              )
                              : <div className='text-[13px] font-normal text-gray-400'>{t('workflow.common.setVarValuePlaceholder')}</div>}
                          </div>
                        </Tooltip>
                      </div>

                    </VarPickerWrap>
                  )}
                {(hasValue && !readonly && !isInTable) && (<div
                  className='invisible group-hover/wrap:visible absolute h-5 right-1 top-[50%] translate-y-[-50%] group p-1 rounded-md hover:bg-black/5 cursor-pointer'
                  onClick={handleClearVar}
                >
                  <RiCloseLine className='w-3.5 h-3.5 text-gray-500 group-hover:text-gray-800' />
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
                className='group-hover/picker-trigger-wrap:block hidden absolute right-1 top-0.5'
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
          zIndex: 100,
        }}>
          {!isConstant && (
            <VarReferencePopup
              vars={outputVars}
              onChange={handleVarReferenceChange}
              itemWidth={isAddBtnTrigger ? 260 : triggerWidth}
            />
          )}
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div >
  )
}
export default React.memo(VarReferencePicker)
