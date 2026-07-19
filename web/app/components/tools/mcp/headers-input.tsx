'use client'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid } from 'uuid'
import ActionButton from '@/app/components/base/action-button'

export type HeaderItem = {
  id: string
  key: string
  value: string
}

type Props = Readonly<{
  headersItems: HeaderItem[]
  onChange: (headerItems: HeaderItem[]) => void
  readonly?: boolean
  isMasked?: boolean
}>

const HeadersInput = ({ headersItems, onChange, readonly = false, isMasked = false }: Props) => {
  const { t } = useTranslation()

  const handleItemChange = (index: number, field: 'key' | 'value', value: string) => {
    const newItems = [...headersItems]
    newItems[index] = { ...newItems[index]!, [field]: value }

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
          {t(($) => $['mcp.modal.noHeaders'], { ns: 'tools' })}
        </div>
        {!readonly && (
          <Button
            type="button"
            variant="secondary"
            size="small"
            onClick={handleAddItem}
            className="w-full"
          >
            <span className="mr-1 i-ri-add-line size-4" aria-hidden="true" />
            {t(($) => $['mcp.modal.addHeader'], { ns: 'tools' })}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {isMasked && (
        <div className="body-xs-regular text-text-tertiary">
          {t(($) => $['mcp.modal.maskedHeadersTip'], { ns: 'tools' })}
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-divider-regular">
        <div className="bg-background-secondary flex h-7 items-center system-xs-medium-uppercase leading-7 text-text-tertiary">
          <div className="h-full w-1/2 border-r border-divider-regular pl-3">
            {t(($) => $['mcp.modal.headerKey'], { ns: 'tools' })}
          </div>
          <div className="h-full w-1/2 pr-1 pl-3">
            {t(($) => $['mcp.modal.headerValue'], { ns: 'tools' })}
          </div>
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
                aria-label={`${t(($) => $['mcp.modal.headerKey'], { ns: 'tools' })} ${index + 1}`}
                value={item.key}
                onChange={(e) => handleItemChange(index, 'key', e.target.value)}
                placeholder={t(($) => $['mcp.modal.headerKeyPlaceholder'], { ns: 'tools' })}
                className="rounded-none border-0"
                readOnly={readonly}
              />
            </div>
            <div className="flex w-1/2 items-center">
              <Input
                aria-label={`${t(($) => $['mcp.modal.headerValue'], { ns: 'tools' })} ${index + 1}`}
                value={item.value}
                onChange={(e) => handleItemChange(index, 'value', e.target.value)}
                placeholder={t(($) => $['mcp.modal.headerValuePlaceholder'], { ns: 'tools' })}
                className="flex-1 rounded-none border-0"
                readOnly={readonly}
              />
              {!readonly && !!headersItems.length && (
                <ActionButton
                  aria-label={`${t(($) => $['operation.delete'], { ns: 'common' })} ${item.key || index + 1}`}
                  onClick={() => handleRemoveItem(index)}
                  className="mr-2"
                >
                  <span
                    className="i-ri-delete-bin-line size-4 text-text-destructive"
                    aria-hidden="true"
                  />
                </ActionButton>
              )}
            </div>
          </div>
        ))}
      </div>
      {!readonly && (
        <Button
          type="button"
          variant="secondary"
          size="small"
          onClick={handleAddItem}
          className="w-full"
        >
          <span className="mr-1 i-ri-add-line size-4" aria-hidden="true" />
          {t(($) => $['mcp.modal.addHeader'], { ns: 'tools' })}
        </Button>
      )}
    </div>
  )
}

export default React.memo(HeadersInput)
