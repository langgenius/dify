import type { FC, PropsWithChildren, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { InputProps } from '@/app/components/base/input'
import Input from '@/app/components/base/input'
import Tooltip from '@/app/components/base/tooltip'

const TextLabel: FC<PropsWithChildren> = (props) => {
  return <label className='text-[#354052] text-xs font-semibold leading-none'>{props.children}</label>
}

const FormField: FC<PropsWithChildren<{ label: ReactNode }>> = (props) => {
  return <div className='space-y-2 flex-1'>
    <TextLabel>{props.label}</TextLabel>
    {props.children}
  </div>
}

export const DelimiterInput: FC<InputProps> = (props) => {
  const { t } = useTranslation()
  return <FormField label={<div className='flex'>
    {t('datasetCreation.stepTwo.separator')}
    <Tooltip
      popupContent={
        <div className='max-w-[200px]'>
          {t('datasetCreation.stepTwo.separatorTip')}
        </div>
      }
    />
  </div>}>
    <Input
      type="text"
      className='h-9'
      placeholder={t('datasetCreation.stepTwo.separatorPlaceholder') || ''}
      {...props}
    />
  </FormField>
}

export const MaxLengthInput: FC<InputProps> = (props) => {
  const { t } = useTranslation()
  return <FormField label={<div>
    {t('datasetCreation.stepTwo.maxLength')}
  </div>}>
    <Input
      type="number"
      className='h-9'
      placeholder={t('datasetCreation.stepTwo.maxLength') || ''}
      max={4000}
      min={1}
      {...props}
    />
  </FormField>
}

export const OverlapInput: FC<InputProps> = (props) => {
  const { t } = useTranslation()
  return <FormField label={<div className='flex'>
    {t('datasetCreation.stepTwo.overlap')}
    <Tooltip
      popupContent={
        <div className='max-w-[200px]'>
          {t('datasetCreation.stepTwo.overlapTip')}
        </div>
      }
    />
  </div>}>
    <Input
      type="number"
      className='h-9'
      placeholder={t('datasetCreation.stepTwo.overlap') || ''}
      min={1}
      {...props}
    />
  </FormField>
}
