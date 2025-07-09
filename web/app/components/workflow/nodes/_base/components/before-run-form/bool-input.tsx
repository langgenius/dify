'use client'
import Checkbox from '@/app/components/base/checkbox'
import type { FC } from 'react'
import React, { useCallback } from 'react'

type Props = {
  name: string
  value: boolean
  onChange: (value: boolean) => void
}

const BoolInput: FC<Props> = ({
  value,
  onChange,
  name,
}) => {
  const handleChange = useCallback(() => {
    onChange(!value)
  }, [value, onChange])
  return (
    <div className='flex h-6 items-center gap-2'>
      <Checkbox
        className='!h-4 !w-4'
        checked={!!value}
        onCheck={handleChange}
      />
      <div className='system-sm-medium text-text-secondary'>{name}</div>
    </div>
  )
}
export default React.memo(BoolInput)
