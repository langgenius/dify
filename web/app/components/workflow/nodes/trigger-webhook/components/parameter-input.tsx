'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { RiDeleteBinLine } from '@remixicon/react'
import type { ParameterType, WebhookParameter } from '../types'
import Select from '@/app/components/base/select'
import Switch from '@/app/components/base/switch'
import cn from '@/utils/classnames'

type Props = {
  readonly?: boolean
  parameter: WebhookParameter
  onChange: (parameter: WebhookParameter) => void
  onRemove: () => void
  showType?: boolean
}

const PARAMETER_TYPES = [
  { name: 'String', value: 'string' },
  { name: 'Number', value: 'number' },
  { name: 'Boolean', value: 'boolean' },
  { name: 'Array', value: 'array' },
  { name: 'Object', value: 'object' },
]

const ParameterInput: FC<Props> = ({
  readonly = false,
  parameter,
  onChange,
  onRemove,
  showType = true,
}) => {
  const { t } = useTranslation()

  const handleNameChange = useCallback((value: string) => {
    onChange({ ...parameter, name: value })
  }, [parameter, onChange])

  const handleTypeChange = useCallback((type: ParameterType) => {
    onChange({ ...parameter, type })
  }, [parameter, onChange])

  const handleRequiredChange = useCallback((required: boolean) => {
    onChange({ ...parameter, required })
  }, [parameter, onChange])

  return (
    <div className={cn('h-min-7 group flex items-center border-t border-divider-regular')}>
      <div className={cn(showType ? 'w-[calc(50%-88px)]' : 'w-1/2', 'shrink-0 border-r border-divider-regular')}>
        <input
          className='system-sm-regular focus:bg-gray-100! w-full appearance-none rounded-none border-none bg-transparent px-3 py-1 text-text-primary outline-none hover:bg-components-input-bg-hover focus:ring-0'
          value={parameter.name}
          onChange={e => handleNameChange(e.target.value)}
          placeholder={t('workflow.nodes.triggerWebhook.parameterName')!}
          disabled={readonly}
        />
      </div>

      {/* 类型列 */}
      {showType && (
        <div className="w-[88px] shrink-0 border-r border-divider-regular px-1">
          <Select
            items={PARAMETER_TYPES}
            defaultValue={parameter.type}
            onSelect={item => handleTypeChange(item.value as ParameterType)}
            disabled={readonly}
          />
        </div>
      )}

      <div className="flex w-[140px] shrink-0 items-center justify-between gap-2 px-3">
        <span className="system-xs-medium-uppercase text-text-tertiary">{t('workflow.nodes.triggerWebhook.required')}</span>
        <Switch
          defaultValue={parameter.required}
          onChange={handleRequiredChange}
          disabled={readonly}
          size="sm"
        />
      </div>

      {!readonly && (
        <button
          onClick={onRemove}
          className={cn(
            'mr-1 hidden h-6 w-6 items-center justify-center rounded text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
            'group-hover:flex',
          )}
          aria-label="remove"
        >
        <RiDeleteBinLine className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

export default React.memo(ParameterInput)
