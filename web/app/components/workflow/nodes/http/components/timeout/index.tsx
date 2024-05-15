'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import type { Timeout as TimeoutPayloadType } from '../../types'
import { ChevronRight } from '@/app/components/base/icons/src/vender/line/arrows'

type Props = {
  readonly: boolean
  nodeId: string
  payload: TimeoutPayloadType
  onChange: (payload: TimeoutPayloadType) => void
}

const i18nPrefix = 'workflow.nodes.http'

const InputField: FC<{
  title: string
  description: string
  placeholder: string
  value?: number
  onChange: (value: number) => void
  readOnly?: boolean
  min: number
  max: number
}> = ({ title, description, placeholder, value, onChange, readOnly, min, max }) => {
  return (
    <div className="space-y-1">
      <div className="flex items-center h-[18px] space-x-2">
        <span className="text-[13px] font-medium text-gray-900">{title}</span>
        <span className="text-xs font-normal text-gray-500">{description}</span>
      </div>
      <input className="w-full px-3 text-sm leading-9 text-gray-900 border-0 rounded-lg grow h-9 bg-gray-100 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200" value={value} onChange={(e) => {
        const value = Math.max(min, Math.min(max, parseInt(e.target.value, 10)))
        onChange(value)
      }} placeholder={placeholder} type='number' readOnly={readOnly} min={min} max={max} />
    </div>
  )
}

const Timeout: FC<Props> = ({ readonly, payload, onChange }) => {
  const { t } = useTranslation()
  const { connect, read, write, max_connect_timeout, max_read_timeout, max_write_timeout } = payload ?? {}

  const [isFold, {
    toggle: toggleFold,
  }] = useBoolean(true)

  return (
    <>
      <div>
        <div
          onClick={toggleFold}
          className={cn('flex justify-between leading-[18px] text-[13px] font-semibold text-gray-700 uppercase cursor-pointer')}>
          <div>{t(`${i18nPrefix}.timeout.title`)}</div>
          <ChevronRight className='w-4 h-4 text-gray-500 transform transition-transform' style={{ transform: isFold ? 'rotate(0deg)' : 'rotate(90deg)' }} />
        </div>
        {!isFold && (
          <div className='mt-2 space-y-1'>
            <div className="space-y-3">
              <InputField
                title={t('workflow.nodes.http.timeout.connectLabel')!}
                description={t('workflow.nodes.http.timeout.connectPlaceholder')!}
                placeholder={t('workflow.nodes.http.timeout.connectPlaceholder')!}
                readOnly={readonly}
                value={connect}
                onChange={v => onChange?.({ ...payload, connect: v })}
                min={1}
                max={max_connect_timeout || 300}
              />
              <InputField
                title={t('workflow.nodes.http.timeout.readLabel')!}
                description={t('workflow.nodes.http.timeout.readPlaceholder')!}
                placeholder={t('workflow.nodes.http.timeout.readPlaceholder')!}
                readOnly={readonly}
                value={read}
                onChange={v => onChange?.({ ...payload, read: v })}
                min={1}
                max={max_read_timeout || 600}
              />
              <InputField
                title={t('workflow.nodes.http.timeout.writeLabel')!}
                description={t('workflow.nodes.http.timeout.writePlaceholder')!}
                placeholder={t('workflow.nodes.http.timeout.writePlaceholder')!}
                readOnly={readonly}
                value={write}
                onChange={v => onChange?.({ ...payload, write: v })}
                min={1}
                max={max_write_timeout || 600}
              />
            </div>
          </div>
        )}
      </div>

    </>
  )
}
export default React.memo(Timeout)
