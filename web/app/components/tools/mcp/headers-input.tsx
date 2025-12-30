'use client'
import { RiAddLine, RiDeleteBinLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid } from 'uuid'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import { cn } from '@/utils/classnames'

export type HeaderItem = {
  id: string
  key: string
  value: string
}

type Props = {
  headersItems: HeaderItem[]
  onChange: (headerItems: HeaderItem[]) => void
  readonly?: boolean
  isMasked?: boolean
}

const HeadersInput = ({
  headersItems,
  onChange,
  readonly = false,
  isMasked = false,
}: Props) => {
  const { t } = useTranslation()

  const handleItemChange = (index: number, field: 'key' | 'value', value: string) => {
    const newItems = [...headersItems]
    newItems[index] = { ...newItems[index], [field]: value }

    onChange(newItems)
  }

  const handleRemoveItem = (index: number) => {
    const newItems = headersItems.filter((_, i) => i !== index)

    onChange(newItems)
  }

  const handleAddItem = () => {
    const newItems = [...headersItems, { id: uuid(), key: '', value: '' }]

    onChange(newItems)
  }

  if (headersItems.length === 0) {
    return (
      <div className="space-y-2">
        <div className="body-xs-regular text-text-tertiary">
          {t('mcp.modal.noHeaders', { ns: 'tools' })}
        </div>
        {!readonly && (
          <Button
            variant="secondary"
            size="small"
            onClick={handleAddItem}
            className="w-full"
          >
            <RiAddLine className="mr-1 h-4 w-4" />
            {t('mcp.modal.addHeader', { ns: 'tools' })}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {isMasked && (
        <div className="body-xs-regular text-text-tertiary">
          {t('mcp.modal.maskedHeadersTip', { ns: 'tools' })}
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-divider-regular">
        <div className="system-xs-medium-uppercase bg-background-secondary flex h-7 items-center leading-7 text-text-tertiary">
          <div className="h-full w-1/2 border-r border-divider-regular pl-3">{t('mcp.modal.headerKey', { ns: 'tools' })}</div>
          <div className="h-full w-1/2 pl-3 pr-1">{t('mcp.modal.headerValue', { ns: 'tools' })}</div>
        </div>
        {headersItems.map((item, index) => (
          <div
            key={item.id}
            className={cn(
              'flex items-center border-divider-regular',
              index < headersItems.length - 1 && 'border-b',
            )}
          >
            <div className="w-1/2 border-r border-divider-regular">
              <Input
                value={item.key}
                onChange={e => handleItemChange(index, 'key', e.target.value)}
                placeholder={t('mcp.modal.headerKeyPlaceholder', { ns: 'tools' })}
                className="rounded-none border-0"
                readOnly={readonly}
              />
            </div>
            <div className="flex w-1/2 items-center">
              <Input
                value={item.value}
                onChange={e => handleItemChange(index, 'value', e.target.value)}
                placeholder={t('mcp.modal.headerValuePlaceholder', { ns: 'tools' })}
                className="flex-1 rounded-none border-0"
                readOnly={readonly}
              />
              {!readonly && !!headersItems.length && (
                <ActionButton
                  onClick={() => handleRemoveItem(index)}
                  className="mr-2"
                >
                  <RiDeleteBinLine className="h-4 w-4 text-text-destructive" />
                </ActionButton>
              )}
            </div>
          </div>
        ))}
      </div>
      {!readonly && (
        <Button
          variant="secondary"
          size="small"
          onClick={handleAddItem}
          className="w-full"
        >
          <RiAddLine className="mr-1 h-4 w-4" />
          {t('mcp.modal.addHeader', { ns: 'tools' })}
        </Button>
      )}
    </div>
  )
}

export default React.memo(HeadersInput)
