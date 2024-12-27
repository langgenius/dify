import type { FC, PropsWithChildren, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { InputProps } from '@/app/components/base/input'
import Input from '@/app/components/base/input'
import Tooltip from '@/app/components/base/tooltip'
import type { InputNumberProps } from '@/app/components/base/input-number'
import { InputNumber } from '@/app/components/base/input-number'

const TextLabel: FC<PropsWithChildren> = (props) => {
  return <label className='text-text-secondary text-xs font-semibold leading-none'>{props.children}</label>
}

const FormField: FC<PropsWithChildren<{ label: ReactNode }>> = (props) => {
  return <div className='space-y-2 flex-1'>
    <TextLabel>{props.label}</TextLabel>
    {props.children}
  </div>
}

export const DelimiterInput: FC<InputProps & { tooltip?: string }> = (props) => {
  const { t } = useTranslation()
  return <FormField label={<div className='flex items-center mb-1'>
    <span className='system-sm-semibold mr-0.5'>{t('datasetCreation.stepTwo.separator')}</span>
    <Tooltip
      popupContent={
        <div className='max-w-[200px]'>
          {props.tooltip || t('datasetCreation.stepTwo.separatorTip')}
        </div>
      }
    />
  </div>}>
    <Input
      type="text"
      className='h-9'
      placeholder={t('datasetCreation.stepTwo.separatorPlaceholder')!}
      {...props}
    />
  </FormField>
}

export const MaxLengthInput: FC<InputNumberProps> = (props) => {
  const { t } = useTranslation()
  return <FormField label={<div className='system-sm-semibold mb-1'>
    {t('datasetCreation.stepTwo.maxLength')}
  </div>}>
    <InputNumber
      type="number"
      className='h-9'
      placeholder={'≤ 4000'}
      max={4000}
      min={1}
      {...props}
    />
  </FormField>
}

export const OverlapInput: FC<InputNumberProps> = (props) => {
  const { t } = useTranslation()
  return <FormField label={<div className='flex items-center mb-1'>
    <span className='system-sm-semibold'>{t('datasetCreation.stepTwo.overlap')}</span>
    <Tooltip
      popupContent={
        <div className='max-w-[200px]'>
          {t('datasetCreation.stepTwo.overlapTip')}
        </div>
      }
    />
  </div>}>
    <InputNumber
      type="number"
      className='h-9'
      placeholder={t('datasetCreation.stepTwo.overlap') || ''}
      min={1}
      {...props}
    />
  </FormField>
}
