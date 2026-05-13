'use client'
import type { FC } from 'react'
import type { StructuredOutput } from '../../../llm/types'
import type { Field } from '@/app/components/workflow/nodes/llm/types'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { useHover } from 'ahooks'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import PickerStructurePanel from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/picker'
import { VariableIconWithColor } from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { VarType } from '@/app/components/workflow/types'
import { Type } from '../../../llm/types'
import ManageInputField from './manage-input-field'
import { varTypeToStructType } from './utils'
import {
  filterReferenceVars,
  getValueSelector,
  getVariableCategory,
  getVariableDisplayName,
} from './var-reference-vars.helpers'

const VAR_SEARCH_INPUT_CLASS_NAME = 'var-search-input'
export const VAR_REFERENCE_CHILD_POPUP_CLASS_NAME = 'var-reference-vars-child-popup'

const resolveValueSelector = ({
  itemData,
  isFlat,
  isSupportFileVar,
  nodeId,
  objPath,
}: {
  itemData: Var
  isFlat?: boolean
  isSupportFileVar?: boolean
  nodeId: string
  objPath: string[]
}) => {
  const isStructureOutput = itemData.type === VarType.object && (itemData.children as StructuredOutput)?.schema?.properties
  const isFile = itemData.type === VarType.file && !isStructureOutput
  const isSys = itemData.variable.startsWith('sys.')
  const isEnv = itemData.variable.startsWith('env.')
  const isChatVar = itemData.variable.startsWith('conversation.')
  const isRagVariable = itemData.isRagVariable

  return getValueSelector({
    itemData,
    isFlat,
    isSupportFileVar,
    isFile,
    isSys,
    isEnv,
    isChatVar,
    isRagVariable,
    nodeId,
    objPath,
  })
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
  className?: string
  preferSchemaType?: boolean
  isSelected?: boolean
  onActivate?: () => void
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
  className,
  preferSchemaType,
  isSelected,
  onActivate,
}) => {
  const isStructureOutput = itemData.type === VarType.object && (itemData.children as StructuredOutput)?.schema?.properties
  const isObj = ([VarType.object, VarType.file].includes(itemData.type) && itemData.children && (itemData.children as Var[]).length > 0)
  const isEnv = itemData.variable.startsWith('env.')
  const isChatVar = itemData.variable.startsWith('conversation.')
  const isRagVariable = itemData.isRagVariable
  const flatVarIcon = useMemo(() => {
    if (!isFlat)
      return null
    const variable = itemData.variable
    switch (variable) {
      case 'current':
        return (
          <span
            aria-hidden
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-util-colors-violet-violet-600',
              isInCodeGeneratorInstructionEditor ? 'i-custom-vender-line-general-code-assistant' : 'i-custom-vender-line-general-magic-edit',
            )}
          />
        )
      case 'error_message':
        return <span aria-hidden className="i-custom-vender-solid-development-variable-02 h-3.5 w-3.5 shrink-0 text-util-colors-orange-dark-orange-dark-600" />
      default:
        return <span aria-hidden className="i-custom-vender-solid-development-variable-02 h-3.5 w-3.5 shrink-0 text-text-accent" />
    }
  }, [isFlat, isInCodeGeneratorInstructionEditor, itemData.variable])

  const varName = useMemo(
    () => getVariableDisplayName(itemData.variable, !!isFlat, isInCodeGeneratorInstructionEditor),
    [isFlat, isInCodeGeneratorInstructionEditor, itemData.variable],
  )

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
  }, [isHovering, onHovering])
  const handleChosen = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    const valueSelector = resolveValueSelector({
      itemData,
      isFlat,
      isSupportFileVar,
      nodeId,
      objPath,
    })

    if (valueSelector)
      onChange(valueSelector, itemData)
  }
  const variableCategory = useMemo(
    () => getVariableCategory({ isEnv, isChatVar, isLoopVar, isRagVariable }),
    [isEnv, isChatVar, isLoopVar, isRagVariable],
  )

  const itemTrigger = (
    <div
      ref={itemRef}
      className={cn(
        (isObj || isStructureOutput) ? 'pr-1' : 'pr-[18px]',
        (isHovering || isSelected) && ((isObj || isStructureOutput) ? 'bg-components-panel-on-panel-item-bg-hover' : 'bg-state-base-hover'),
        'relative flex h-6 w-full cursor-pointer items-center rounded-md pl-3 outline-hidden focus:outline-hidden focus-visible:outline-hidden',
        className,
      )}
      data-selected={isSelected ? 'true' : 'false'}
      onClick={handleChosen}
      onMouseEnter={onActivate}
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
          <div title={itemData.variable} className="ml-1 w-0 grow truncate system-sm-medium text-text-secondary">{varName}</div>
        )}
        {isEnv && (
          <div title={itemData.variable} className="ml-1 w-0 grow truncate system-sm-medium text-text-secondary">{itemData.variable.replace('env.', '')}</div>
        )}
        {isChatVar && (
          <div title={itemData.des} className="ml-1 w-0 grow truncate system-sm-medium text-text-secondary">{itemData.variable.replace('conversation.', '')}</div>
        )}
        {isRagVariable && (
          <div title={itemData.des} className="ml-1 w-0 grow truncate system-sm-medium text-text-secondary">{itemData.variable.split('.').slice(-1)[0]}</div>
        )}
      </div>
      <div className="ml-1 shrink-0 text-xs font-normal text-text-tertiary capitalize">{(preferSchemaType && itemData.schemaType) ? itemData.schemaType : itemData.type}</div>
      {
        (isObj || isStructureOutput) && (
          <span aria-hidden className={cn('ml-0.5 i-custom-vender-line-arrows-chevron-right h-3 w-3 text-text-quaternary', isHovering && 'text-text-tertiary')} />
        )
      }
    </div>
  )

  return (
    <Popover
      open={open}
      onOpenChange={noop}
    >
      <PopoverTrigger nativeButton={false} render={itemTrigger} />
      <PopoverContent
        placement="left-start"
        sideOffset={0}
        popupClassName={cn(VAR_REFERENCE_CHILD_POPUP_CLASS_NAME, 'border-none bg-transparent p-0 shadow-none backdrop-blur-none')}
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
      </PopoverContent>
    </Popover>
  )
}

