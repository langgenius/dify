'use client'
import type { FC } from 'react'
import type { Timeout as TimeoutPayloadType } from '../../types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { FieldCollapse } from '@/app/components/workflow/nodes/_base/components/collapse'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'

type Props = {
  readonly: boolean
  nodeId: string
  payload: TimeoutPayloadType
  onChange: (payload: TimeoutPayloadType) => void
}

const i18nPrefix = 'nodes.http'

const InputField: FC<{
  title: string
  description: string
  placeholder: string
  value?: number
  onChange: (value: number | undefined) => void
  readOnly?: boolean
  min: number
  max: number
}> = ({ title, description, placeholder, value, onChange, readOnly, min, max }) => {
  return (
    <div className="space-y-1">
      <div className="flex h-[18px] items-center space-x-2">
        <span className="text-[13px] font-medium text-text-primary">{title}</span>
        <span className="text-xs font-normal text-text-tertiary">{description}</span>
      </div>
      <Input
        type="number"
        value={value}
        onChange={(e) => {
          const inputValue = e.target.value
          if (inputValue === '') {
            // When user clears the input, set to undefined to let backend use default values
            onChange(undefined)
          }
          else {
            const parsedValue = Number.parseInt(inputValue, 10)
            if (!Number.isNaN(parsedValue)) {
              const value = Math.max(min, Math.min(max, parsedValue))
              onChange(value)
            }
          }
        }}
        placeholder={placeholder}
        readOnly={readOnly}
        min={min}
        max={max}
      />
    </div>
  )
}

const Timeout: FC<Props> = ({ readonly, payload, onChange }) => {
  const { t } = useTranslation()
  const { connect, read, write, max_connect_timeout, max_read_timeout, max_write_timeout } = payload ?? {}

  // Get default config from store for max timeout values
  const nodesDefaultConfigs = useStore(s => s.nodesDefaultConfigs)
  const defaultConfig = nodesDefaultConfigs?.[BlockEnum.HttpRequest]
  const defaultTimeout = defaultConfig?.timeout || {}

  return (
    <FieldCollapse title={t(`${i18nPrefix}.timeout.title`, { ns: 'workflow' })}>
      <div className="mt-2 space-y-1">
        <div className="space-y-3">
          <InputField
            title={t('nodes.http.timeout.connectLabel', { ns: 'workflow' })!}
            description={t('nodes.http.timeout.connectPlaceholder', { ns: 'workflow' })!}
            placeholder={t('nodes.http.timeout.connectPlaceholder', { ns: 'workflow' })!}
            readOnly={readonly}
            value={connect}
            onChange={v => onChange?.({ ...payload, connect: v })}
            min={1}
            max={max_connect_timeout || defaultTimeout.max_connect_timeout || 10}
          />
          <InputField
            title={t('nodes.http.timeout.readLabel', { ns: 'workflow' })!}
            description={t('nodes.http.timeout.readPlaceholder', { ns: 'workflow' })!}
            placeholder={t('nodes.http.timeout.readPlaceholder', { ns: 'workflow' })!}
            readOnly={readonly}
            value={read}
            onChange={v => onChange?.({ ...payload, read: v })}
            min={1}
            max={max_read_timeout || defaultTimeout.max_read_timeout || 600}
          />
          <InputField
            title={t('nodes.http.timeout.writeLabel', { ns: 'workflow' })!}
            description={t('nodes.http.timeout.writePlaceholder', { ns: 'workflow' })!}
            placeholder={t('nodes.http.timeout.writePlaceholder', { ns: 'workflow' })!}
            readOnly={readonly}
            value={write}
            onChange={v => onChange?.({ ...payload, write: v })}
            min={1}
            max={max_write_timeout || defaultTimeout.max_write_timeout || 600}
          />
        </div>
      </div>
    </FieldCollapse>
  )
}
export default React.memo(Timeout)
