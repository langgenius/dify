'use client'
import type { FC } from 'react'
import React from 'react'
import { SimpleSelect as Select } from '@/app/components/base/select'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'

const SubVariablePicker: FC = () => {
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
  return (
    <div>
      <Select
        items={[
          { value: '1', name: 'name', type: 'string' },
          { value: '2', name: 'age', type: 'number' },
        ]}
        defaultValue={'1'}
        allowSearch
        onSelect={() => { }}
        placeholder='Select sub variable key'
        optionClassName='pl-4 pr-5 py-0'
        renderOption={renderOption}
      />
    </div>
  )
}
export default React.memo(SubVariablePicker)
