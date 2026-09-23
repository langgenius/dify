'use client'
import type { BuiltInMetadataItem } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Input } from '@langgenius/dify-ui/input'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { noop } from 'es-toolkit/function'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DataType } from '../types'
import Field from './field'

const i18nPrefix = 'metadata.createMetadata'

export type Props = Readonly<{
  onClose?: () => void
  onSave: (data: BuiltInMetadataItem) => void
  hasBack?: boolean
  onBack?: () => void
}>

export function CreateContent({ onClose = noop, hasBack, onBack, onSave }: Props) {
  const { t } = useTranslation(['common', 'dataset'])
  const [type, setType] = useState<DataType>(DataType.string)

  const [name, setName] = useState('')

  const handleSave = useCallback(() => {
    onSave({
      type,
      name,
    })
  }, [onSave, type, name])

  return (
    <div className="px-3 pt-3.5 pb-4">
      {hasBack && (
        <button
          type="button"
          className="relative -left-1 mb-1 flex cursor-pointer items-center space-x-1 border-none bg-transparent px-0 py-1 text-left text-text-accent"
          onClick={onBack}
        >
          <span className="i-ri-arrow-left-line size-4" aria-hidden="true" />
          <span className="system-xs-semibold-uppercase">
            {t(($) => $[`${i18nPrefix}.back`], { ns: 'dataset' })}
          </span>
        </button>
      )}
      <div className="mb-1 flex h-6 items-center justify-between">
        <div className="system-xl-semibold text-text-primary">
          {t(($) => $[`${i18nPrefix}.title`], { ns: 'dataset' })}
        </div>
        {!hasBack && (
          <button
            type="button"
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            className="cursor-pointer border-none bg-transparent p-1.5 text-text-tertiary"
            onClick={onClose}
          >
            <span className="i-ri-close-line size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="mt-2">
        <div className="space-y-3">
          <Fieldset
            render={<RadioGroup<DataType> value={type} onValueChange={setType} />}
            className="block"
          >
            <FieldsetLegend className="py-1 system-sm-semibold text-text-secondary">
              {t(($) => $[`${i18nPrefix}.type`], { ns: 'dataset' })}
            </FieldsetLegend>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {[
                { value: DataType.string, label: 'String' },
                { value: DataType.number, label: 'Number' },
                { value: DataType.time, label: 'Time' },
              ].map((option) => (
                <RadioItem<DataType>
                  key={option.value}
                  value={option.value}
                  nativeButton
                  render={<button type="button" />}
                  className="flex h-8 cursor-pointer items-center justify-center rounded-md border border-components-option-card-option-border bg-components-option-card-option-bg px-2 system-sm-regular text-text-secondary hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:system-sm-medium"
                >
                  {option.label}
                </RadioItem>
              ))}
            </div>
          </Fieldset>
          <Field label={t(($) => $[`${i18nPrefix}.name`], { ns: 'dataset' })}>
            <Input
              aria-label={t(($) => $[`${i18nPrefix}.name`], { ns: 'dataset' })}
              value={name}
              onValueChange={setName}
              placeholder={t(($) => $[`${i18nPrefix}.namePlaceholder`], { ns: 'dataset' })}
            />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button className="mr-2" onClick={onClose}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </Button>
        <Button onClick={handleSave} variant="primary">
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </div>
    </div>
  )
}
