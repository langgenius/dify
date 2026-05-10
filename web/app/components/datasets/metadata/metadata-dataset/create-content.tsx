'use client'
import type { FC } from 'react'
import type { BuiltInMetadataItem } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { PopoverTitle } from '@langgenius/dify-ui/popover'
import { noop } from 'es-toolkit/function'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import OptionCard from '../../../workflow/nodes/_base/components/option-card'
import { DataType } from '../types'
import Field from './field'

const i18nPrefix = 'metadata.createMetadata'

export type Props = {
  onClose?: () => void
  onSave: (data: BuiltInMetadataItem) => void
  hasBack?: boolean
  onBack?: () => void
}

const CreateContent: FC<Props> = ({
  onClose = noop,
  hasBack,
  onBack,
  onSave,
}) => {
  const { t } = useTranslation()
  const [type, setType] = useState(DataType.string)

  const handleTypeChange = useCallback((newType: DataType) => {
    return () => setType(newType)
  }, [setType])
  const [name, setName] = useState('')
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value)
  }, [setName])

  const handleSave = useCallback(() => {
    onSave({
      type,
      name,
    })
  }, [onSave, type, name])

  return (
    <div className="w-[320px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg px-3 pt-3.5 pb-4 shadow-xl">
      {hasBack && (
        <button
          type="button"
          className="relative left-[-4px] mb-1 flex cursor-pointer items-center space-x-1 py-1 text-text-accent"
          onClick={onBack}
        >
          <span className="i-ri-arrow-left-line size-4" />
          <span className="system-xs-semibold-uppercase">{t(`${i18nPrefix}.back`, { ns: 'dataset' })}</span>
        </button>
      )}
      <div className="mb-1 flex h-6 items-center justify-between">
        <PopoverTitle className="system-xl-semibold text-text-primary">
          {t(`${i18nPrefix}.title`, { ns: 'dataset' })}
        </PopoverTitle>
        {!hasBack && (
          <button
            type="button"
            aria-label={t('operation.close', { ns: 'common' })}
            className="cursor-pointer p-1.5 text-text-tertiary"
            onClick={onClose}
          >
            <span className="i-ri-close-line size-4" data-testid="modal-close-btn" />
          </button>
        )}
      </div>
      <div className="mt-2">
        <div className="space-y-3">
          <Field label={t(`${i18nPrefix}.type`, { ns: 'dataset' })}>
            <div className="grid grid-cols-3 gap-2">
              <OptionCard
                title="String"
                selected={type === DataType.string}
                onSelect={handleTypeChange(DataType.string)}
              />
              <OptionCard
                title="Number"
                selected={type === DataType.number}
                onSelect={handleTypeChange(DataType.number)}
              />
              <OptionCard
                title="Time"
                selected={type === DataType.time}
                onSelect={handleTypeChange(DataType.time)}
              />
            </div>
          </Field>
          <Field label={t(`${i18nPrefix}.name`, { ns: 'dataset' })}>
            <Input
              value={name}
              onChange={handleNameChange}
              placeholder={t(`${i18nPrefix}.namePlaceholder`, { ns: 'dataset' })}
            />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          className="mr-2"
          onClick={onClose}
        >
          {t('operation.cancel', { ns: 'common' })}
        </Button>
        <Button
          onClick={handleSave}
          variant="primary"
        >
          {t('operation.save', { ns: 'common' })}
        </Button>
      </div>
    </div>
  )
}
export default React.memo(CreateContent)
