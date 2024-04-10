'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import { Resolution } from '@/types/app'

const i18nPrefix = 'workflow.nodes.llm'

type ItemProps = {
  title: string
  value: Resolution
  onSelect: (value: Resolution) => void
  isSelected: boolean
}

const Item: FC<ItemProps> = ({ title, value, onSelect, isSelected }) => {
  const handleSelect = useCallback(() => {
    if (isSelected)
      return
    onSelect(value)
  }, [value, onSelect, isSelected])

  return (
    <div
      className={cn(isSelected ? 'bg-white border-[2px] border-primary-400  shadow-xs' : 'bg-gray-25 border border-gray-100', 'flex items-center h-8 px-3 rounded-lg text-[13px] font-normal text-gray-900 cursor-pointer')}
      onClick={handleSelect}
    >
      {title}
    </div>
  )
}

type Props = {
  value: Resolution
  onChange: (value: Resolution) => void
}

const ResolutionPicker: FC<Props> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation()

  return (
    <div className='flex items-center justify-between'>
      <div className='mr-2 text-xs font-medium text-gray-500 uppercase'>{t(`${i18nPrefix}.resolution.name`)}</div>
      <div className='flex items-center space-x-1'>
        <Item
          title={t(`${i18nPrefix}.resolution.high`)}
          value={Resolution.high}
          onSelect={onChange}
          isSelected={value === Resolution.high}
        />
        <Item
          title={t(`${i18nPrefix}.resolution.low`)}
          value={Resolution.low}
          onSelect={onChange}
          isSelected={value === Resolution.low}
        />
      </div>
    </div>
  )
}
export default React.memo(ResolutionPicker)
