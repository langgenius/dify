'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { SUB_VARIABLES } from '../../if-else/default'
import type { Item } from '@/app/components/base/select'
import { SimpleSelect as Select } from '@/app/components/base/select'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import cn from '@/utils/classnames'

type Props = {
  value: string
  onChange: (value: string) => void
  className?: string
}

const SubVariablePicker: FC<Props> = ({
  value,
  onChange,
  className,
}) => {
  const subVarOptions = SUB_VARIABLES.map(item => ({
    value: item,
    name: item,
  }))

  const renderOption = ({ item }: { item: Record<string, any> }) => {
    return (
      <div className='flex items-center h-6 justify-between'>
        <div className='flex items-center h-full'>
          <Variable02 className='mr-[5px] w-3.5 h-3.5 text-text-accent' />
          <span className='text-text-secondary system-sm-medium'>{item.name}</span>
        </div>
        <span className='text-text-tertiary system-xs-regular'>{item.type}</span>
      </div>
    )
  }

  const handleChange = useCallback(({ value }: Item) => {
    onChange(value as string)
  }, [onChange])

  return (
    <div className={cn(className)}>
      <Select
        items={subVarOptions}
        defaultValue={value}
        onSelect={handleChange}
        className='!text-[13px]'
        placeholder='Select sub variable key'
        optionClassName='pl-4 pr-5 py-0'
        renderOption={renderOption}
      />
    </div>
  )
}
export default React.memo(SubVariablePicker)
