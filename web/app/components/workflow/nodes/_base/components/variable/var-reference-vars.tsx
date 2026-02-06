'use client'
import type { FC } from 'react'
import type { StructuredOutput } from '../../../llm/types'
import type { Field } from '@/app/components/workflow/nodes/llm/types'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { useHover, useLatest } from 'ahooks'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'
import { AssembleVariables, CodeAssistant, MagicEdit } from '@/app/components/base/icons/src/vender/line/general'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import Input from '@/app/components/base/input'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { VAR_SHOW_NAME_MAP } from '@/app/components/workflow/constants'
import PickerStructurePanel from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/picker'
import { VariableIconWithColor } from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { VarType } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
import { checkKeys } from '@/utils/var'
import { Type } from '../../../llm/types'
import ManageInputField from './manage-input-field'
import { isSpecialVar, varTypeToStructType } from './utils'

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
  preferSchemaType?: boolean
  isHighlighted?: boolean
  onSetHighlight?: () => void
  registerRef?: (element: HTMLDivElement | null) => void
}

const buildValueSelector = ({
  nodeId,
  objPath,
  itemData,
  isFlat,
}: {
  nodeId: string
  objPath: string[]
  itemData: Var
  isFlat?: boolean
}): ValueSelector => {
  if (isFlat)
    return [itemData.variable]
  const isSys = itemData.variable.startsWith('sys.')
  const isEnv = itemData.variable.startsWith('env.')
  const isChatVar = itemData.variable.startsWith('conversation.')
  const isRagVariable = itemData.isRagVariable
  if (isSys || isEnv || isChatVar || isRagVariable)
    return [...objPath, ...itemData.variable.split('.')]
  return [nodeId, ...objPath, itemData.variable]
}

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
  preferSchemaType,
  isHighlighted,
  onSetHighlight,
  registerRef,
}) => {
  const isStructureOutput = itemData.type === VarType.object && (itemData.children as StructuredOutput)?.schema?.properties
  const isFile = itemData.type === VarType.file && !isStructureOutput
  const isObj = ([VarType.object, VarType.file].includes(itemData.type) && itemData.children && (itemData.children as Var[]).length > 0)
  const isSys = itemData.variable.startsWith('sys.')
  const isEnv = itemData.variable.startsWith('env.')
  const isChatVar = itemData.variable.startsWith('conversation.')
  const isRagVariable = itemData.isRagVariable
  const flatVarIcon = useMemo(() => {
    if (!isFlat)
      return null
    const variable = itemData.variable
    let Icon
    switch (variable) {
      case 'current':
        Icon = isInCodeGeneratorInstructionEditor ? CodeAssistant : MagicEdit
        return <Icon className="h-3.5 w-3.5 shrink-0 text-util-colors-violet-violet-600" />
      case 'error_message':
        return <Variable02 className="h-3.5 w-3.5 shrink-0 text-util-colors-orange-dark-orange-dark-600" />
      default:
        return <Variable02 className="h-3.5 w-3.5 shrink-0 text-text-accent" />
    }
  }, [isFlat, isInCodeGeneratorInstructionEditor, itemData.variable])

  const varName = useMemo(() => {
    if (VAR_SHOW_NAME_MAP[itemData.variable])
      return VAR_SHOW_NAME_MAP[itemData.variable]

    if (!isFlat)
      return itemData.variable
    if (itemData.variable === 'current')
      return isInCodeGeneratorInstructionEditor ? 'current_code' : 'current_prompt'

    return itemData.variable
  }, [isFlat, isInCodeGeneratorInstructionEditor, itemData.variable])

  const objStructuredOutput: StructuredOutput | null = useMemo(() => {
    if (!isObj)
      return null
    const properties: Record<string, Field> = {}
    const childrenVars = (itemData.children as Var[]) || []
    childrenVars.forEach((c) => {
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
  }, [isObj, itemData.children])

  const structuredOutput = (() => {
    if (isStructureOutput)
      return itemData.children as StructuredOutput
    return objStructuredOutput
  })()

  const itemRef = useRef<HTMLDivElement>(null)
  const setItemRef = useCallback((element: HTMLDivElement | null) => {
    itemRef.current = element
    registerRef?.(element)
  }, [registerRef])
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
    onHovering?.(isHovering)
  }, [isHovering])
  const handleChosen = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    if (!isSupportFileVar && isFile)
      return

    onChange(buildValueSelector({
      nodeId,
      objPath,
      itemData,
      isFlat,
    }), itemData)
  }
  const variableCategory = useMemo(() => {
    if (isEnv)
      return 'environment'
    if (isChatVar)
      return 'conversation'
    if (isLoopVar)
      return 'loop'
    if (isRagVariable)
      return 'rag'
    return 'system'
  }, [isEnv, isChatVar, isSys, isLoopVar, isRagVariable])
  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={noop}
      placement="left-start"
    >
      <PortalToFollowElemTrigger className="w-full">
        <div
          ref={setItemRef}
          className={cn(
            (isObj || isStructureOutput) ? 'pr-1' : 'pr-[18px]',
            (isHovering || isHighlighted) && ((isObj || isStructureOutput) ? 'bg-components-panel-on-panel-item-bg-hover' : 'bg-state-base-hover'),
            'relative flex h-6 w-full cursor-pointer items-center rounded-md pl-3',
            className,
          )}
          onClick={handleChosen}
          onMouseEnter={onSetHighlight}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            e.nativeEvent.stopImmediatePropagation()
          }}
        >
          <div className="flex w-0 grow items-center">
            {!isFlat && (
              <VariableIconWithColor
                variables={itemData.variable.split('.')}
                variableCategory={variableCategory}
                isExceptionVariable={isException}
              />
            )}
            {isFlat && flatVarIcon}

            {!isEnv && !isChatVar && !isRagVariable && (
              <div title={itemData.variable} className="system-sm-medium ml-1 w-0 grow truncate text-text-secondary">{varName}</div>
            )}
            {isEnv && (
              <div title={itemData.variable} className="system-sm-medium ml-1 w-0 grow truncate text-text-secondary">{itemData.variable.replace('env.', '')}</div>
            )}
            {isChatVar && (
              <div title={itemData.des} className="system-sm-medium ml-1 w-0 grow truncate text-text-secondary">{itemData.variable.replace('conversation.', '')}</div>
            )}
            {isRagVariable && (
              <div title={itemData.des} className="system-sm-medium ml-1 w-0 grow truncate text-text-secondary">{itemData.variable.split('.').slice(-1)[0]}</div>
            )}
          </div>
          <div className="ml-1 shrink-0 text-xs font-normal capitalize text-text-tertiary">{(preferSchemaType && itemData.schemaType) ? itemData.schemaType : itemData.type}</div>
          {
            (isObj || isStructureOutput) && (
              <ChevronRight className={cn('ml-0.5 h-3 w-3 text-text-quaternary', isHovering && 'text-text-tertiary')} />
            )
          }
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{
        zIndex: zIndex || 100,
      }}
      >
        {(isStructureOutput || isObj) && (
          <PickerStructurePanel
            root={{ nodeId, nodeName: title, attrName: itemData.variable, attrAlias: itemData.schemaType }}
            payload={structuredOutput!}
            onHovering={setIsChildrenHovering}
            onSelect={(valueSelector) => {
              onChange(valueSelector, itemData)
            }}
          />
        )}
      </PortalToFollowElemContent>
    </PortalToFollowElem>
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
  showManageInputField?: boolean
  onManageInputField?: () => void
  showAssembleVariables?: boolean
  onAssembleVariables?: () => ValueSelector | null
  autoFocus?: boolean
  preferSchemaType?: boolean
  externalSearchText?: string
  enableKeyboardNavigation?: boolean
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
  showManageInputField,
  onManageInputField,
  showAssembleVariables,
  onAssembleVariables,
  autoFocus = true,
  preferSchemaType,
  externalSearchText,
  enableKeyboardNavigation = false,
}) => {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const normalizedSearchText = externalSearchText === undefined ? searchText : externalSearchText
  const normalizedSearchTextTrimmed = normalizedSearchText.trim()
  const normalizedSearchTextLower = normalizedSearchTextTrimmed.toLowerCase()
  const shouldShowSearchInput = !hideSearch && externalSearchText === undefined

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose?.()
    }
  }

  const handleAssembleVariables = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onAssembleVariables?.()
    onClose?.()
  }

  const validatedVars = useMemo(() => {
    const res: NodeOutPutVar[] = []
    vars.forEach((node) => {
      const nodeVars = node.vars.filter(v => checkKeys([v.variable], false).isValid || isSpecialVar(v.variable.split('.')[0]))
      if (nodeVars.length === 0)
        return
      res.push({
        ...node,
        vars: nodeVars,
      })
    })
    return res
  }, [vars])

  const filteredVars = useMemo(() => {
    if (!normalizedSearchTextTrimmed)
      return validatedVars
    const res: NodeOutPutVar[] = []
    validatedVars.forEach((node) => {
      const titleLower = node.title.toLowerCase()
      const matchedByTitle = titleLower.includes(normalizedSearchTextLower)
      const nodeVars = matchedByTitle
        ? node.vars
        : node.vars.filter(v => v.variable.toLowerCase().includes(normalizedSearchTextLower))
      if (nodeVars.length === 0)
        return
      res.push({
        ...node,
        vars: nodeVars,
      })
    })
    return res
  }, [normalizedSearchTextLower, normalizedSearchTextTrimmed, validatedVars])

  const flatItems = useMemo(() => {
    const items: Array<{ node: NodeOutPutVar, itemData: Var }> = []
    filteredVars.forEach((node) => {
      node.vars.forEach((itemData) => {
        items.push({ node, itemData })
      })
    })
    return items
  }, [filteredVars])
  const [activeIndex, setActiveIndex] = useState(-1)
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  const lastInteractionRef = useRef<'keyboard' | 'mouse' | 'filter' | null>(null)
  const resolvedActiveIndex = useMemo(() => {
    if (!enableKeyboardNavigation || flatItems.length === 0)
      return -1
    if (activeIndex < 0 || activeIndex >= flatItems.length)
      return 0
    return activeIndex
  }, [activeIndex, enableKeyboardNavigation, flatItems.length])
  const flatItemsRef = useLatest(flatItems)
  const activeIndexRef = useLatest(resolvedActiveIndex)
  const onCloseRef = useLatest(onClose)

  useEffect(() => {
    itemRefs.current = []
  }, [flatItems.length])

  const handleHighlightIndex = useCallback((index: number, source: 'keyboard' | 'mouse' | 'filter') => {
    lastInteractionRef.current = source
    setActiveIndex(index)
  }, [])

  useEffect(() => {
    if (!enableKeyboardNavigation || flatItems.length === 0) {
      lastInteractionRef.current = 'filter'
      return
    }
    if (activeIndex < 0 || activeIndex >= flatItems.length)
      lastInteractionRef.current = 'filter'
  }, [activeIndex, enableKeyboardNavigation, flatItems.length])

  useEffect(() => {
    if (!enableKeyboardNavigation || resolvedActiveIndex < 0)
      return
    if (lastInteractionRef.current !== 'keyboard')
      return
    const target = itemRefs.current[resolvedActiveIndex]
    if (target)
      target.scrollIntoView({ block: 'nearest' })
    lastInteractionRef.current = null
  }, [enableKeyboardNavigation, flatItems.length, resolvedActiveIndex])

  const handleSelectItem = useCallback((item: { node: NodeOutPutVar, itemData: Var }) => {
    const isStructureOutput = item.itemData.type === VarType.object
      && (item.itemData.children as StructuredOutput | undefined)?.schema?.properties
    const isFile = item.itemData.type === VarType.file && !isStructureOutput
    if (!isSupportFileVar && isFile)
      return
    const valueSelector = buildValueSelector({
      nodeId: item.node.nodeId,
      objPath: [],
      itemData: item.itemData,
      isFlat: item.node.isFlat,
    })
    onChange(valueSelector, item.itemData)
    onClose?.()
  }, [onChange, onClose, isSupportFileVar])

  useEffect(() => {
    if (!enableKeyboardNavigation)
      return
    const handleKeyDown = (event: KeyboardEvent) => {
      const items = flatItemsRef.current
      if (items.length === 0)
        return
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key))
        return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        onCloseRef.current?.()
        return
      }
      if (event.key === 'Enter') {
        const index = activeIndexRef.current
        if (index < 0 || index >= items.length)
          return
        handleSelectItem(items[index])
        return
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1
      const baseIndex = activeIndexRef.current < 0 ? 0 : activeIndexRef.current
      const nextIndex = Math.min(Math.max(baseIndex + delta, 0), items.length - 1)
      handleHighlightIndex(nextIndex, 'keyboard')
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [enableKeyboardNavigation, handleHighlightIndex, handleSelectItem])

  let runningIndex = -1

  return (
    <>
      {
        shouldShowSearchInput && (
          <>
            <div className={cn('var-search-input-wrapper mx-2 mb-2 mt-2', searchBoxClassName)} onClick={e => e.stopPropagation()}>
              <Input
                className="var-search-input"
                showLeftIcon
                showClearIcon
                value={searchText}
                placeholder={t('common.searchVar', { ns: 'workflow' }) || ''}
                onChange={e => setSearchText(e.target.value)}
                onKeyDown={handleKeyDown}
                onClear={() => setSearchText('')}
                onBlur={onBlur}
                autoFocus={autoFocus}
              />
            </div>
            <div
              className="relative left-[-4px] h-[0.5px] bg-black/5"
              style={{
                width: 'calc(100% + 8px)',
              }}
            >
            </div>
          </>
        )
      }

      {
        showAssembleVariables && onAssembleVariables && (
          <div className="flex items-center border-t border-divider-subtle pt-1">
            <button
              type="button"
              className="flex h-6 w-full items-center rounded-md pl-3 pr-[18px] text-text-secondary hover:bg-state-base-hover"
              onClick={handleAssembleVariables}
              onMouseDown={e => e.preventDefault()}
            >
              <span className="mr-1 flex h-4 w-4 items-center justify-center rounded bg-util-colors-blue-blue-500">
                <AssembleVariables className="h-3 w-3 text-text-primary-on-surface" />
              </span>
              <span className="system-xs-medium truncate" title={t('nodes.tool.assembleVariables', { ns: 'workflow' })}>
                {t('nodes.tool.assembleVariables', { ns: 'workflow' })}
              </span>
            </button>
          </div>
        )
      }
      {filteredVars.length > 0
        ? (
            <div className={cn('max-h-[85vh] overflow-y-auto', maxHeightClass)}>

              {
                filteredVars.map((item, i) => (
                  <div key={i} className={cn(!item.isFlat && 'mt-3', i === 0 && item.isFlat && 'mt-2')}>
                    {!item.isFlat && (
                      <div
                        className="system-xs-medium-uppercase truncate px-3 leading-[22px] text-text-tertiary"
                        title={item.title}
                      >
                        {item.title}
                      </div>
                    )}
                    {item.vars.map((v, j) => {
                      runningIndex += 1
                      const itemIndex = runningIndex
                      return (
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
                          preferSchemaType={preferSchemaType}
                          isHighlighted={enableKeyboardNavigation && itemIndex === resolvedActiveIndex}
                          onSetHighlight={enableKeyboardNavigation ? () => handleHighlightIndex(itemIndex, 'mouse') : undefined}
                          registerRef={enableKeyboardNavigation
                            ? (element) => {
                                itemRefs.current[itemIndex] = element
                              }
                            : undefined}
                        />
                      )
                    })}
                    {item.isFlat && !filteredVars[i + 1]?.isFlat && !!filteredVars.find(item => !item.isFlat) && (
                      <div className="relative mt-[14px] flex items-center space-x-1">
                        <div className="h-0 w-3 shrink-0 border border-divider-subtle"></div>
                        <div className="system-2xs-semibold-uppercase text-text-tertiary">{t('debug.lastOutput', { ns: 'workflow' })}</div>
                        <div className="h-0 shrink-0 grow border border-divider-subtle"></div>
                      </div>
                    )}
                  </div>
                ))
              }
            </div>
          )
        : <div className="mt-2 pl-3 text-xs font-medium uppercase leading-[18px] text-gray-500">{t('common.noVar', { ns: 'workflow' })}</div>}
      {
        showManageInputField && (
          <ManageInputField
            onManage={onManageInputField || noop}
          />
        )
      }
    </>
  )
}

export default React.memo(VarReferenceVars)
