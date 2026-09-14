'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type Props = Readonly<{
  className?: string
  title: string
  htmlFor?: string
  titleId?: string
  isOptional?: boolean
  errorMessage?: string
  errorId?: string
  children: React.JSX.Element
}>

const Field: FC<Props> = ({
  className,
  title,
  htmlFor,
  titleId,
  isOptional,
  errorMessage,
  errorId,
  children,
}) => {
  const { t } = useTranslation()
  const Label = htmlFor ? 'label' : 'div'
  return (
    <div className={cn(className)}>
      <Label
        id={titleId}
        htmlFor={htmlFor}
        className="block system-sm-semibold leading-8! text-text-secondary"
      >
        {title}
        {isOptional && (
          <span className="ml-1 system-xs-regular text-text-tertiary">
            ({t(($) => $['variableConfig.optional'], { ns: 'appDebug' })})
          </span>
        )}
      </Label>
      <div>{children}</div>
      {errorMessage && (
        <p id={errorId} className="mt-1 system-xs-regular text-text-destructive">
          {errorMessage}
        </p>
      )}
    </div>
  )
}
export default React.memo(Field)
