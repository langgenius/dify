'use client'

import type { FC, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import Link from '@/next/link'

type BaseProps = {
  badge?: string
  badgeVariant?: 'basic' | 'advanced'
  description: string
  icon: ReactNode
  title: string
  visualStyle?: 'default' | 'compact'
}

type ButtonActionCardProps = BaseProps & {
  href?: never
  onClick: () => void
}

type LinkActionCardProps = BaseProps & {
  href: string
  onClick?: never
}

export type FirstEmptyActionCardProps = ButtonActionCardProps | LinkActionCardProps

const baseCardClassName = 'relative flex flex-col rounded-xl border border-components-panel-border bg-components-panel-on-panel-item-bg text-left shadow-xs transition-colors hover:bg-components-panel-on-panel-item-bg-hover hover:shadow-sm'
const badgeClassName = {
  basic: 'bg-util-colors-orange-orange-50 text-util-colors-orange-orange-600',
  advanced: 'bg-components-dropzone-bg-accent text-components-premium-badge-blue-bg-stop-100',
}

const ActionCardContent: FC<BaseProps> = ({
  badge,
  badgeVariant = 'basic',
  description,
  icon,
  title,
  visualStyle = 'default',
}) => {
  const isCompact = visualStyle === 'compact'

  return (
    <>
      {badge && (
        <span className={`${isCompact ? `top-0 right-0 rounded-bl-[5px] pr-2 pl-3 ${badgeClassName[badgeVariant]}` : 'top-4 right-4 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-[5px] text-text-tertiary'} absolute flex min-w-[18px] items-center justify-center gap-0.5 py-[3px] system-2xs-medium-uppercase`}>
          {badge}
        </span>
      )}
      <span className={`${isCompact ? 'size-10 rounded-lg border border-divider-regular text-2xl/7' : 'size-12 rounded-xl text-2xl/8'} flex items-center justify-center bg-components-icon-bg-teal-soft text-text-accent`}>
        {icon}
      </span>
      <span className={`${isCompact ? 'mt-1 system-md-semibold text-text-secondary' : 'mt-5 system-md-semibold text-text-primary'} w-full truncate`}>{title}</span>
      <span className={`${isCompact ? 'mt-3 line-clamp-3 system-xs-regular' : 'mt-2 system-sm-regular'} text-text-tertiary`}>{description}</span>
    </>
  )
}

const FirstEmptyActionCard: FC<FirstEmptyActionCardProps> = (props) => {
  const className = cn(
    baseCardClassName,
    props.visualStyle === 'compact'
      ? 'min-h-[156px] overflow-hidden px-4 pt-6 pb-3'
      : 'min-h-[204px] p-6',
  )

  if (props.href) {
    return (
      <Link href={props.href} className={className}>
        <ActionCardContent badge={props.badge} badgeVariant={props.badgeVariant} description={props.description} icon={props.icon} title={props.title} visualStyle={props.visualStyle} />
      </Link>
    )
  }

  return (
    <button type="button" className={className} onClick={props.onClick}>
      <ActionCardContent badge={props.badge} badgeVariant={props.badgeVariant} description={props.description} icon={props.icon} title={props.title} visualStyle={props.visualStyle} />
    </button>
  )
}

export default FirstEmptyActionCard
