'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useBoolean } from 'ahooks'
import Base from './base'

type Props = {
  value: string
  onChange: (value: string) => void
  title: JSX.Element | string
  headerRight?: JSX.Element
  minHeight?: number
  onBlur?: () => void
  placeholder?: string
  readonly?: boolean
  isInNode?: boolean
}

const TextEditor: FC<Props> = ({
  value,
  onChange,
  title,
  headerRight,
  minHeight,
  onBlur,
  placeholder,
  readonly,
  isInNode,
}) => {
  const [isFocus, {
    setTrue: setIsFocus,
    setFalse: setIsNotFocus,
  }] = useBoolean(false)

  const handleBlur = useCallback(() => {
    setIsNotFocus()
    onBlur?.()
  }, [setIsNotFocus, onBlur])

  return (
    <div>
      <Base
        title={title}
        value={value}
        headerRight={headerRight}
        isFocus={isFocus}
        minHeight={minHeight}
        isInNode={isInNode}
      >
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={setIsFocus}
          onBlur={handleBlur}
          className='w-full h-full px-3 resize-none bg-transparent border-none focus:outline-none leading-[18px] text-[13px] font-normal text-gray-900 placeholder:text-gray-300'
          placeholder={placeholder}
          readOnly={readonly}
        />
      </Base>
    </div>
  )
}
export default React.memo(TextEditor)
