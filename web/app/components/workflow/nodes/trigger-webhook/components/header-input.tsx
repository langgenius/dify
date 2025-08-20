'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { RiDeleteBinLine } from '@remixicon/react'
import type { WebhookHeader } from '../types'
import Switch from '@/app/components/base/switch'
import cn from '@/utils/classnames'

type Props = {
  readonly?: boolean
  header: WebhookHeader
  onChange: (header: WebhookHeader) => void
  onRemove: () => void
}

const HeaderInput: FC<Props> = ({
  readonly = false,
  header,
  onChange,
  onRemove,
}) => {
  const { t } = useTranslation()

  const handleNameChange = useCallback((value: string) => {
    onChange({ ...header, name: value })
  }, [header, onChange])

  const handleRequiredChange = useCallback((required: boolean) => {
    onChange({ ...header, required })
  }, [header, onChange])

  return (
    <div className={cn('h-min-7 group flex items-center border-t border-divider-regular')}>
      <div className="w-1/2 shrink-0 border-r border-divider-regular">
        <input
          className='system-sm-regular focus:bg-gray-100! w-full appearance-none rounded-none border-none bg-transparent px-3 py-1 text-text-primary outline-none hover:bg-components-input-bg-hover focus:ring-0'
          value={header.name}
          onChange={e => handleNameChange(e.target.value)}
          placeholder={t('workflow.nodes.triggerWebhook.headerName')!}
          disabled={readonly}
        />
      </div>

      <div className="flex w-[140px] shrink-0 items-center justify-between gap-2 px-3">
        <span className="system-xs-medium-uppercase text-text-tertiary">{t('workflow.nodes.triggerWebhook.required')}</span>
        <Switch
          defaultValue={header.required}
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

export default React.memo(HeaderInput)
