'use client'
import type { FC } from 'react'
import React from 'react'
import type { CustomRunFormProps, DataSourceNodeType } from './types'
import Button from '@/app/components/base/button'

const BeforeRunForm: FC<CustomRunFormProps> = ({
  payload,
  onSuccess,
  onCancel,
}) => {
  return (
    <div>
      DataSource: {(payload as DataSourceNodeType).datasource_name}
      <div className='mt-3 flex justify-center space-x-2'>
        <Button onClick={onSuccess} variant='primary'>Have runned</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}
export default React.memo(BeforeRunForm)
