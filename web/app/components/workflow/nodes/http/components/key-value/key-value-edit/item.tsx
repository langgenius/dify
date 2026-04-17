'use client'
import type { FC } from 'react'
import type { KeyValue } from '../../../types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@/app/components/base/ui/select'
import { VarType } from '@/app/components/workflow/types'
import VarReferencePicker from '../../../../_base/components/variable/var-reference-picker'
import InputItem from './input-item'
// import Input from '@/app/components/base/input'

const i18nPrefix = 'nodes.http'

type Props = {
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
  isSupportFile?: boolean
  keyNotSupportVar?: boolean
  insertVarTipToLeft?: boolean
}

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
  isSupportFile,
  keyNotSupportVar,
  insertVarTipToLeft,
}) => {
  const { t } = useTranslation()
  const hasValuePayload = payload.type === 'file'
    ? !!payload.file?.length
    : !!payload.value

  const handleChange = useCallback((key: string) => {
    return (value: string | ValueSelector) => {
      const shouldAddNextItem = isLastItem
        && (
          (key === 'value' && !payload.value && !!value)
          || (key === 'file' && (!payload.file || payload.file.length === 0) && Array.isArray(value) && value.length > 0)
        )

      const newPayload = produce(payload, (draft: any) => {
        draft[key] = value
      })
      onChange(newPayload)

      if (shouldAddNextItem)
        onAdd()
    }
  }, [isLastItem, onAdd, onChange, payload])

  const filterOnlyFileVariable = (varPayload: Var) => {
    return [VarType.file, VarType.arrayFile].includes(varPayload.type)
  }

  const handleValueContainerClick = useCallback(() => {
    if (isLastItem && hasValuePayload)
      onAdd()
  }, [hasValuePayload, isLastItem, onAdd])

  return (
    // group class name is for hover row show remove button
    <div className={cn(className, 'group flex min-h-7 border-t border-divider-regular')}>
      <div className={cn('shrink-0 border-r border-divider-regular', isSupportFile ? 'w-[140px]' : 'w-1/2')}>
        {!keyNotSupportVar
          ? (
              <InputItem
                instanceId={`http-key-${instanceId}`}
                nodeId={nodeId}
                value={payload.key}
                onChange={handleChange('key')}
                hasRemove={false}
                placeholder={t(`${i18nPrefix}.key`, { ns: 'workflow' })!}
                readOnly={readonly}
                insertVarTipToLeft={insertVarTipToLeft}
              />
            )
          : (
              <input
                className="appearance-none rounded-none border-none bg-transparent system-sm-regular outline-hidden hover:bg-components-input-bg-hover focus:bg-gray-100! focus:ring-0"
                value={payload.key}
                onChange={e => handleChange('key')(e.target.value)}
              />
            )}
      </div>
      {isSupportFile && (
        <div className="w-[70px] shrink-0 border-r border-divider-regular">
          <Select
            value={payload.type ?? 'text'}
            onValueChange={value => value && handleChange('type')(value)}
            readOnly={readonly}
          >
            <SelectTrigger
              aria-label={t(`${i18nPrefix}.type`, { ns: 'workflow' })}
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
      <div
        className={cn(isSupportFile ? 'grow' : 'w-1/2')}
        onClick={handleValueContainerClick}
      >
        {(isSupportFile && payload.type === 'file')
          ? (
              <VarReferencePicker
                nodeId={nodeId}
                readonly={readonly}
                value={payload.file || []}
                onChange={handleChange('file')}
                filterVar={filterOnlyFileVariable}
                isInTable
                onRemove={onRemove}
              />
            )
          : (
              <InputItem
                instanceId={`http-value-${instanceId}`}
                nodeId={nodeId}
                value={payload.value}
                onChange={handleChange('value')}
                hasRemove={!readonly && canRemove}
                onRemove={onRemove}
                placeholder={t(`${i18nPrefix}.value`, { ns: 'workflow' })!}
                readOnly={readonly}
                isSupportFile={isSupportFile}
                insertVarTipToLeft={insertVarTipToLeft}
              />
            )}

      </div>
    </div>
  )
}
export default React.memo(KeyValueItem)
