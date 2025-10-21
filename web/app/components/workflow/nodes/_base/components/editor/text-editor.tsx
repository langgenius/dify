'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useBoolean } from 'ahooks'
import Base from './base'

type Props = {
  value: string
  onChange: (value: string) => void
  title: React.JSX.Element | string
  headerRight?: React.JSX.Element
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
          className='h-full w-full resize-none border-none bg-transparent px-3 text-[13px] font-normal leading-[18px] text-gray-900 placeholder:text-gray-300 focus:outline-none'
          placeholder={placeholder}
          readOnly={readonly}
        />
      </Base>
    </div>
  )
}
export default React.memo(TextEditor)
