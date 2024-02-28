'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useBoolean } from 'ahooks'
import cn from 'classnames'
import RemoveButton from '@/app/components/workflow/nodes/_base/components/remove-button'
type Props = {
  className?: string
  value: string
  onChange: (newValue: string) => void
  hasRemove: boolean
  onRemove?: () => void
}

const InputItem: FC<Props> = ({
  className,
  value,
  onChange,
  hasRemove,
  onRemove,
}) => {
  const [isEdit, {
    setTrue: setIsEditTrue,
    setFalse: setIsEditFalse,
  }] = useBoolean(false)

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value)
  }, [onChange])

  const handleRemove = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onRemove?.()
  }, [onRemove])

  return (
    <div className={cn(className, !isEdit && 'hover:bg-gray-50 hover:cursor-text', 'relative flex h-full items-center pl-2')}>
      {isEdit
        ? (
          <input
            type='text'
            className='w-full h-[18px] leading-[18px] pl-0.5  text-gray-900 text-xs font-normal placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200'
            value={value}
            onChange={handleChange}
            onBlur={setIsEditFalse}
            autoFocus
          />
        )
        : <div
          className="pl-0.5 w-full h-[18px] leading-[18px]"
          onClick={setIsEditTrue}
        >
          <div className='text-gray-900 text-xs font-normal'>{value}</div>
          {hasRemove && !isEdit && (
            <RemoveButton
              className='group-hover:block hidden absolute right-1 top-0.5'
              onClick={handleRemove}
            />
          )}
        </div>}
    </div>
  )
}
export default React.memo(InputItem)
