'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import cn from 'classnames'
import { isArray } from 'lodash-es'
import VarReferencePopup from './var-reference-popup'
import { toNodeOutputVars } from './utils'
import type { ValueSelector } from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
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
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'

type Props = {
  className?: string
  width?: number
  nodeId: string
  isShowNodeName: boolean
  readonly: boolean
  value: ValueSelector | string
  onChange: (value: ValueSelector | string, varKindType: VarKindType) => void
  isSupportConstantValue?: boolean
  defaultVarKindType?: VarKindType
  onlyLeafNodeVar?: boolean
  onlyVarType?: VarType
}

export const getNodeInfoById = (nodes: any, id: string) => {
  if (!isArray(nodes))
    return

  return nodes.find((node: any) => node.id === id)
}

const VarReferencePicker: FC<Props> = ({
  nodeId,
  width,
  readonly,
  className,
  isShowNodeName,
  value,
  onChange,
  isSupportConstantValue,
  defaultVarKindType = VarKindType.static,
  onlyLeafNodeVar,
  onlyVarType,
}) => {
  const isChatMode = useIsChatMode()
  const [varKindType, setVarKindType] = useState<VarKindType>(defaultVarKindType)
  const isConstant = isSupportConstantValue && varKindType === VarKindType.static
  const { getTreeLeafNodes, getBeforeNodesInSameBranch } = useWorkflow()
  const availableNodes = onlyLeafNodeVar ? getTreeLeafNodes() : getBeforeNodesInSameBranch(nodeId)
  const outputVars = toNodeOutputVars(availableNodes, isChatMode, onlyVarType)
  const [open, setOpen] = useState(false)
  const hasValue = !isConstant && value.length > 0
  const outputVarNodeId = hasValue ? value[0] : ''
  const outputVarNode = hasValue ? getNodeInfoById(availableNodes, outputVarNodeId)?.data : null
  const varName = hasValue ? value[value.length - 1] : ''

  const getVarType = () => {
    if (isConstant)
      return 'undefined'

    const targetVar = outputVars.find(v => v.nodeId === outputVarNodeId)
    if (!targetVar)
      return 'undefined'

    let type: VarType = VarType.string
    let curr: any = targetVar.vars;
    (value as ValueSelector).slice(1).forEach((key, i) => {
      const isLast = i === value.length - 2
      curr = curr.find((v: any) => v.variable === key)
      if (isLast) {
        type = curr.type
      }
      else {
        if (curr.type === VarType.object)
          curr = curr.children
      }
    })
    return type
  }

  const varKindTypes = [
    {
      label: 'Variable',
      value: VarKindType.selector,
    },
    {
      label: 'Constant',
      value: VarKindType.static,
    },
  ]

  const handleVarKindTypeChange = useCallback((value: VarKindType) => {
    setVarKindType(value)
    if (value === VarKindType.static)
      onChange('', value)
    else
      onChange([], value)
  }, [varKindType])
  const inputRef = useRef<HTMLInputElement>(null)
  const [isFocus, setIsFocus] = useState(false)
  const [controlFocus, setControlFocus] = useState(0)
  useEffect(() => {
    if (controlFocus && inputRef.current) {
      inputRef.current.focus()
      setIsFocus(true)
    }
  }, [controlFocus])

  const handleStaticChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value as string, varKindType)
  }, [onChange, varKindType])

  return (
    <div className={cn(className, !readonly && 'cursor-pointer')}>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement='bottom-start'
      >
        <PortalToFollowElemTrigger onClick={() => !isConstant ? setOpen(!open) : setControlFocus(Date.now())} className='!flex'>
          <div className={cn((open || isFocus) && 'border border-gray-300', 'flex items-center w-full h-8 p-1 rounded-lg bg-gray-100')}>
            {isSupportConstantValue
              ? <div onClick={(e) => {
                e.stopPropagation()
                setOpen(false)
                setControlFocus(Date.now())
              }} className='mr-1 flex items-center space-x-1'>
                <TypeSelector
                  noLeft
                  triggerClassName='!text-xs'
                  DropDownIcon={ChevronDown}
                  value={varKindType}
                  options={varKindTypes}
                  onChange={handleVarKindTypeChange}
                />
                <div className='h-4 w-px bg-black/5'></div>
              </div>
              : <div className='ml-1.5 mr-1'>
                <Variable02 className='w-3.5 h-3.5 text-gray-400' />
              </div>}
            {isConstant
              ? (
                <input
                  type='text'
                  className='w-full h-8 leading-8 pl-0.5 bg-transparent text-[13px] font-normal text-gray-900 placeholder:text-gray-400 focus:outline-none'
                  value={isConstant ? value : ''}
                  onChange={handleStaticChange}
                  onFocus={() => setIsFocus(true)}
                  onBlur={() => setIsFocus(false)}
                />
              )
              : (
                <div className={cn('inline-flex h-full items-center px-1.5 rounded-[5px]', hasValue && 'bg-white')}>
                  {hasValue && (
                    <>
                      {isShowNodeName && (
                        <div className='flex items-center'>
                          <div className='p-[1px]'>
                            <VarBlockIcon
                              className='!text-gray-900'
                              type={outputVarNode?.type}
                            />
                          </div>
                          <div className='mx-0.5 text-xs font-medium text-gray-700'>{outputVarNode?.title}</div>
                          <Line3 className='mr-0.5'></Line3>
                        </div>
                      )}
                      <div className='flex items-center text-primary-600'>
                        <Variable02 className='w-3.5 h-3.5' />
                        <div className='ml-0.5 text-xs font-medium'>{varName}</div>
                      </div>
                      <div className='ml-0.5 text-xs font-normal text-gray-500 capitalize'>{getVarType()}</div>
                    </>
                  )}
                </div>
              )}
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent style={{
          zIndex: 100,
          minWidth: 227,
        }}>
          {!isConstant && (
            <VarReferencePopup
              vars={outputVars}
              onChange={(value) => {
                onChange(value, varKindType)
                setOpen(false)
              }}
              itemWidth={width}
            />
          )}
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div >
  )
}
export default React.memo(VarReferencePicker)
