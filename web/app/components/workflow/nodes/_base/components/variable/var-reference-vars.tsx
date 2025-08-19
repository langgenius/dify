'use client'
import type { FC } from 'react'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useHover } from 'ahooks'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import { type NodeOutPutVar, type ValueSelector, type Var, VarType } from '@/app/components/workflow/types'
import { ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Input from '@/app/components/base/input'
import { checkKeys } from '@/utils/var'
import type { StructuredOutput } from '../../../llm/types'
import { Type } from '../../../llm/types'
import PickerStructurePanel from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/picker'
import { varTypeToStructType } from './utils'
import type { Field } from '@/app/components/workflow/nodes/llm/types'
import { FILE_STRUCT } from '@/app/components/workflow/constants'
import { noop } from 'lodash-es'
import { CodeAssistant, MagicEdit } from '@/app/components/base/icons/src/vender/line/general'
import { VariableIconWithColor } from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'

type ObjectChildrenProps = {
  nodeId: string
  title: string
  data: Var[]
  objPath: string[]
  onChange: (value: ValueSelector, item: Var) => void
  onHovering?: (value: boolean) => void
  itemWidth?: number
  isSupportFileVar?: boolean
}

type ItemProps = {
  nodeId: string
  title: string
  objPath: string[]
  itemData: Var
  onChange: (value: ValueSelector, item: Var) => void
  onHovering?: (value: boolean) => void
  itemWidth?: number
  isSupportFileVar?: boolean
  isException?: boolean
  isLoopVar?: boolean
  isFlat?: boolean
  isInCodeGeneratorInstructionEditor?: boolean
  zIndex?: number
  className?: string
}

const objVarTypes = [VarType.object, VarType.file]

const Item: FC<ItemProps> = ({
  nodeId,
  title,
  objPath,
  itemData,
  onChange,
  onHovering,
  isSupportFileVar,
  isException,
  isLoopVar,
  isFlat,
  isInCodeGeneratorInstructionEditor,
  zIndex,
  className,
}) => {
  const isStructureOutput = itemData.type === VarType.object && (itemData.children as StructuredOutput)?.schema?.properties
  const isFile = itemData.type === VarType.file && !isStructureOutput
  const isObj = ([VarType.object, VarType.file].includes(itemData.type) && itemData.children && (itemData.children as Var[]).length > 0)
  const isSys = itemData.variable.startsWith('sys.')
  const isEnv = itemData.variable.startsWith('env.')
  const isChatVar = itemData.variable.startsWith('conversation.')
  const flatVarIcon = useMemo(() => {
    if (!isFlat)
      return null
    const variable = itemData.variable
    let Icon
    switch (variable) {
      case 'current':
        Icon = isInCodeGeneratorInstructionEditor ? CodeAssistant : MagicEdit
        return <Icon className='h-3.5 w-3.5 shrink-0 text-util-colors-violet-violet-600' />
      case 'error_message':
        return <Variable02 className='h-3.5 w-3.5 shrink-0 text-util-colors-orange-dark-orange-dark-600' />
      default:
        return <Variable02 className='h-3.5 w-3.5 shrink-0 text-text-accent' />
    }
  }, [isFlat, isInCodeGeneratorInstructionEditor, itemData.variable])

  const varName = useMemo(() => {
    if (!isFlat)
      return itemData.variable
    if (itemData.variable === 'current')
      return isInCodeGeneratorInstructionEditor ? 'current_code' : 'current_prompt'
    return itemData.variable
  }, [isFlat, isInCodeGeneratorInstructionEditor, itemData.variable])

  const objStructuredOutput: StructuredOutput | null = useMemo(() => {
    if (!isObj) return null
    const properties: Record<string, Field> = {};
    (isFile ? FILE_STRUCT : (itemData.children as Var[])).forEach((c) => {
      properties[c.variable] = {
        type: varTypeToStructType(c.type),
      }
    })
    return {
      schema: {
        type: Type.object,
        properties,
        required: [],
        additionalProperties: false,
      },
    }
  }, [isFile, isObj, itemData.children])

  const structuredOutput = (() => {
    if (isStructureOutput)
      return itemData.children as StructuredOutput
    return objStructuredOutput
  })()

  const itemRef = useRef<HTMLDivElement>(null)
  const [isItemHovering, setIsItemHovering] = useState(false)
  useHover(itemRef, {
    onChange: (hovering) => {
      if (hovering) {
        setIsItemHovering(true)
      }
      else {
        if (isObj || isStructureOutput) {
          setTimeout(() => {
            setIsItemHovering(false)
          }, 100)
        }
        else {
          setIsItemHovering(false)
        }
      }
    },
  })
  const [isChildrenHovering, setIsChildrenHovering] = useState(false)
  const isHovering = isItemHovering || isChildrenHovering
  const open = (isObj || isStructureOutput) && isHovering
  useEffect(() => {
    onHovering && onHovering(isHovering)
  }, [isHovering])
  const handleChosen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isSupportFileVar && isFile)
      return

    if (isFlat) {
      onChange([itemData.variable], itemData)
    }
    else if (isSys || isEnv || isChatVar) { // system variable | environment variable | conversation variable
      onChange([...objPath, ...itemData.variable.split('.')], itemData)
    }
    else {
      onChange([nodeId, ...objPath, itemData.variable], itemData)
    }
  }
  const variableCategory = useMemo(() => {
    if (isEnv) return 'environment'
    if (isChatVar) return 'conversation'
    if (isLoopVar) return 'loop'
    return 'system'
  }, [isEnv, isChatVar, isSys, isLoopVar])
  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={noop}
      placement='left-start'
    >
      <PortalToFollowElemTrigger className='w-full'>
        <div
          ref={itemRef}
          className={cn(
            (isObj || isStructureOutput) ? ' pr-1' : 'pr-[18px]',
            isHovering && ((isObj || isStructureOutput) ? 'bg-components-panel-on-panel-item-bg-hover' : 'bg-state-base-hover'),
            'relative flex h-6 w-full cursor-pointer items-center rounded-md pl-3',
            className,
          )
          }
          onClick={handleChosen}
          onMouseDown={e => e.preventDefault()}
        >
          <div className='flex w-0 grow items-center'>
            {!isFlat && <VariableIconWithColor
              variableCategory={variableCategory}
              isExceptionVariable={isException}
            />}
            {isFlat && flatVarIcon}

            {!isEnv && !isChatVar && (
              <div title={itemData.variable} className='system-sm-medium ml-1 w-0 grow truncate text-text-secondary'>{varName}</div>
            )}
            {isEnv && (
              <div title={itemData.variable} className='system-sm-medium ml-1 w-0 grow truncate text-text-secondary'>{itemData.variable.replace('env.', '')}</div>
            )}
            {isChatVar && (
              <div title={itemData.des} className='system-sm-medium ml-1 w-0 grow truncate text-text-secondary'>{itemData.variable.replace('conversation.', '')}</div>
            )}
          </div>
          <div className='ml-1 shrink-0 text-xs font-normal capitalize text-text-tertiary'>{itemData.type}</div>
          {
            (isObj || isStructureOutput) && (
              <ChevronRight className={cn('ml-0.5 h-3 w-3 text-text-quaternary', isHovering && 'text-text-tertiary')} />
            )
          }
        </div >
      </PortalToFollowElemTrigger >
      <PortalToFollowElemContent style={{
        zIndex: zIndex || 100,
      }}>
        {(isStructureOutput || isObj) && (
          <PickerStructurePanel
            root={{ nodeId, nodeName: title, attrName: itemData.variable }}
            payload={structuredOutput!}
            onHovering={setIsChildrenHovering}
            onSelect={(valueSelector) => {
              onChange(valueSelector, itemData)
            }}
          />
        )}
      </PortalToFollowElemContent>
    </PortalToFollowElem >
  )
}

