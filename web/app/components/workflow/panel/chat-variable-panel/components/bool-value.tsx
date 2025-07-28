'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo } from 'react'
import OptionCard from '../../../nodes/_base/components/option-card'

type Props = {
  value: boolean | string
  onChange: (value: string) => void
}

const BoolValue: FC<Props> = ({
  value,
  onChange,
}) => {
  const booleanValue = useMemo(() => {
    if(typeof value === 'boolean')
      return value
    return value === 'true'
  }, [value])
  const handleChange = useCallback((newValue: boolean) => {
    return () => {
      onChange(newValue.toString()) // the backend expects a string value: 'true' or 'false'
    }
  }, [onChange])

  return (
    <div className='flex w-full space-x-1'>
      <OptionCard className='grow'
        selected={booleanValue}
        title='True'
        onSelect={handleChange(true)}
      />
      <OptionCard className='grow'
        selected={!booleanValue}
        title='False'
        onSelect={handleChange(false)}
      />
    </div>
  )
}
export default React.memo(BoolValue)
