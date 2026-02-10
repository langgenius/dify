'use client'
import type { FC, ReactNode } from 'react'
import type { inputType } from '@/hooks/use-metadata'
import { useTranslation } from 'react-i18next'
import AutoHeightTextarea from '@/app/components/base/auto-height-textarea'
import Input from '@/app/components/base/input'
import { SimpleSelect } from '@/app/components/base/select'
import { getTextWidthWithCanvas } from '@/utils'
import { cn } from '@/utils/classnames'
import s from '../style.module.css'

type FieldInfoProps = {
  label: string
  value?: string
  valueIcon?: ReactNode
  displayedValue?: string
  defaultValue?: string
  showEdit?: boolean
  inputType?: inputType
  selectOptions?: Array<{ value: string, name: string }>
  onUpdate?: (v: string) => void
}

const FieldInfo: FC<FieldInfoProps> = ({
  label,
  value = '',
  valueIcon,
  displayedValue = '',
  defaultValue,
  showEdit = false,
  inputType = 'input',
  selectOptions = [],
  onUpdate,
}) => {
  const { t } = useTranslation()
  const textNeedWrap = getTextWidthWithCanvas(displayedValue) > 190
  const editAlignTop = showEdit && inputType === 'textarea'
  const readAlignTop = !showEdit && textNeedWrap

  const renderContent = () => {
    if (!showEdit)
      return displayedValue

    if (inputType === 'select') {
      return (
        <SimpleSelect
          onSelect={({ value }) => onUpdate?.(value as string)}
          items={selectOptions}
          defaultValue={value}
          className={s.select}
          wrapperClassName={s.selectWrapper}
          placeholder={`${t('metadata.placeholder.select', { ns: 'datasetDocuments' })}${label}`}
        />
      )
    }

    if (inputType === 'textarea') {
      return (
        <AutoHeightTextarea
          onChange={e => onUpdate?.(e.target.value)}
          value={value}
          className={s.textArea}
          placeholder={`${t('metadata.placeholder.add', { ns: 'datasetDocuments' })}${label}`}
        />
      )
    }

    return (
      <Input
        onChange={e => onUpdate?.(e.target.value)}
        value={value}
        defaultValue={defaultValue}
        placeholder={`${t('metadata.placeholder.add', { ns: 'datasetDocuments' })}${label}`}
      />
    )
  }

  return (
    <div className={cn('flex min-h-5 items-center gap-1 py-0.5 text-xs', editAlignTop && '!items-start', readAlignTop && '!items-start pt-1')}>
      <div className={cn('w-[200px] shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-text-tertiary', editAlignTop && 'pt-1')}>{label}</div>
      <div className="flex grow items-center gap-1 text-text-secondary">
        {valueIcon}
        {renderContent()}
      </div>
    </div>
  )
}

export default FieldInfo
