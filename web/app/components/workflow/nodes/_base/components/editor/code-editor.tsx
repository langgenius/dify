'use client'
import type { FC } from 'react'
import React from 'react'
import type { CodeLanguage } from '../../../code/types'
import Base from './base'

type Props = {
  value: string
  onChange: (value: string) => void
  title: JSX.Element
  codeLanguage: string
  onCodeLanguageChange: (codeLanguage: CodeLanguage) => void
}

const CodeEditor: FC<Props> = ({
  value,
  onChange,
  title,
}) => {
  const [isFocus, setIsFocus] = React.useState(false)

  return (
    <div>
      <Base
        title={title}
        value={value}
        isFocus={isFocus}
        minHeight={86}
      >
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setIsFocus(true)}
          onBlur={() => setIsFocus(false)}
          className='w-full h-full p-3 resize-none bg-transparent'
        />
      </Base>
    </div>
  )
}
export default React.memo(CodeEditor)
