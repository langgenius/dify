'use client'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { RiAddLine, RiDeleteBinLine } from '@remixicon/react'
import Input from '@/app/components/base/input'
import Button from '@/app/components/base/button'
import ActionButton from '@/app/components/base/action-button'
import cn from '@/utils/classnames'

export type HeaderItem = {
  key: string
  value: string
}

type Props = {
  headers: Record<string, string>
  onChange: (headers: Record<string, string>) => void
  readonly?: boolean
  isMasked?: boolean
}

const HeadersInput = ({
  headers,
  onChange,
  readonly = false,
  isMasked = false,
}: Props) => {
  const { t } = useTranslation()

  const headerItems = Object.entries(headers).map(([key, value]) => ({ key, value }))

  const handleItemChange = useCallback((index: number, field: 'key' | 'value', value: string) => {
    const newItems = [...headerItems]
    newItems[index] = { ...newItems[index], [field]: value }

    const newHeaders = newItems.reduce((acc, item) => {
      if (item.key.trim())
        acc[item.key.trim()] = item.value
      return acc
    }, {} as Record<string, string>)

    onChange(newHeaders)
  }, [headerItems, onChange])

  const handleRemoveItem = useCallback((index: number) => {
    const newItems = headerItems.filter((_, i) => i !== index)
    const newHeaders = newItems.reduce((acc, item) => {
      if (item.key.trim())
        acc[item.key.trim()] = item.value

      return acc
    }, {} as Record<string, string>)
    onChange(newHeaders)
  }, [headerItems, onChange])

  const handleAddItem = useCallback(() => {
    const newHeaders = { ...headers, '': '' }
    onChange(newHeaders)
  }, [headers, onChange])

  if (headerItems.length === 0) {
    return (
      <div className='space-y-2'>
        <div className='body-xs-regular text-text-tertiary'>
          {t('tools.mcp.modal.noHeaders')}
        </div>
        {!readonly && (
          <Button
            variant='secondary'
            size='small'
            onClick={handleAddItem}
            className='w-full'
          >
            <RiAddLine className='mr-1 h-4 w-4' />
            {t('tools.mcp.modal.addHeader')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      {isMasked && (
        <div className='body-xs-regular text-text-tertiary'>
          {t('tools.mcp.modal.maskedHeadersTip')}
        </div>
      )}
      <div className='overflow-hidden rounded-lg border border-divider-regular'>
        <div className='system-xs-medium-uppercase bg-background-secondary flex h-7 items-center leading-7 text-text-tertiary'>
          <div className='h-full w-1/2 border-r border-divider-regular pl-3'>{t('tools.mcp.modal.headerKey')}</div>
          <div className='h-full w-1/2 pl-3 pr-1'>{t('tools.mcp.modal.headerValue')}</div>
        </div>
        {headerItems.map((item, index) => (
          <div key={index} className={cn(
            'flex items-center border-divider-regular',
            index < headerItems.length - 1 && 'border-b',
          )}>
            <div className='w-1/2 border-r border-divider-regular'>
              <Input
                value={item.key}
                onChange={e => handleItemChange(index, 'key', e.target.value)}
                placeholder={t('tools.mcp.modal.headerKeyPlaceholder')}
                className='rounded-none border-0'
                readOnly={readonly}
              />
            </div>
            <div className='flex w-1/2 items-center'>
              <Input
                value={item.value}
                onChange={e => handleItemChange(index, 'value', e.target.value)}
                placeholder={t('tools.mcp.modal.headerValuePlaceholder')}
                className='flex-1 rounded-none border-0'
                readOnly={readonly}
              />
              {!readonly && headerItems.length > 1 && (
                <ActionButton
                  onClick={() => handleRemoveItem(index)}
                  className='mr-2'
                >
                  <RiDeleteBinLine className='h-4 w-4 text-text-destructive' />
                </ActionButton>
              )}
            </div>
          </div>
        ))}
      </div>
      {!readonly && (
        <Button
          variant='secondary'
          size='small'
          onClick={handleAddItem}
          className='w-full'
        >
          <RiAddLine className='mr-1 h-4 w-4' />
          {t('tools.mcp.modal.addHeader')}
        </Button>
      )}
    </div>
  )
}

export default React.memo(HeadersInput)
