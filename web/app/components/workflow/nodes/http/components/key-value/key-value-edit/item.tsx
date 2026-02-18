'use client'
import type { FC } from 'react'
import type { KeyValue } from '../../../types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { PortalSelect } from '@/app/components/base/select'
import { VarType } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'
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

  const handleChange = useCallback((key: string) => {
    return (value: string | ValueSelector) => {
      const newPayload = produce(payload, (draft: any) => {
        draft[key] = value
      })
      onChange(newPayload)
    }
  }, [onChange, payload])

  const filterOnlyFileVariable = (varPayload: Var) => {
    return [VarType.file, VarType.arrayFile].includes(varPayload.type)
  }

  return (
    // group class name is for hover row show remove button
    <div className={cn(className, 'h-min-7 group flex border-t border-divider-regular')}>
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
                className="system-sm-regular focus:bg-gray-100! appearance-none rounded-none border-none bg-transparent outline-none hover:bg-components-input-bg-hover focus:ring-0"
                value={payload.key}
                onChange={e => handleChange('key')(e.target.value)}
              />
            )}
      </div>
      {isSupportFile && (
        <div className="w-[70px] shrink-0 border-r border-divider-regular">
          <PortalSelect
            value={payload.type!}
            onSelect={item => handleChange('type')(item.value as string)}
            items={[
              { name: 'text', value: 'text' },
              { name: 'file', value: 'file' },
            ]}
            readonly={readonly}
            triggerClassName="rounded-none h-7 text-text-primary"
            triggerClassNameFn={isOpen => isOpen ? 'bg-state-base-hover' : 'bg-transparent'}
            popupClassName="w-[80px] h-7"
          />
        </div>
      )}
      <div className={cn(isSupportFile ? 'grow' : 'w-1/2')} onClick={() => isLastItem && onAdd()}>
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
