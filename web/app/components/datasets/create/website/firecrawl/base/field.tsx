'use client'
import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import Input from './input'

type Props = {
  className?: string
  label: string
  value: string | number
  onChange: (value: string | number) => void
  isRequired?: boolean
  placeholder?: string
  isNumber?: boolean
}

const Field: FC<Props> = ({
  className,
  label,
  value,
  onChange,
  isRequired = false,
  placeholder = '',
  isNumber = false,
}) => {
  return (
    <div className={cn(className)}>
      <div>
        <span>{label} </span>
        {isRequired && <span>*</span>}
      </div>
      <Input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        isNumber={isNumber}
      />
    </div>
  )
}
export default React.memo(Field)
