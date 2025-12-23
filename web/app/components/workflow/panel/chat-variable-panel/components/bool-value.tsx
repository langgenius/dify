'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useCallback } from 'react'
import OptionCard from '../../../nodes/_base/components/option-card'

type Props = {
  value: boolean
  onChange: (value: boolean) => void
}

const BoolValue: FC<Props> = ({
  value,
  onChange,
}) => {
  const booleanValue = value
  const handleChange = useCallback((newValue: boolean) => {
    return () => {
      onChange(newValue)
    }
  }, [onChange])

  return (
    <div className="flex w-full space-x-1">
      <OptionCard
        className="grow"
        selected={booleanValue}
        title="True"
        onSelect={handleChange(true)}
      />
      <OptionCard
        className="grow"
        selected={!booleanValue}
        title="False"
        onSelect={handleChange(false)}
      />
    </div>
  )
}
export default React.memo(BoolValue)
