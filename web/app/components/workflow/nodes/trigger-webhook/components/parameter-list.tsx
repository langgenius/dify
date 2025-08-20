'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { RiAddLine } from '@remixicon/react'
import type { WebhookParameter } from '../types'
import ParameterInput from './parameter-input'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'

type Props = {
  readonly?: boolean
  title: string
  parameters?: WebhookParameter[]
  onChange: (parameters: WebhookParameter[]) => void
  showType?: boolean
  placeholder?: string
}

const ParameterList: FC<Props> = ({
  readonly = false,
  title,
  parameters = [],
  onChange,
  showType = true,
  placeholder,
}) => {
  const { t } = useTranslation()

  const handleParameterChange = useCallback((index: number, parameter: WebhookParameter) => {
    const newParameters = [...parameters]
    newParameters[index] = parameter
    onChange(newParameters)
  }, [parameters, onChange])

  const handleRemoveParameter = useCallback((index: number) => {
    const newParameters = parameters.filter((_, i) => i !== index)
    onChange(newParameters)
  }, [parameters, onChange])

  const handleAddParameter = useCallback(() => {
    const newParameter: WebhookParameter = {
      name: '',
      type: 'string',
      required: false,
    }
    onChange([...(parameters || []), newParameter])
  }, [parameters, onChange])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">{title}</h4>
        {!readonly && (
          <Button
            variant="ghost"
            size="small"
            onClick={handleAddParameter}
            className="h-6 px-2 text-xs text-primary-600 hover:text-primary-700"
          >
            <RiAddLine className="mr-1 h-3 w-3" />
            {t('workflow.nodes.triggerWebhook.addParameter')}
          </Button>
        )}
      </div>

      {parameters.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500">
          {placeholder || t('workflow.nodes.triggerWebhook.noParameters')}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-divider-regular">
          <div className="system-xs-medium-uppercase flex h-7 items-center leading-7 text-text-tertiary">
            <div className={cn(showType ? 'w-[calc(50%-88px)]' : 'w-1/2', 'h-full shrink-0 border-r border-divider-regular pl-3')}>{t('workflow.nodes.triggerWebhook.parameterName')}</div>
            {showType && <div className="h-full w-[88px] shrink-0 border-r border-divider-regular pl-3">{t('common.type')}</div>}
            <div className="h-full w-[140px] shrink-0 pl-3">{t('workflow.nodes.triggerWebhook.required')}</div>
          </div>
          {parameters.map((parameter, index) => (
            <ParameterInput
              key={index}
              readonly={readonly}
              parameter={parameter}
              onChange={param => handleParameterChange(index, param)}
              onRemove={() => handleRemoveParameter(index)}
              showType={showType}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default React.memo(ParameterList)
