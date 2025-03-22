'use client'
import type { FC } from 'react'
import React from 'react'
import cn from '@/utils/classnames'
import { varHighlightHTML } from '@/app/components/app/configuration/base/var-highlight'
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
  const withHightContent = (value || '')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{\{([^}]+)\}\}/g, varHighlightHTML({ name: '$1', className: '!mb-0' })) // `<span class="${highLightClassName}">{{$1}}</span>`
    .replace(/\n/g, '<br />')

  return (
    <div
      className={
        cn(wrapClassName, 'flex h-full w-full')
      } onClick={onFocus}
    >
      {(isFocus && !readonly && children)
        ? (
          children
        )
        : (
          <div
            className={cn(textClassName, 'h-full w-0 grow truncate whitespace-nowrap')}
            title={value}
            dangerouslySetInnerHTML={{
              __html: withHightContent,
            }}></div>
        )}
    </div>
  )
}
export default React.memo(SupportVarInput)