const ObjectChildren: FC<ObjectChildrenProps> = ({
  title,
  nodeId,
  objPath,
  data,
  onChange,
  onHovering,
  itemWidth,
  isSupportFileVar,
}) => {
  const currObjPath = objPath
  const itemRef = useRef<HTMLDivElement>(null)
  const [isItemHovering, setIsItemHovering] = useState(false)
  useHover(itemRef, {
    onChange: (hovering) => {
      if (hovering) {
        setIsItemHovering(true)
      }
      else {
        setTimeout(() => {
          setIsItemHovering(false)
        }, 100)
      }
    },
  })
  const [isChildrenHovering, setIsChildrenHovering] = useState(false)
  const isHovering = isItemHovering || isChildrenHovering
  useEffect(() => {
    onHovering && onHovering(isHovering)
  }, [isHovering])
  useEffect(() => {
    onHovering && onHovering(isItemHovering)
  }, [isItemHovering])
  // absolute top-[-2px]
  return (
    <div ref={itemRef} className=' space-y-1 rounded-lg border border-gray-200 bg-white shadow-lg' style={{
      right: itemWidth ? itemWidth - 10 : 215,
      minWidth: 252,
    }}>
      <div className='flex h-[22px] items-center px-3 text-xs font-normal text-gray-700'><span className='text-gray-500'>{title}.</span>{currObjPath.join('.')}</div>
      {
        (data && data.length > 0)
        && data.map((v, i) => (
          <Item
            key={i}
            nodeId={nodeId}
            title={title}
            objPath={objPath}
            itemData={v}
            onChange={onChange}
            onHovering={setIsChildrenHovering}
            isSupportFileVar={isSupportFileVar}
            isException={v.isException}
          />
        ))
      }
    </div>
  )
}

