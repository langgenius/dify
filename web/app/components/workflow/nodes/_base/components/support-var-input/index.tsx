'use client'
import type { FC } from 'react'
import * as React from 'react'
import VarHighlight from '@/app/components/app/configuration/base/var-highlight'
import { cn } from '@/utils/classnames'

type Props = {
  isFocus?: boolean
  onFocus?: () => void
  value: string
  children?: React.ReactNode
  wrapClassName?: string
  textClassName?: string
  readonly?: boolean
}

const SupportVarInput: FC<Props> = ({
  isFocus,
  onFocus,
  children,
  value,
  wrapClassName,
  textClassName,
  readonly,
}) => {
  const renderSafeContent = (inputValue: string) => {
    const parts = inputValue.split(/(\{\{[^}]+\}\}|\n)/g)
    return parts.map((part, index) => {
      const variableRegex = /^\{\{([^}]+)\}\}$/
      const variableMatch = variableRegex.exec(part)
      if (variableMatch) {
        return (
          <VarHighlight
            key={`var-${index}`}
            name={variableMatch[1]}
          />
        )
      }
      if (part === '\n')
        return <br key={`br-${index}`} />

      return <span key={`text-${index}`}>{part}</span>
    })
  }

  return (
    <div
      className={
        cn(wrapClassName, 'flex h-full w-full')
      }
      onClick={onFocus}
    >
      {(isFocus && !readonly && children)
        ? (
            children
          )
        : (
            <div
              className={cn(textClassName, 'h-full w-0 grow truncate whitespace-nowrap')}
              title={value}
            >
              {renderSafeContent(value || '')}
            </div>
          )}
    </div>
  )
}
export default React.memo(SupportVarInput)
