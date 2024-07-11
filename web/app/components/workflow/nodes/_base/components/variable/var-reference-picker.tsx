'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowDownSLine,
  RiCloseLine,
} from '@remixicon/react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'
import VarReferencePopup from './var-reference-popup'
import { getNodeInfoById, getVarType, isSystemVar, toNodeAvailableVars } from './utils'
import cn from '@/utils/classnames'
import type { Node, NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
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
  useWorkflow,
} from '@/app/components/workflow/hooks'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import TypeSelector from '@/app/components/workflow/nodes/_base/components/selector'
import AddButton from '@/app/components/base/button/add-button'
const TRIGGER_DEFAULT_WIDTH = 227

type Props = {
  className?: string
  nodeId: string
  isShowNodeName: boolean
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
}

const VarReferencePicker: FC<Props> = ({
  nodeId,
  readonly,
  className,
  isShowNodeName,
  value,
  onOpen = () => { },
  onChange,
  isSupportConstantValue,
  defaultVarKindType = VarKindType.constant,
  onlyLeafNodeVar,
  filterVar = () => true,
  availableNodes: passedInAvailableNodes,
  availableVars,
  isAddBtnTrigger,
}) => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const {
    getNodes,
  } = store.getState()
  const isChatMode = useIsChatMode()

  const { getTreeLeafNodes, getBeforeNodesInSameBranch } = useWorkflow()
  const availableNodes = useMemo(() => {
    return passedInAvailableNodes || (onlyLeafNodeVar ? getTreeLeafNodes(nodeId) : getBeforeNodesInSameBranch(nodeId))
  }, [getBeforeNodesInSameBranch, getTreeLeafNodes, nodeId, onlyLeafNodeVar, passedInAvailableNodes])
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

  const outputVars = useMemo(() => {
    if (availableVars)
      return availableVars

    const vars = toNodeAvailableVars({
      parentNode: iterationNode,
      t,
      beforeNodes: availableNodes,
      isChatMode,
      filterVar,
    })

    return vars
  }, [iterationNode, availableNodes, isChatMode, filterVar, availableVars, t])

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
      const varName = value.length >= 3 ? (value as ValueSelector).slice(-2).join('.') : value[value.length - 1]
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
      if (draft[1] && draft[1].startsWith('sys')) {
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

  const handleStaticChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value as string, varKindType)
  }, [onChange, varKindType])

  const handleClearVar = useCallback(() => {
    if (varKindType === VarKindType.constant)
      onChange('', varKindType)
    else
      onChange([], varKindType)
  }, [onChange, varKindType])

  const type = getVarType({
    parentNode: iterationNode,
    valueSelector: value as ValueSelector,
    availableNodes,
    isChatMode,
    isConstant: !!isConstant,
  })

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

  return (
    <div className={cn(className, !readonly && 'cursor-pointer')}>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement={isAddBtnTrigger ? 'bottom-end' : 'bottom-start'}
      >
        <PortalToFollowElemTrigger onClick={() => {
          if (readonly)
            return
          !isConstant ? setOpen(!open) : setControlFocus(Date.now())
        }} className='!flex'>
          {isAddBtnTrigger
            ? (
              <div>
                <AddButton onClick={() => { }}></AddButton>
              </div>
            )
            : (<div ref={triggerRef} className={cn((open || isFocus) ? 'border-gray-300' : 'border-gray-100', 'relative group/wrap flex items-center w-full h-8 p-1 rounded-lg bg-gray-100 border')}>
              {isSupportConstantValue
                ? <div onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                  setControlFocus(Date.now())
                }} className='mr-1 flex items-center space-x-1'>
                  <TypeSelector
                    noLeft
                    triggerClassName='!text-xs'
                    readonly={readonly}
                    DropDownIcon={RiArrowDownSLine}
                    value={varKindType}
                    options={varKindTypes}
                    onChange={handleVarKindTypeChange}
                  />
                  <div className='h-4 w-px bg-black/5'></div>
                </div>
                : (!hasValue && <div className='ml-1.5 mr-1'>
                  <Variable02 className='w-3.5 h-3.5 text-gray-400' />
                </div>)}
              {isConstant
                ? (
                  <input
                    type='text'
                    className='w-full h-8 leading-8 pl-0.5 bg-transparent text-[13px] font-normal text-gray-900 placeholder:text-gray-400 focus:outline-none overflow-hidden'
                    value={isConstant ? value : ''}
                    onChange={handleStaticChange}
                    onFocus={() => setIsFocus(true)}
                    onBlur={() => setIsFocus(false)}
                    readOnly={readonly}
                  />
                )
                : (
                  <div className={cn('inline-flex h-full items-center px-1.5 rounded-[5px]', hasValue && 'bg-white')}>
                    {hasValue
                      ? (
                        <>
                          {isShowNodeName && (
                            <div className='flex items-center'>
                              <div className='p-[1px]'>
                                <VarBlockIcon
                                  className='!text-gray-900'
                                  type={outputVarNode?.type || BlockEnum.Start}
                                />
                              </div>
                              <div className='mx-0.5 text-xs font-medium text-gray-700 truncate' title={outputVarNode?.title} style={{
                                maxWidth: maxNodeNameWidth,
                              }}>{outputVarNode?.title}</div>
                              <Line3 className='mr-0.5'></Line3>
                            </div>
                          )}
                          <div className='flex items-center text-primary-600'>
                            {!hasValue && <Variable02 className='w-3.5 h-3.5' />}
                            <div className='ml-0.5 text-xs font-medium truncate' title={varName} style={{
                              maxWidth: maxVarNameWidth,
                            }}>{varName}</div>
                          </div>
                          <div className='ml-0.5 text-xs font-normal text-gray-500 capitalize truncate' title={type} style={{
                            maxWidth: maxTypeWidth,
                          }}>{type}</div>
                        </>
                      )
                      : <div className='text-[13px] font-normal text-gray-400'>{t('workflow.common.setVarValuePlaceholder')}</div>}
                  </div>
                )}
              {(hasValue && !readonly) && (<div
                className='invisible group-hover/wrap:visible absolute h-5 right-1 top-[50%] translate-y-[-50%] group p-1 rounded-md hover:bg-black/5 cursor-pointer'
                onClick={handleClearVar}
              >
                <RiCloseLine className='w-3.5 h-3.5 text-gray-500 group-hover:text-gray-800' />
              </div>)}
            </div>)}
        </PortalToFollowElemTrigger>
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
