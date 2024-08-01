'use client'
import type { FC } from 'react'
import React from 'react'
import SubVariablePicker from './sub-variable-picker'
import { SimpleSelect as Select } from '@/app/components/base/select'
import Input from '@/app/components/base/input'

const FilterCondition: FC = () => {
  return (
    <div>
      <SubVariablePicker />
      <div className='mt-2 flex space-x-1'>
        <Select
          wrapperClassName='shrink-0 h-8'
          items={[
            { value: '1', name: 'include', type: '' },
          ]}
          onSelect={() => { }}
        />
        <Input className='grow h-8' />
      </div>
    </div>
  )
}
export default React.memo(FilterCondition)
