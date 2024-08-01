'use client'
import type { FC } from 'react'
import React from 'react'
import SubVariablePicker from './sub-variable-picker'
import { SimpleSelect as Select } from '@/app/components/base/select'
import Input from '@/app/components/base/input'

type Props = {
  hasSubVariable: boolean
}

const FilterCondition: FC<Props> = ({
  hasSubVariable,
}) => {
  return (
    <div>
      {hasSubVariable && <SubVariablePicker className="mb-2" />}
      <div className='flex space-x-1'>
        <Select
          wrapperClassName='shrink-0 h-8'
          className='!text-[13px]'
          items={[
            { value: '1', name: 'include', type: '' },
          ]}
          onSelect={() => { }}
        />
        <Input className='grow h-8 text-components-input-text-filled system-sm-regular !text-[13px]' />
      </div>
    </div>
  )
}
export default React.memo(FilterCondition)
