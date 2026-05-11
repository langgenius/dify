'use client'
import type { FC, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { Infotip } from '@/app/components/base/infotip'

type Props = {
  className?: string
  title: ReactNode
  tooltip?: ReactNode
  isSubTitle?: boolean
  supportFold?: boolean
  children?: React.JSX.Element | string | null
  operations?: React.JSX.Element
  inline?: boolean
  required?: boolean
  warningDot?: boolean
}

const getTextFromNode = (node: ReactNode): string | undefined => {
  if (typeof node === 'string' || typeof node === 'number')
    return `${node}`

  if (Array.isArray(node))
    return node.map(getTextFromNode).filter(Boolean).join(' ')

  if (React.isValidElement<{ children?: ReactNode }>(node))
    return getTextFromNode(node.props.children)
}

const Field: FC<Props> = ({
  className,
  title,
  isSubTitle,
  tooltip,
  children,
  operations,
  inline,
  supportFold,
  required,
  warningDot,
}) => {
  const [fold, {
    toggle: toggleFold,
  }] = useBoolean(true)
  const tooltipLabel = tooltip ? getTextFromNode(tooltip) || getTextFromNode(title) || 'Help' : undefined

  return (
    <div className={cn(className, inline && 'flex w-full items-center justify-between')}>
      <div
        onClick={() => supportFold && toggleFold()}
        className={cn('flex items-center justify-between', supportFold && 'cursor-pointer')}
      >
        <div className="flex h-6 items-center">
          <div className={cn('relative', isSubTitle ? 'system-xs-medium-uppercase text-text-tertiary' : 'system-sm-semibold-uppercase text-text-secondary')}>
            {warningDot && (
              <span className="absolute top-1/2 -left-[9px] size-[5px] -translate-y-1/2 rounded-full bg-text-warning-secondary" />
            )}
            {title}
            {' '}
            {required && <span className="text-text-destructive">*</span>}
          </div>
          {!!tooltip && !!tooltipLabel && (
            <Infotip aria-label={tooltipLabel} className="ml-1">
              {tooltip}
            </Infotip>
          )}
        </div>
        <div className="flex">
          {!!operations && <div>{operations}</div>}
          {supportFold && (
            <RiArrowDownSLine className="h-4 w-4 cursor-pointer text-text-tertiary transition-transform" style={{ transform: fold ? 'rotate(-90deg)' : 'rotate(0deg)' }} />
          )}
        </div>
      </div>
      {!!(children && (!supportFold || (supportFold && !fold))) && <div className={cn(!inline && 'mt-1')}>{children}</div>}
    </div>
  )
}
export default React.memo(Field)
