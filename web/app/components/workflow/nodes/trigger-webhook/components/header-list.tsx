'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { RiAddLine } from '@remixicon/react'
import type { WebhookHeader } from '../types'
import HeaderInput from './header-input'
import Button from '@/app/components/base/button'

type Props = {
  readonly?: boolean
  headers?: WebhookHeader[]
  onChange: (headers: WebhookHeader[]) => void
}

const HeaderList: FC<Props> = ({
  readonly = false,
  headers = [],
  onChange,
}) => {
  const { t } = useTranslation()

  const handleHeaderChange = useCallback((index: number, header: WebhookHeader) => {
    const newHeaders = [...headers]
    newHeaders[index] = header
    onChange(newHeaders)
  }, [headers, onChange])

  const handleRemoveHeader = useCallback((index: number) => {
    const newHeaders = headers.filter((_, i) => i !== index)
    onChange(newHeaders)
  }, [headers, onChange])

  const handleAddHeader = useCallback(() => {
    const newHeader: WebhookHeader = {
      name: '',
      required: false,
    }
    onChange([...(headers || []), newHeader])
  }, [headers, onChange])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700">
          {t('workflow.nodes.triggerWebhook.headers')}
        </h4>
        {!readonly && (
          <Button
            variant="ghost"
            size="small"
            onClick={handleAddHeader}
            className="h-6 px-2 text-xs text-primary-600 hover:text-primary-700"
          >
            <RiAddLine className="mr-1 h-3 w-3" />
            {t('workflow.nodes.triggerWebhook.addHeader')}
          </Button>
        )}
      </div>

      {headers.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500">
          {t('workflow.nodes.triggerWebhook.noHeaders')}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-divider-regular">
          <div className="system-xs-medium-uppercase flex h-7 items-center leading-7 text-text-tertiary">
            <div className="h-full w-1/2 shrink-0 border-r border-divider-regular pl-3">{t('workflow.nodes.triggerWebhook.headerName')}</div>
            <div className="h-full w-[140px] shrink-0 pl-3">{t('workflow.nodes.triggerWebhook.required')}</div>
          </div>
          {headers.map((header, index) => (
            <HeaderInput
              key={index}
              readonly={readonly}
              header={header}
              onChange={h => handleHeaderChange(index, h)}
              onRemove={() => handleRemoveHeader(index)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default React.memo(HeaderList)
