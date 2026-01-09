import type { FC, PropsWithChildren, ReactNode } from 'react'
import type { InputProps } from '@/app/components/base/input'
import type { InputNumberProps } from '@/app/components/base/input-number'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { InputNumber } from '@/app/components/base/input-number'
import Tooltip from '@/app/components/base/tooltip'

const TextLabel: FC<PropsWithChildren> = (props) => {
  return <label className="text-xs font-semibold leading-none text-text-secondary">{props.children}</label>
}

const FormField: FC<PropsWithChildren<{ label: ReactNode }>> = (props) => {
  return (
    <div className="flex-1 space-y-2">
      <TextLabel>{props.label}</TextLabel>
      {props.children}
    </div>
  )
}

export const DelimiterInput: FC<InputProps & { tooltip?: string }> = (props) => {
  const { t } = useTranslation()
  return (
    <FormField label={(
      <div className="mb-1 flex items-center">
        <span className="system-sm-semibold mr-0.5">{t('stepTwo.separator', { ns: 'datasetCreation' })}</span>
        <Tooltip
          popupContent={(
            <div className="max-w-[200px]">
              {props.tooltip || t('stepTwo.separatorTip', { ns: 'datasetCreation' })}
            </div>
          )}
        />
      </div>
    )}
    >
      <Input
        type="text"
        className="h-9"
        placeholder={t('stepTwo.separatorPlaceholder', { ns: 'datasetCreation' })!}
        {...props}
      />
    </FormField>
  )
}

export const MaxLengthInput: FC<InputNumberProps> = (props) => {
  const maxValue = Number.parseInt(globalThis.document?.body?.getAttribute('data-public-indexing-max-segmentation-tokens-length') || '4000', 10)

  const { t } = useTranslation()
  return (
    <FormField label={(
      <div className="system-sm-semibold mb-1">
        {t('stepTwo.maxLength', { ns: 'datasetCreation' })}
      </div>
    )}
    >
      <InputNumber
        type="number"
        size="large"
        placeholder={`≤ ${maxValue}`}
        max={maxValue}
        min={1}
        {...props}
      />
    </FormField>
  )
}

export const OverlapInput: FC<InputNumberProps> = (props) => {
  const { t } = useTranslation()
  return (
    <FormField label={(
      <div className="mb-1 flex items-center">
        <span className="system-sm-semibold">{t('stepTwo.overlap', { ns: 'datasetCreation' })}</span>
        <Tooltip
          popupContent={(
            <div className="max-w-[200px]">
              {t('stepTwo.overlapTip', { ns: 'datasetCreation' })}
            </div>
          )}
        />
      </div>
    )}
    >
      <InputNumber
        type="number"
        size="large"
        placeholder={t('stepTwo.overlap', { ns: 'datasetCreation' }) || ''}
        min={1}
        {...props}
      />
    </FormField>
  )
}