type Props = {
  hideSearch?: boolean
  searchText?: string
  searchBoxClassName?: string
  vars: NodeOutPutVar[]
  isSupportFileVar?: boolean
  onChange: (value: ValueSelector, item: Var) => void
  itemWidth?: number
  maxHeightClass?: string
  onClose?: () => void
  onBlur?: () => void
  isInCodeGeneratorInstructionEditor?: boolean
  showManageInputField?: boolean
  onManageInputField?: () => void
  autoFocus?: boolean
  preferSchemaType?: boolean
}
const VarReferenceVars: FC<Props> = ({
  hideSearch,
  searchText,
  searchBoxClassName,
  vars,
  isSupportFileVar,
  onChange,
  itemWidth,
  maxHeightClass,
  onClose,
  onBlur,
  isInCodeGeneratorInstructionEditor,
  showManageInputField,
  onManageInputField,
  autoFocus = true,
  preferSchemaType,
}) => {
  const { t } = useTranslation()
  const [internalSearchValue, setInternalSearchValue] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const searchValue = searchText ?? internalSearchValue
  const filteredVars = useMemo(() => filterReferenceVars(vars, searchValue), [vars, searchValue])
  const selectableItems = useMemo(() => {
    return filteredVars.flatMap(node => node.vars.map(item => ({
      nodeId: node.nodeId,
      isFlat: node.isFlat,
      itemData: item,
    })))
  }, [filteredVars])
  const indexedFilteredVars = useMemo(() => {
    let optionIndex = 0

    return filteredVars.map(node => ({
      ...node,
      vars: node.vars.map(variable => ({
        variable,
        optionIndex: optionIndex++,
      })),
    }))
  }, [filteredVars])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const effectiveSelectedIndex = selectableItems.length ? Math.min(Math.max(selectedIndex, 0), selectableItems.length - 1) : -1

  useEffect(() => {
    const listElement = listRef.current
    const selectedElement = listElement?.querySelector('[data-selected="true"]') as HTMLElement | null
    if (!listElement || !selectedElement)
      return

    const selectedTop = selectedElement.offsetTop
    const selectedBottom = selectedTop + selectedElement.offsetHeight
    const visibleTop = listElement.scrollTop
    const visibleBottom = visibleTop + listElement.clientHeight

    if (selectedTop < visibleTop)
      listElement.scrollTop = selectedTop
    else if (selectedBottom > visibleBottom)
      listElement.scrollTop = selectedBottom - listElement.clientHeight
  }, [effectiveSelectedIndex])

  const selectItem = useCallback((index: number) => {
    const selectedItem = selectableItems[index]
    if (!selectedItem)
      return

    const { itemData, nodeId, isFlat } = selectedItem
    const valueSelector = resolveValueSelector({
      itemData,
      isFlat,
      isSupportFileVar,
      nodeId,
      objPath: [],
    })

    if (valueSelector)
      onChange(valueSelector, itemData)
  }, [isSupportFileVar, onChange, selectableItems])

  const handleKeyboardEvent = useCallback((event: Pick<KeyboardEvent, 'key' | 'preventDefault' | 'stopPropagation'>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose?.()
      return
    }

    if (!selectableItems.length)
      return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      setSelectedIndex(
        event.key === 'ArrowDown'
          ? Math.min(effectiveSelectedIndex + 1, selectableItems.length - 1)
          : Math.max(effectiveSelectedIndex - 1, 0),
      )
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      selectItem(effectiveSelectedIndex)
    }
  }, [effectiveSelectedIndex, onClose, selectableItems.length, selectItem])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    handleKeyboardEvent(e)
  }, [handleKeyboardEvent])

  useEffect(() => {
    if (!hideSearch)
      return

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey)
        return
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key))
        return

      handleKeyboardEvent(event)
    }

    document.addEventListener('keydown', handleDocumentKeyDown, true)
    return () => document.removeEventListener('keydown', handleDocumentKeyDown, true)
  }, [handleKeyboardEvent, hideSearch])

  return (
    <>
      {
        !hideSearch && (
          <>
            <div className={cn('mx-2 mt-2 mb-2', searchBoxClassName)} onClick={e => e.stopPropagation()}>
              <Input
                className={VAR_SEARCH_INPUT_CLASS_NAME}
                showLeftIcon
                showClearIcon
                value={searchValue}
                placeholder={t('common.searchVar', { ns: 'workflow' }) || ''}
                onChange={e => setInternalSearchValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onClear={() => setInternalSearchValue('')}
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

      {filteredVars.length > 0
        ? (
            <div ref={listRef} className={cn('max-h-[85vh] overflow-x-hidden overflow-y-auto', maxHeightClass)}>
              {
                indexedFilteredVars.map((item, i) => (
                  <div key={item.nodeId} className={cn(!item.isFlat && 'mt-3', i === 0 && item.isFlat && 'mt-2')}>
                    {!item.isFlat && (
                      <div
                        className="truncate px-3 system-xs-medium-uppercase leading-[22px] text-text-tertiary"
                        title={item.title}
                      >
                        {item.title}
                      </div>
                    )}
                    {item.vars.map(({ variable, optionIndex }) => (
                      <Item
                        key={optionIndex}
                        title={item.title}
                        nodeId={item.nodeId}
                        objPath={[]}
                        itemData={variable}
                        onChange={onChange}
                        itemWidth={itemWidth}
                        isSupportFileVar={isSupportFileVar}
                        isException={variable.isException}
                        isLoopVar={item.isLoop}
                        isFlat={item.isFlat}
                        isInCodeGeneratorInstructionEditor={isInCodeGeneratorInstructionEditor}
                        preferSchemaType={preferSchemaType}
                        isSelected={effectiveSelectedIndex === optionIndex}
                        onActivate={() => setSelectedIndex(optionIndex)}
                      />
                    ))}
                    {item.isFlat && !indexedFilteredVars[i + 1]?.isFlat && !!indexedFilteredVars.find(item => !item.isFlat) && (
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
        : <div className="mt-2 pl-3 text-xs leading-[18px] font-medium text-gray-500 uppercase">{t('common.noVar', { ns: 'workflow' })}</div>}
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
