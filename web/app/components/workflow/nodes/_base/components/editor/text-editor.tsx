'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useBoolean } from 'ahooks'
import Base from './base'

type Props = {
  value: string
  onChange: (value: string) => void
  title: JSX.Element
  headerRight?: JSX.Element
  minHeight?: number
  onBlur?: () => void
}

const TextEditor: FC<Props> = ({
  value,
  onChange,
  title,
  headerRight,
  minHeight,
  onBlur,
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
      >
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={setIsFocus}
          onBlur={handleBlur}
          className='w-full h-full p-3 resize-none bg-transparent'
        />
      </Base>
    </div>
  )
}
export default React.memo(TextEditor)
