'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import type { KeyValue } from '../../../types'
import InputItem from './input-item'
import cn from '@/utils/classnames'
import Input from '@/app/components/base/input'

const i18nPrefix = 'workflow.nodes.http'

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
  keyNotSupportVar,
  insertVarTipToLeft,
}) => {
  const { t } = useTranslation()

  const handleChange = useCallback((key: string) => {
    return (value: string) => {
      const newPayload = produce(payload, (draft: any) => {
        draft[key] = value
      })
      onChange(newPayload)
      if (key === 'value' && isLastItem)
        onAdd()
    }
  }, [onChange, onAdd, isLastItem, payload])

  return (
    // group class name is for hover row show remove button
    <div className={cn(className, 'group flex h-min-7 border-t border-gray-200')}>
      <div className='w-1/2 border-r border-gray-200'>
        {!keyNotSupportVar
          ? (
            <InputItem
              instanceId={`http-key-${instanceId}`}
              nodeId={nodeId}
              value={payload.key}
              onChange={handleChange('key')}
              hasRemove={false}
              placeholder={t(`${i18nPrefix}.key`)!}
              readOnly={readonly}
              insertVarTipToLeft={insertVarTipToLeft}
            />
          )
          : (
            <Input
              className='rounded-none bg-white border-none system-sm-regular focus:ring-0 focus:bg-gray-100! hover:bg-gray-50'
              value={payload.key}
              onChange={e => handleChange('key')(e.target.value)}
            />
          )}
      </div>
      <div className='w-1/2'>
        <InputItem
          instanceId={`http-value-${instanceId}`}
          nodeId={nodeId}
          value={payload.value}
          onChange={handleChange('value')}
          hasRemove={!readonly && canRemove}
          onRemove={onRemove}
          placeholder={t(`${i18nPrefix}.value`)!}
          readOnly={readonly}
          insertVarTipToLeft={insertVarTipToLeft}
        />
      </div>
    </div>
  )
}
export default React.memo(KeyValueItem)
