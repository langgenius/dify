'use client'
import type { StructuredOutput } from '../../../llm/types'
import type { Field } from '@/app/components/workflow/nodes/llm/types'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Combobox,
  ComboboxClear,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxItemText,
  ComboboxList,
} from '@langgenius/dify-ui/combobox'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

export const VAR_REFERENCE_CHILD_POPUP_CLASS_NAME = 'var-reference-vars-child-popup'

type ReferenceVarItem = {
  nodeId: string
  title: string
  itemData: Var
  optionIndex: number
  isFlat?: boolean
  isException?: boolean
  isLoopVar?: boolean
}

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
  item: ReferenceVarItem
  onChange: (value: ValueSelector, item: Var) => void
  isInCodeGeneratorInstructionEditor?: boolean
  preferSchemaType?: boolean
}

function Item({
  item,
  onChange,
  isInCodeGeneratorInstructionEditor,
  preferSchemaType,
}: ItemProps) {
  const {
    nodeId,
    title,
    itemData,
    isException,
    isFlat,
    isLoopVar,
  } = item
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
              'size-3.5 shrink-0 text-util-colors-violet-violet-600',
              isInCodeGeneratorInstructionEditor ? 'i-custom-vender-line-general-code-assistant' : 'i-custom-vender-line-general-magic-edit',
            )}
          />
        )
      case 'error_message':
        return <span aria-hidden className="i-custom-vender-solid-development-variable-02 size-3.5 shrink-0 text-util-colors-orange-dark-orange-dark-600" />
      default:
        return <span aria-hidden className="i-custom-vender-solid-development-variable-02 size-3.5 shrink-0 text-text-accent" />
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

  const variableCategory = useMemo(
    () => getVariableCategory({ isEnv, isChatVar, isLoopVar, isRagVariable }),
    [isEnv, isChatVar, isLoopVar, isRagVariable],
  )

  const itemTrigger = (
    <ComboboxItem
      value={item}
    >
      <ComboboxItemText className="flex items-center gap-1 px-0">
        {!isFlat && (
          <VariableIconWithColor
            variables={itemData.variable.split('.')}
            variableCategory={variableCategory}
            isExceptionVariable={isException}
          />
        )}
        {isFlat && flatVarIcon}

        {!isEnv && !isChatVar && !isRagVariable && (
          <span title={itemData.variable} className="min-w-0 grow truncate">{varName}</span>
        )}
        {isEnv && (
          <span title={itemData.variable} className="min-w-0 grow truncate">{itemData.variable.replace('env.', '')}</span>
        )}
        {isChatVar && (
          <span title={itemData.des} className="min-w-0 grow truncate">{itemData.variable.replace('conversation.', '')}</span>
        )}
        {isRagVariable && (
          <span title={itemData.des} className="min-w-0 grow truncate">{itemData.variable.split('.').slice(-1)[0]}</span>
        )}
      </ComboboxItemText>
      <span className="text-xs font-normal text-text-tertiary capitalize">{(preferSchemaType && itemData.schemaType) ? itemData.schemaType : itemData.type}</span>
      {
        (isObj || isStructureOutput) && (
          <span aria-hidden className="i-custom-vender-line-arrows-chevron-right size-3 text-text-quaternary" />
        )
      }
    </ComboboxItem>
  )

  if (!isObj && !isStructureOutput)
    return itemTrigger

  return (
    <Popover>
      <PopoverTrigger nativeButton={false} openOnHover render={itemTrigger} />
      <PopoverContent
        placement="left-start"
        sideOffset={0}
        popupClassName={cn(VAR_REFERENCE_CHILD_POPUP_CLASS_NAME, 'border-none bg-transparent p-0 shadow-none backdrop-blur-none')}
      >
        {(isStructureOutput || isObj) && (
          <PickerStructurePanel
            root={{ nodeId, nodeName: title, attrName: itemData.variable, attrAlias: itemData.schemaType }}
            payload={structuredOutput!}
            onSelect={(valueSelector) => {
              onChange(valueSelector, itemData)
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function getReferenceVarLabel(item: ReferenceVarItem) {
  return getVariableDisplayName(item.itemData.variable, !!item.isFlat)
}

function getReferenceVarValue(item: ReferenceVarItem) {
  return `${item.nodeId}:${item.itemData.variable}:${item.optionIndex}`
}

function isSameReferenceVar(item: ReferenceVarItem, value: ReferenceVarItem) {
  return item.nodeId === value.nodeId
    && item.itemData.variable === value.itemData.variable
    && item.optionIndex === value.optionIndex
}

type Props = {
  hideSearch?: boolean
  searchText?: string
  searchBoxClassName?: string
  vars: NodeOutPutVar[]
  isSupportFileVar?: boolean
  onChange: (value: ValueSelector, item: Var) => void
  maxHeightClass?: string
  onClose?: () => void
  onBlur?: () => void
  isInCodeGeneratorInstructionEditor?: boolean
  showManageInputField?: boolean
  onManageInputField?: () => void
  autoFocus?: boolean
  preferSchemaType?: boolean
}
function VarReferenceVars({
  hideSearch,
  searchText,
  searchBoxClassName,
  vars,
  isSupportFileVar,
  onChange,
  maxHeightClass,
  onBlur,
  isInCodeGeneratorInstructionEditor,
  showManageInputField,
  onManageInputField,
  autoFocus = true,
  preferSchemaType,
}: Props) {
  const { t } = useTranslation()
  const [internalSearchValue, setInternalSearchValue] = useState('')
  const searchValue = searchText ?? internalSearchValue
  const filteredVars = useMemo(() => filterReferenceVars(vars, searchValue), [vars, searchValue])
  const groupedItems = useMemo(() => {
    let optionIndex = 0

    return filteredVars.map(node => ({
      ...node,
      vars: node.vars.map((variable): ReferenceVarItem => ({
        nodeId: node.nodeId,
        title: node.title,
        itemData: variable,
        isFlat: node.isFlat,
        isException: variable.isException,
        isLoopVar: node.isLoop,
        optionIndex: optionIndex++,
      })),
    }))
  }, [filteredVars])
  const selectableItems = useMemo(() => groupedItems.flatMap(node => node.vars), [groupedItems])

  const selectItem = useCallback((selectedItem?: ReferenceVarItem) => {
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
  }, [isSupportFileVar, onChange])

  const handleValueChange = useCallback((item: ReferenceVarItem | null) => {
    if (!item)
      return

    selectItem(item)
  }, [selectItem])

  const handleInputValueChange = useCallback((value: string) => {
    if (searchText === undefined)
      setInternalSearchValue(value)
  }, [searchText])

  return (
    <Combobox<ReferenceVarItem>
      inline
      open
      value={null}
      items={selectableItems}
      inputValue={searchValue}
      onInputValueChange={handleInputValueChange}
      onValueChange={handleValueChange}
      filter={null}
      itemToStringLabel={getReferenceVarLabel}
      itemToStringValue={getReferenceVarValue}
      isItemEqualToValue={isSameReferenceVar}
    >
      {
        !hideSearch && (
          <div className={cn('m-2', searchBoxClassName)}>
            <ComboboxInputGroup>
              <ComboboxInput
                aria-label={t('common.searchVar', { ns: 'workflow' }) || ''}
                placeholder={t('common.searchVar', { ns: 'workflow' }) || ''}
                onBlur={onBlur}
                autoFocus={autoFocus}
              />
              {searchValue && (
                <ComboboxClear
                  aria-label={t('operation.clear', { ns: 'common' })}
                />
              )}
            </ComboboxInputGroup>
          </div>
        )
      }

      {filteredVars.length > 0
        ? (
            <ComboboxList className={maxHeightClass}>
              {
                groupedItems.map((group, i) => (
                  <ComboboxGroup key={group.nodeId} items={group.vars}>
                    {!group.isFlat && (
                      <ComboboxGroupLabel
                        title={group.title}
                      >
                        {group.title}
                      </ComboboxGroupLabel>
                    )}
                    {group.vars.map(item => (
                      <Item
                        key={item.optionIndex}
                        item={item}
                        onChange={onChange}
                        isInCodeGeneratorInstructionEditor={isInCodeGeneratorInstructionEditor}
                        preferSchemaType={preferSchemaType}
                      />
                    ))}
                    {group.isFlat && !groupedItems[i + 1]?.isFlat && !!groupedItems.find(item => !item.isFlat) && (
                      <div className="relative mt-[14px] flex items-center space-x-1">
                        <div className="h-0 w-3 shrink-0 border border-divider-subtle"></div>
                        <div className="system-2xs-semibold-uppercase text-text-tertiary">{t('debug.lastOutput', { ns: 'workflow' })}</div>
                        <div className="h-0 shrink-0 grow border border-divider-subtle"></div>
                      </div>
                    )}
                  </ComboboxGroup>
                ))
              }
            </ComboboxList>
          )
        : <ComboboxEmpty>{t('common.noVar', { ns: 'workflow' })}</ComboboxEmpty>}
      {
        showManageInputField && onManageInputField && (
          <ManageInputField
            onManage={onManageInputField}
          />
        )
      }
    </Combobox>
  )
}

export default React.memo(VarReferenceVars)
