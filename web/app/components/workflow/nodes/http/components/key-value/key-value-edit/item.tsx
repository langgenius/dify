'use client'
import type { FC } from 'react'
import type { KeyValue } from '../../../types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { VarType } from '@/app/components/workflow/types'
import VarReferencePicker from '../../../../_base/components/variable/var-reference-picker'
import InputItem from './input-item'
// import Input from '@/app/components/base/input'

const i18nPrefix = 'nodes.http'

type Props = Readonly<{
  instanceId: string
  className?: string
  nodeId: string
  readonly: boolean
  canRemove: boolean
  payload: KeyValue
  onChange: (newPayload: KeyValue) => void
  onRemove: () => void
  isLastItem: boolean
  onAdd: () => void
  index: number
  onAdvance: (index: number, isLastItem: boolean) => void
  isSupportFile?: boolean
  keyNotSupportVar?: boolean
  insertVarTipToLeft?: boolean
}>

const KeyValueItem: FC<Props> = ({
  instanceId,
  className,
  nodeId,
  readonly,
  canRemove,
  payload,
  onChange,
  onRemove,
  isLastItem,
  onAdd,
  index,
  onAdvance,
  isSupportFile,
  keyNotSupportVar,
  insertVarTipToLeft,
}) => {
  const { t } = useTranslation()
  const hasValuePayload = payload.type === 'file' ? !!payload.file?.length : !!payload.value

  // While the variable-insert typeahead menu is open, Enter/Tab belong to it
  // (they select a variable), so we must not hijack them. The menu renders in a
  // portal with a stable id, which lets us detect it without touching the
  // shared editor component.
  const isVarMenuOpen = () => !!document.getElementById('typeahead-menu')

  // KEY field: suppress Enter. A Lexical newline in the key becomes `key\n`,
  // which strToKeyValueList splits into two rows, migrating the value onto a new
  // empty-key row — i.e. data corruption.
  const handleKeyFieldKeyDownCapture = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Enter' || isVarMenuOpen()) return
    e.preventDefault()
    e.stopPropagation()
  }, [])

  // VALUE field: Enter or plain Tab commits the row and advances to the next
  // row's key (creating a new trailing row when on the last row). Shift+Tab is
  // left alone for normal reverse focus traversal.
  const handleValueFieldKeyDownCapture = useCallback(
    (e: KeyboardEvent) => {
      const isAdvanceKey = e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)
      if (!isAdvanceKey || isVarMenuOpen()) return
      e.preventDefault()
      e.stopPropagation()
      onAdvance(index, isLastItem)
    },
    [index, isLastItem, onAdvance],
  )

  const handleChange = useCallback(
    (key: string) => {
      return (value: string | ValueSelector) => {
        const shouldAddNextItem =
          isLastItem &&
          ((key === 'value' && !payload.value && !!value) ||
            (key === 'file' &&
              (!payload.file || payload.file.length === 0) &&
              Array.isArray(value) &&
              value.length > 0))

        const newPayload = produce(payload, (draft: any) => {
          draft[key] = value
        })
        onChange(newPayload)

        if (shouldAddNextItem) onAdd()
      }
    },
    [isLastItem, onAdd, onChange, payload],
  )

  const filterOnlyFileVariable = (varPayload: Var) => {
    return [VarType.file, VarType.arrayFile].includes(varPayload.type)
  }

  const handleValueContainerClick = useCallback(() => {
    if (isLastItem && hasValuePayload) onAdd()
  }, [hasValuePayload, isLastItem, onAdd])

  return (
    // group class name is for hover row show remove button
    <div
      data-kv-row
      className={cn(className, 'group flex min-h-7 border-t border-divider-regular')}
    >
      <div
        className={cn('shrink-0 border-r border-divider-regular', isSupportFile ? 'w-35' : 'w-1/2')}
      >
        {!keyNotSupportVar ? (
          <InputItem
            instanceId={`http-key-${instanceId}`}
            nodeId={nodeId}
            value={payload.key}
            onChange={handleChange('key')}
            hasRemove={false}
            placeholder={t(($) => $[`${i18nPrefix}.key`], { ns: 'workflow' })!}
            readOnly={readonly}
            insertVarTipToLeft={insertVarTipToLeft}
            fieldRole="key"
            onFieldKeyDownCapture={handleKeyFieldKeyDownCapture}
          />
        ) : (
          <input
            className="appearance-none rounded-none border-none bg-transparent system-sm-regular outline-hidden hover:bg-components-input-bg-hover focus:bg-gray-100! focus:ring-0"
            value={payload.key}
            onChange={(e) => handleChange('key')(e.target.value)}
          />
        )}
      </div>
      {isSupportFile && (
        <div className="w-17.5 shrink-0 border-r border-divider-regular">
          <Select
            value={payload.type ?? 'text'}
            onValueChange={(value) => value && handleChange('type')(value)}
            readOnly={readonly}
          >
            <SelectTrigger
              aria-label={t(($) => $[`${i18nPrefix}.type`], { ns: 'workflow' })}
              className="h-7 rounded-none bg-transparent text-text-primary hover:bg-state-base-hover focus-visible:bg-state-base-hover data-popup-open:bg-state-base-hover"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent popupClassName="w-[80px]" listClassName="min-w-0">
              <SelectItem value="text">
                <SelectItemText>text</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
              <SelectItem value="file">
                <SelectItemText>file</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className={cn(isSupportFile ? 'grow' : 'w-1/2')} onClick={handleValueContainerClick}>
        {isSupportFile && payload.type === 'file' ? (
          <VarReferencePicker
            nodeId={nodeId}
            readonly={readonly}
            value={payload.file || []}
            onChange={handleChange('file')}
            filterVar={filterOnlyFileVariable}
            isInTable
            onRemove={onRemove}
          />
        ) : (
          <InputItem
            instanceId={`http-value-${instanceId}`}
            nodeId={nodeId}
            value={payload.value}
            onChange={handleChange('value')}
            hasRemove={!readonly && canRemove}
            onRemove={onRemove}
            placeholder={t(($) => $[`${i18nPrefix}.value`], { ns: 'workflow' })!}
            readOnly={readonly}
            isSupportFile={isSupportFile}
            insertVarTipToLeft={insertVarTipToLeft}
            fieldRole="value"
            onFieldKeyDownCapture={handleValueFieldKeyDownCapture}
          />
        )}
      </div>
    </div>
  )
}
export default React.memo(KeyValueItem)