type Props = {
  hideSearch?: boolean
  searchBoxClassName?: string
  vars: NodeOutPutVar[]
  isSupportFileVar?: boolean
  onChange: (value: ValueSelector, item: Var) => void
  itemWidth?: number
  maxHeightClass?: string
  onClose?: () => void
  onBlur?: () => void
  zIndex?: number
  isInCodeGeneratorInstructionEditor?: boolean
  autoFocus?: boolean
}
const VarReferenceVars: FC<Props> = ({
  hideSearch,
  searchBoxClassName,
  vars,
  isSupportFileVar,
  onChange,
  itemWidth,
  maxHeightClass,
  onClose,
  onBlur,
  zIndex,
  isInCodeGeneratorInstructionEditor,
  autoFocus = true,
}) => {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose?.()
    }
  }

  const filteredVars = vars.filter((v) => {
    const children = v.vars.filter(v => checkKeys([v.variable], false).isValid || v.variable.startsWith('sys.') || v.variable.startsWith('env.') || v.variable.startsWith('conversation.'))
    return children.length > 0
  }).filter((node) => {
    if (!searchText)
      return node
    const children = node.vars.filter((v) => {
      const searchTextLower = searchText.toLowerCase()
      return v.variable.toLowerCase().includes(searchTextLower) || node.title.toLowerCase().includes(searchTextLower)
    })
    return children.length > 0
  }).map((node) => {
    let vars = node.vars.filter(v => checkKeys([v.variable], false).isValid || v.variable.startsWith('sys.') || v.variable.startsWith('env.') || v.variable.startsWith('conversation.'))
    if (searchText) {
      const searchTextLower = searchText.toLowerCase()
      if (!node.title.toLowerCase().includes(searchTextLower))
        vars = vars.filter(v => v.variable.toLowerCase().includes(searchText.toLowerCase()))
    }

    return {
      ...node,
      vars,
    }
  })

  return (
    <>
      {
        !hideSearch && (
          <>
            <div className={cn('var-search-input-wrapper mx-2 mb-2 mt-2', searchBoxClassName)} onClick={e => e.stopPropagation()}>
              <Input
                className='var-search-input'
                showLeftIcon
                showClearIcon
                value={searchText}
                placeholder={t('workflow.common.searchVar') || ''}
                onChange={e => setSearchText(e.target.value)}
                onKeyDown={handleKeyDown}
                onClear={() => setSearchText('')}
                onBlur={onBlur}
                autoFocus={autoFocus}
              />
            </div>
            <div className='relative left-[-4px] h-[0.5px] bg-black/5' style={{
              width: 'calc(100% + 8px)',
            }}></div>
          </>
        )
      }

      {filteredVars.length > 0
        ? <div className={cn('max-h-[85vh] overflow-y-auto', maxHeightClass)}>

          {
            filteredVars.map((item, i) => (
              <div key={i} className={cn(!item.isFlat && 'mt-3', i === 0 && item.isFlat && 'mt-2')}>
                {!item.isFlat && (
                  <div
                    className='system-xs-medium-uppercase truncate px-3 leading-[22px] text-text-tertiary'
                    title={item.title}
                  >{item.title}</div>
                )}
                {item.vars.map((v, j) => (
                  <Item
                    key={j}
                    title={item.title}
                    nodeId={item.nodeId}
                    objPath={[]}
                    itemData={v}
                    onChange={onChange}
                    itemWidth={itemWidth}
                    isSupportFileVar={isSupportFileVar}
                    isException={v.isException}
                    isLoopVar={item.isLoop}
                    isFlat={item.isFlat}
                    isInCodeGeneratorInstructionEditor={isInCodeGeneratorInstructionEditor}
                    zIndex={zIndex}
                  />
                ))}
                {item.isFlat && !filteredVars[i + 1]?.isFlat && !!filteredVars.find(item => !item.isFlat) && (
                  <div className='relative mt-[14px] flex  items-center space-x-1'>
                    <div className='h-0 w-3 shrink-0 border border-divider-subtle'></div>
                    <div className='system-2xs-semibold-uppercase text-text-tertiary'>{t('workflow.debug.lastOutput')}</div>
                    <div className='h-0  shrink-0 grow border border-divider-subtle'></div>
                  </div>
                )}
              </div>))
          }
        </div>
        : <div className='mt-2 pl-3 text-xs font-medium uppercase leading-[18px] text-gray-500'>{t('workflow.common.noVar')}</div>}
    </>
  )
}
export default React.memo(VarReferenceVars)
